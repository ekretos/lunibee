/** Library version and source URL used for the Discord-compliant User-Agent. */
import packageJson from "../package.json" with { type: "json" };
const LIBRARY_VERSION = packageJson.version;
const LIBRARY_URL = "https://github.com/Ekretos/lunibee";
const USER_AGENT = `DiscordBot (${LIBRARY_URL}, ${LIBRARY_VERSION})`;

import { MemoryRateLimitStore, type RateLimitStore } from "./store.js";
import {
    RESTError,
    abortError,
    redactPath,
    sanitizeCause,
    sleep,
} from "./errors.js";
import {
    createRouteKey,
    serializeQuery,
    type RESTQuery,
    type RouteKey,
} from "./route.js";
import { RequestScheduler } from "./scheduler.js";
import { RateLimiter, type Grant } from "./limiter.js";
import {
    requestIdentity,
    tokenFingerprint,
    type RequestIdentity,
} from "./identity.js";
import {
    emitTelemetry,
    type CoordinationMode,
    type RESTTelemetry,
} from "./telemetry.js";
import { HttpTransport, TransportError } from "./transport.js";
import { ResponseDecoder } from "./decoder.js";

/**
 * Refuses a path that URL normalization would rewrite into another route:
 * `.` / `..` segments (also percent-encoded) and backslashes. Without this,
 * an id like `../../channels/1` sends the bot token to a route the caller
 * never asked for. The path is left out of the message: it may hold a token.
 */
function assertSafePath(path: string): void {
    // The URL parser deletes tab, LF and CR before it resolves dot segments,
    // so `.\t.` would pass the segment check below and become `..`; a `#`
    // cuts off whatever the route adds after it. Neither belongs in a REST
    // path, and neither do other control characters or spaces.
    if (/[\u0000-\u0020\u007f#]/.test(path))
        throw new TypeError(
            "REST paths must not contain control characters, spaces or '#'.",
        );
    const end = path.indexOf("?");
    const pathname = end === -1 ? path : path.slice(0, end);
    if (pathname.includes("\\"))
        throw new TypeError("REST paths must not contain backslashes.");
    // `//webhooks/…` would slip past token redaction and webhook detection.
    if (pathname.includes("//"))
        throw new TypeError(
            "REST paths must not contain empty segments ('//').",
        );
    for (const segment of pathname.split("/")) {
        let decoded: string;
        try {
            decoded = decodeURIComponent(segment);
        } catch {
            throw new TypeError("REST path has malformed percent-encoding.");
        }
        // Percent-encoded whitespace (`%09..`) is judged the way a server
        // that strips it would read the segment.
        const bare = decoded.replace(/[\u0000-\u0020\u007f]/g, "");
        if (
            bare === "." ||
            bare === ".." ||
            (/[\\/]/.test(decoded) &&
                decoded.split(/[\\/]/).some((s) => {
                    const part = s.replace(/[\u0000-\u0020\u007f]/g, "");
                    return part === "." || part === "..";
                }))
        )
            throw new TypeError(
                "REST paths must not contain '.' or '..' segments.",
            );
    }
}

/** Keys of the `verb(path, { body, … })` form removed in 0.4.0. */
const WRAPPER_KEYS = new Set([
    "body",
    "files",
    "query",
    "headers",
    "reason",
    "signal",
    "auth",
    "timeout",
]);

/**
 * Recognizes a second argument that is the removed `verb(path, { body, … })`
 * form: sending it would put the wrapper itself in the request body. No
 * Discord payload has a top-level `body` or `files` field.
 */
function wrapperError(verb: string, body: unknown): TypeError | undefined {
    if (typeof body !== "object" || body === null || Array.isArray(body))
        return undefined;
    const keys = Object.keys(body);
    if (
        (keys.includes("body") || keys.includes("files")) &&
        keys.every((key) => WRAPPER_KEYS.has(key))
    )
        return new TypeError(
            `rest.${verb}(path, { body, … }) was removed in 0.4.0: call rest.${verb}(path, body, options). Run \`lunibee migrate\` to find the calls.`,
        );
    return undefined;
}

/** A file attachment sent as part of a multipart REST request. */
export interface RESTFileAttachment {
    name: string;
    /** The bytes, or a promise of them (read just before the request is sent). */
    data:
        | Blob
        | Uint8Array
        | ArrayBuffer
        | PromiseLike<Blob | Uint8Array | ArrayBuffer>;
    contentType?: string;
}

/**
 * Options controlling an individual REST request.
 *
 * The body is positional (`post(path, body, options)`); these options carry the
 * per-request knobs (`query`, `headers`, `reason`, `auth`, `signal`, `maxQueueWait`).
 */
export interface RESTRequestOptions {
    /** Abort signal used to cancel the request and any queued wait. */
    signal?: AbortSignal;
    /** Query-string appended to the path (`URLSearchParams`, a record, or a raw string). */
    query?: RESTQuery;
    /** Extra request headers merged in (library headers such as `Authorization` win). */
    headers?: Record<string, string>;
    /** Audit-log reason, sent as the `X-Audit-Log-Reason` header. */
    reason?: string;
    /** Set `false` to omit the `Authorization` header for this request. Defaults to `true`. */
    auth?: boolean;
    /**
     * Longest, in ms, this request may wait before it is sent: queued behind
     * its bucket, for a rate limit, or between retries. Past it the request
     * fails with kind `"overloaded"`. Overrides the client's `maxQueueWait`.
     */
    maxQueueWait?: number;
}

/**
 * Request options plus `files` (which upgrade the request to multipart) and, for
 * `get()` and `delete()` (which take no positional body), an optional `body`.
 */
export interface RequestData extends RESTRequestOptions {
    /** Request body for `get()` and `delete()`; `request()`, `post()`, `put()` and `patch()` take theirs positionally. */
    body?: unknown;
    /** File attachments; presence upgrades the request to `multipart/form-data`. */
    files?: RESTFileAttachment[];
}

// ─── REST Hooks ───────────────────────────────────────────────────────────────

/** Context passed to `RESTHooks.onRequest`. */
export interface RESTRequestContext {
    method: string;
    path: string;
    attempt: number;
}
/** Context passed to `RESTHooks.onResponse`. */
export interface RESTResponseContext {
    method: string;
    path: string;
    status: number;
    durationMs: number;
}
/** Context passed to `RESTHooks.onRateLimit`. */
export interface RESTRateLimitContext {
    method: string;
    path: string;
    retryAfterMs: number;
    global: boolean;
    bucket?: string;
}
/** Context passed to `RESTHooks.onRetry`. */
export interface RESTRetryContext {
    method: string;
    path: string;
    attempt: number;
    status: number;
    delayMs: number;
}

/**
 * Lightweight callback hooks for REST request lifecycle events.
 *
 * All callbacks are optional. They are dispatched in isolation from the request
 * path (deferred to a microtask, and any thrown error is swallowed), so a hook
 * cannot break or reject a request. Even so, hooks **must** be fast and
 * non-blocking: heavy synchronous work in a hook still steals event-loop time
 * from in-flight requests. Offload anything expensive to your own queue.
 */
export interface RESTHooks {
    /** Called just before every HTTP attempt. */
    onRequest?(ctx: RESTRequestContext): void;
    /** Called after a successful or failed response is received. */
    onResponse?(ctx: RESTResponseContext): void;
    /** Called when a rate limit is encountered and the client is about to wait. */
    onRateLimit?(ctx: RESTRateLimitContext): void;
    /** Called when a failed request is about to be retried. */
    onRetry?(ctx: RESTRetryContext): void;
}

/** Configures which REST failures may be retried. */
export interface RetryPolicy {
    /** Maximum retry attempts. */
    maxRetries: number;
    /** Determines whether a request may be retried. @param method HTTP method. @param status HTTP status, or zero for transport errors. @returns True when retrying is safe under the policy. */
    shouldRetry(method: string, status: number): boolean;
    /** Calculates delay before the next attempt. @param attempt Zero-based retry number. @param retryAfter Server-provided delay, when available. @returns Delay in milliseconds. */
    getDelay(attempt: number, retryAfter?: number): number;
}
/** Creates the default conservative REST retry policy. @param maxRetries Maximum retries. @returns Retry policy that retries rate limits and idempotent transient failures. @throws {TypeError} If maxRetries is negative or not finite. */
export function createRetryPolicy(maxRetries = 2): RetryPolicy {
    if (!Number.isFinite(maxRetries) || maxRetries < 0)
        throw new TypeError("maxRetries must be a non-negative finite number.");
    return {
        maxRetries: Math.floor(maxRetries),
        shouldRetry(method, status) {
            const normalized = method.toUpperCase();
            const idempotent = ["GET", "HEAD", "PUT", "DELETE"].includes(
                normalized,
            );
            // Status 0 is a transport failure (DNS, reset connection, TLS):
            // no response reached Discord's handlers, so replaying an
            // idempotent request is as safe as replaying it after a 5xx.
            if (status === 0) return idempotent;
            return (
                status === 429 || (status >= 500 && status <= 599 && idempotent)
            );
        },
        getDelay(attempt, retryAfter) {
            if (retryAfter !== undefined) return Math.max(0, retryAfter * 1000);
            return Math.min(10_000, 500 * 2 ** attempt) + Math.random() * 250;
        },
    };
}

/** A REST client's state, for health checks and diagnostics endpoints. */
export interface RESTDiagnostics {
    /** How the store enforces limits right now. */
    mode: CoordinationMode;
    /** Requests waiting for a bucket slot. */
    queued: number;
    /** Requests started and not yet settled, queued ones included. */
    inFlight: number;
    /** Bucket keys holding a queue slot. */
    buckets: number;
    /** Whether `close()` was called. */
    closed: boolean;
    /**
     * `401`, `403` and `429` responses (shared-scope 429s excepted) in the
     * last ten minutes. Discord bans an IP for a while past 10,000.
     */
    invalidRequests: number;
    /** Whether requests are refused because Discord rejected the token (see `stopOnInvalidToken`). */
    tokenRejected: boolean;
}

/** Abort reason for a request that waited past `maxQueueWait`. */
class QueueWaitExceeded extends Error {
    public constructor(public readonly ms: number) {
        super("maxQueueWait exceeded");
    }
}

function checkWait(ms: number | undefined): number | undefined {
    if (ms === undefined) return undefined;
    if (!(ms >= 0) || !Number.isFinite(ms))
        throw new RangeError("maxQueueWait must be a non-negative number.");
    return ms;
}

/** Bun-native REST transport with Discord bucket-aware rate limiting, retries, and cancellation. */
export class REST {
    readonly #retryPolicy: RetryPolicy;
    #token?: string;
    /** Fingerprint of the token: identifies this bot's limits without holding the token. */
    #fingerprint?: string;
    readonly #telemetry?: RESTTelemetry;
    /** Aborted by `close()`: cancels every wait, never an attempt already sent. */
    readonly #closing = new AbortController();
    #inFlight = 0;
    #idle?: () => void;
    /** Fingerprint of a token Discord answered 401 for. */
    #rejected?: string;
    readonly #stopOnInvalidToken: boolean;
    readonly #maxQueueWait?: number;
    /** Invalid responses per minute, for the last ten minutes. */
    readonly #invalid = new Array<number>(10).fill(0);
    #invalidMinute = 0;
    #drained?: Promise<void>;
    /** Rate-limit state: when a request may go out, what a response says. */
    readonly #limiter: RateLimiter;
    /** Per-bucket ordering. */
    readonly #scheduler: RequestScheduler;
    /** One HTTP attempt, with timeout and cancellation. */
    readonly #transport: HttpTransport;
    /** Response payload and error metadata. */
    readonly #decoder = new ResponseDecoder();
    #hooks: RESTHooks = {};
    /** Whether requests on a known bucket may run concurrently. */
    readonly #concurrentBuckets: boolean;
    /** Creates a REST transport. @param options Transport configuration. @throws {TypeError} If retry configuration is invalid. */
    public constructor(
        options: {
            token?: string;
            timeout?: number;
            retries?: number;
            retryPolicy?: RetryPolicy;
            baseURL?: string;
            /** Allow a cleartext `http://` base URL on a network you trust (a REST proxy). Default false. */
            allowInsecureBaseURL?: boolean;
            hooks?: RESTHooks;
            store?: RateLimitStore;
            /** Replaces the HTTP stage, e.g. with a recording transport in tests. */
            transport?: HttpTransport;
            /**
             * Lets requests on a bucket whose limit is known run concurrently, up
             * to its `remaining` allowance, instead of one at a time. Requires a
             * store with `reserve`. Requests on one bucket may then complete out
             * of order (e.g. messages to one channel). Defaults to `true`.
             */
            concurrentBuckets?: boolean;
            /**
             * The longest, in ms, that a rate-limit header from the server may
             * make this client wait. A `Retry-After` beyond it fails the request
             * with the 429 instead of sleeping, and stored limits are capped to it,
             * so a proxy or an attacker cannot stall every request for hours.
             * Default 600,000 (ten minutes).
             */
            maxBackoff?: number;
            /**
             * Receives telemetry events (latency, 429s by scope, waits,
             * reservations, retries, cancellations, queue depth). See
             * `RESTMetrics` for a ready-made aggregator.
             */
            telemetry?: RESTTelemetry;
            /** Most requests waiting for a bucket slot; more fail with kind `"overloaded"`. Default unlimited. */
            maxQueued?: number;
            /** Most requests waiting on one bucket; more fail with kind `"overloaded"`. Default unlimited. */
            maxQueuedPerBucket?: number;
            /**
             * Requests per second this bot may send across all buckets,
             * enforced before Discord answers with a global 429 (shared through
             * the store, so it holds for every process). Default 50, Discord's
             * global limit; set what Discord granted a large bot, or `false`
             * to rely on 429s alone.
             */
            globalLimit?: number | false;
            /**
             * After a `401` on a bot route, refuse every later request with
             * this token without sending it, until `setToken()`: repeated 401s
             * count towards Discord's invalid-request ban. Default `true`.
             */
            stopOnInvalidToken?: boolean;
            /**
             * Longest, in ms, a request may wait before it is sent (queue,
             * rate limits, pauses between retries); past it the request fails
             * with kind `"overloaded"`. Default unlimited. Per request:
             * `maxQueueWait` in the request options.
             */
            maxQueueWait?: number;
        } = {},
    ) {
        this.#token = options.token;
        this.#fingerprint = options.token
            ? tokenFingerprint(options.token)
            : undefined;
        this.#telemetry = options.telemetry;
        this.#scheduler = new RequestScheduler({
            maxQueued: options.maxQueued,
            maxQueuedPerBucket: options.maxQueuedPerBucket,
        });
        this.#retryPolicy =
            options.retryPolicy ?? createRetryPolicy(options.retries ?? 2);
        this.#transport =
            options.transport ??
            new HttpTransport({
                baseURL: options.baseURL,
                allowInsecureBaseURL: options.allowInsecureBaseURL,
                timeout: options.timeout,
            });
        const store = options.store ?? new MemoryRateLimitStore();
        this.#concurrentBuckets =
            (options.concurrentBuckets ?? true) &&
            typeof store.reserve === "function";
        this.#limiter = new RateLimiter(store, {
            concurrent: this.#concurrentBuckets,
            maxBackoff: options.maxBackoff,
            // A probe holds an unknown bucket for as long as its attempt can
            // take, so a second one cannot start while it is still out.
            probeMs:
                this.#transport.timeout > 0
                    ? this.#transport.timeout + 1000
                    : undefined,
            telemetry: options.telemetry,
            globalLimit:
                options.globalLimit === false
                    ? undefined
                    : (options.globalLimit ?? 50),
        });
        this.#stopOnInvalidToken = options.stopOnInvalidToken ?? true;
        this.#maxQueueWait = checkWait(options.maxQueueWait);
        if (options.hooks) this.#hooks = options.hooks;
    }
    /** The rate-limit store backing this transport. */
    public get store(): RateLimitStore {
        return this.#limiter.store;
    }
    /** Replaces the current hook set. Pass an empty object to clear all hooks. */
    public setHooks(hooks: RESTHooks): this {
        this.#hooks = hooks;
        return this;
    }
    /** Sets the authentication token. @param token Discord bot token. @returns Nothing. @throws {TypeError} If token is empty. */
    public setToken(token: string): void {
        if (!token.trim())
            throw new TypeError("A Discord bot token is required.");
        this.#token = token;
        this.#fingerprint = tokenFingerprint(token);
        this.#rejected = undefined;
    }
    /** The client's current state. */
    public diagnostics(): RESTDiagnostics {
        const store = this.#limiter.store as { mode?: CoordinationMode };
        return {
            mode:
                store.mode ??
                (store instanceof MemoryRateLimitStore
                    ? "local"
                    : "distributed"),
            queued: this.#scheduler.queued,
            inFlight: this.#inFlight,
            buckets: this.#scheduler.size,
            closed: this.#closing.signal.aborted,
            invalidRequests: this.#invalidCount(0),
            tokenRejected:
                this.#rejected !== undefined &&
                this.#rejected === this.#fingerprint,
        };
    }
    /**
     * Stops the client: new requests are refused, requests still queued or
     * waiting for a limit fail with kind `"aborted"`, and attempts already
     * sent are allowed to finish. Resolves when nothing is in flight.
     */
    public async close(): Promise<void> {
        if (!this.#closing.signal.aborted)
            this.#closing.abort(new Error("The REST client was closed."));
        if (this.#inFlight === 0) return;
        this.#drained ??= new Promise<void>((resolve) => {
            this.#idle = resolve;
        });
        await this.#drained;
    }
    /** Adds to and returns the invalid responses of the last ten minutes. */
    #invalidCount(add: number): number {
        const minute = Math.floor(Date.now() / 60_000);
        const elapsed = Math.min(10, minute - this.#invalidMinute);
        for (let i = 1; i <= elapsed; i++)
            this.#invalid[(this.#invalidMinute + i) % 10] = 0;
        if (elapsed > 0) this.#invalidMinute = minute;
        this.#invalid[minute % 10]! += add;
        return this.#invalid.reduce((a, b) => a + b, 0);
    }
    #queueChanged(): void {
        emitTelemetry(this.#telemetry, {
            type: "queue",
            queued: this.#scheduler.queued,
            inFlight: this.#inFlight,
        });
    }
    /** Executes an HTTP request with Discord bucket/global rate limits, retry handling, and AbortSignal support.
     * Accepts a JSON body, a FormData body (for file uploads), or undefined.
     * @param method HTTP method.
     * @param path API path.
     * @param body Optional JSON body, FormData for file uploads, or undefined.
     * @param options Request options: cancellation `signal`, `query`, `headers`,
     *   `reason`, `auth`, and `files` (which upgrade to multipart).
     * @returns Decoded response body.
     * @throws {RESTError} If Discord or transport rejects the request.
     */
    public async request<T>(
        method: string,
        path: string,
        body?: unknown,
        options: RequestData = {},
    ): Promise<T> {
        if (typeof method !== "string" || !method.toUpperCase())
            throw new TypeError("REST method is required.");
        if (typeof path !== "string" || !path.startsWith("/"))
            throw new TypeError("REST paths must start with '/'.");
        assertSafePath(path);
        const route = createRouteKey(method, path);
        // Upgrade to multipart when file attachments are supplied via options.
        const files = options.files;
        if (files && files.length > 0 && !(body instanceof FormData))
            body = this.#fileForm(
                body,
                await Promise.all(
                    files.map(async (file) => ({
                        ...file,
                        data: await file.data,
                    })),
                ),
            );
        const query = serializeQuery(options.query);
        const requestPath = query ? `${path}${query}` : path;
        if (this.#closing.signal.aborted)
            throw abortError(path, this.#closing.signal.reason);
        const identity = requestIdentity(
            path,
            options.auth !== false && this.#token
                ? this.#fingerprint
                : undefined,
        );
        if (
            identity.bucket === this.#fingerprint &&
            this.#rejected === this.#fingerprint
        )
            throw new RESTError(
                "Discord rejected this bot token (401); request not sent. Call setToken() with a valid token.",
                401,
                undefined,
                undefined,
                { method: route.method, path, kind: "authentication" },
            );
        // Waits end on the caller's signal or on close(); a sent attempt only
        // on the caller's signal.
        const queueWait = checkWait(options.maxQueueWait) ?? this.#maxQueueWait;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const sources = [this.#closing.signal];
        if (options.signal) sources.push(options.signal);
        if (queueWait !== undefined) {
            const expired = new AbortController();
            deadline = setTimeout(
                () => expired.abort(new QueueWaitExceeded(queueWait)),
                queueWait,
            );
            sources.push(expired.signal);
        }
        const waitSignal =
            sources.length === 1 ? sources[0]! : AbortSignal.any(sources);
        const state = { attempts: 0, status: 0 };
        const started = performance.now();
        this.#inFlight++;
        this.#queueChanged();

        // Discord scopes a rate limit by (bucket hash, major parameter): two
        // channels sharing an endpoint have independent limits, while two
        // different routes can share one hash. The key is therefore resolved
        // again once the slot is acquired, so a request that queued under its
        // route-derived key joins the shared bucket's queue if one was
        // discovered while it waited.
        try {
            return await this.#scheduler.runResolved(
                () =>
                    this.#limiter.resolveBucketKey(
                        route.route,
                        route.major,
                        identity.bucket,
                    ),
                waitSignal,
                path,
                (bucketKey, release) => {
                    this.#queueChanged();
                    return this.#attempts<T>(
                        route,
                        requestPath,
                        body,
                        options,
                        { identity, waitSignal, state },
                        bucketKey,
                        release,
                    );
                },
            );
        } catch (caught) {
            let error = caught;
            if (
                error instanceof RESTError &&
                error.kind === "aborted" &&
                error.cause instanceof QueueWaitExceeded
            )
                error = new RESTError(
                    `The request waited longer than maxQueueWait (${error.cause.ms}ms) before it could be sent.`,
                    0,
                    undefined,
                    undefined,
                    { method: route.method, path, kind: "overloaded" },
                );
            if (error instanceof RESTError) {
                if (error.kind === "aborted" && state.attempts === 0)
                    emitTelemetry(this.#telemetry, {
                        type: "cancelled",
                        stage: "queued",
                    });
                else if (error.kind === "overloaded")
                    emitTelemetry(this.#telemetry, { type: "overloaded" });
                if (state.status === 0) state.status = error.status;
            }
            throw error;
        } finally {
            clearTimeout(deadline);
            emitTelemetry(this.#telemetry, {
                type: "request",
                method: route.method,
                route: route.route,
                status: state.status,
                attempts: state.attempts,
                durationMs: performance.now() - started,
                ok: state.status >= 200 && state.status < 300,
            });
            if (--this.#inFlight === 0 && this.#idle) {
                this.#idle();
                this.#idle = undefined;
                this.#drained = undefined;
            }
            this.#queueChanged();
        }
    }
    /**
     * Runs the retry loop for one scheduled request: acquire limits, send,
     * record what the response says, decode, and decide whether to try again.
     */
    async #attempts<T>(
        route: RouteKey,
        requestPath: string,
        body: unknown,
        options: RequestData,
        context: {
            identity: RequestIdentity;
            waitSignal: AbortSignal;
            state: { attempts: number; status: number };
        },
        initialBucketKey: string,
        release: () => void,
    ): Promise<T> {
        const { method, path } = route;
        const { identity, waitSignal, state } = context;
        const label = route.route;
        let bucketKey = initialBucketKey;
        for (
            let attempt = 0;
            attempt <= this.#retryPolicy.maxRetries;
            attempt++
        ) {
            let grant: Grant;
            try {
                grant = await this.#limiter.acquire(
                    bucketKey,
                    waitSignal,
                    path,
                    {
                        global: identity.global,
                        resolve: () =>
                            this.#limiter.resolveBucketKey(
                                route.route,
                                route.major,
                                identity.bucket,
                            ),
                    },
                );
                if (grant.key) bucketKey = grant.key;
            } catch (error) {
                if (error instanceof RESTError && error.kind === "aborted")
                    emitTelemetry(this.#telemetry, {
                        type: "cancelled",
                        stage: "waiting",
                    });
                throw error;
            }
            // The reservation already claimed this request's unit, so once the
            // bucket's limit is known the next request need not wait for our
            // response. An unknown bucket stays serial until a response
            // reveals its limit.
            if (this.#concurrentBuckets && grant.known) release();
            if (waitSignal.aborted) {
                // Never sent: the unit goes back to its window.
                await this.#limiter.releaseGrant(bucketKey, grant, true);
                emitTelemetry(this.#telemetry, {
                    type: "cancelled",
                    stage: "waiting",
                });
                throw abortError(path, waitSignal.reason);
            }
            this.#emit(this.#hooks.onRequest, { method, path, attempt });
            state.attempts = attempt + 1;
            const requestStart = Date.now();
            let response: Response;
            try {
                response = await this.#transport.send({
                    method,
                    path: requestPath,
                    headers: this.#headers(body, options),
                    body: this.#encodeBody(body),
                    signal: options.signal,
                });
            } catch (error) {
                // No response: the request may or may not have reached
                // Discord, so its unit stays spent; only a probe placeholder
                // (or a request refused before it left) gives anything back.
                const notSent =
                    error instanceof RESTError && error.kind === "aborted";
                await this.#limiter.releaseGrant(bucketKey, grant, notSent);
                if (error instanceof RESTError) {
                    if (error.kind === "aborted")
                        emitTelemetry(this.#telemetry, {
                            type: "cancelled",
                            stage: "transport",
                        });
                    throw error;
                }
                if (options.signal?.aborted) {
                    emitTelemetry(this.#telemetry, {
                        type: "cancelled",
                        stage: "transport",
                    });
                    throw abortError(path, options.signal.reason);
                }
                const failure =
                    error instanceof TransportError
                        ? error
                        : new TransportError(
                              "Discord REST request failed",
                              false,
                              sanitizeCause(error),
                          );
                emitTelemetry(this.#telemetry, {
                    type: "networkError",
                    timedOut: failure.timedOut,
                });
                if (
                    !failure.timedOut &&
                    attempt < this.#retryPolicy.maxRetries &&
                    this.#retryPolicy.shouldRetry(method, 0)
                ) {
                    const delay = this.#retryPolicy.getDelay(attempt);
                    // Status 0: the retry follows a network failure, not a response.
                    this.#emit(this.#hooks.onRetry, {
                        method,
                        path,
                        attempt,
                        status: 0,
                        delayMs: delay,
                    });
                    emitTelemetry(this.#telemetry, {
                        type: "retry",
                        route: label,
                        reason: "network",
                        attempt,
                    });
                    await this.#retrySleep(delay, waitSignal, path);
                    continue;
                }
                throw new RESTError(failure.message, 0, undefined, undefined, {
                    method,
                    path,
                    cause: failure.cause ?? failure,
                    kind: failure.timedOut ? "timeout" : "network",
                });
            }
            state.status = response.status;
            if (
                response.status === 401 ||
                response.status === 403 ||
                (response.status === 429 &&
                    response.headers.get("X-RateLimit-Scope") !== "shared")
            )
                this.#invalidCount(1);
            if (
                response.status === 401 &&
                this.#stopOnInvalidToken &&
                identity.bucket === this.#fingerprint
            ) {
                this.#rejected = this.#fingerprint;
                emitTelemetry(this.#telemetry, { type: "tokenRejected" });
            }
            const durationMs = Date.now() - requestStart;
            this.#emit(this.#hooks.onResponse, {
                method,
                path,
                status: response.status,
                durationMs,
            });
            emitTelemetry(this.#telemetry, {
                type: "response",
                method,
                route: label,
                status: response.status,
                durationMs,
            });
            const payload = await this.#decoder.read(response);
            const data = response.ok ? {} : this.#decoder.errorData(payload);
            bucketKey = await this.#limiter.applyResponse(
                response,
                bucketKey,
                route.route,
                route.major,
                {
                    identity: identity.bucket,
                    global: identity.global,
                    body: data,
                    grant,
                },
            );
            if (response.ok)
                return (response.status === 204 ? undefined : payload) as T;

            const limited = response.status === 429;
            const retryAfterMs = limited
                ? this.#limiter.retryAfterMs(response, data)
                : undefined;
            // Fire for ANY 429, including a global limit that arrives without a
            // Retry-After header (one second is assumed then).
            if (limited) {
                const global =
                    data.global === true ||
                    response.headers.get("X-RateLimit-Global") === "true";
                const scope = response.headers
                    .get("X-RateLimit-Scope")
                    ?.toLowerCase();
                emitTelemetry(this.#telemetry, {
                    type: "rateLimited",
                    route: label,
                    scope: global
                        ? "global"
                        : scope === "user" || scope === "shared"
                          ? scope
                          : "unknown",
                    retryAfterMs: retryAfterMs!,
                });
                this.#emit(this.#hooks.onRateLimit, {
                    method,
                    path,
                    retryAfterMs: retryAfterMs!,
                    global,
                    bucket:
                        response.headers.get("X-RateLimit-Bucket") ??
                        (await this.#limiter.store.getBucketHash(route.route)),
                });
            }
            if (
                attempt < this.#retryPolicy.maxRetries &&
                this.#retryPolicy.shouldRetry(method, response.status)
            ) {
                const delay = this.#retryPolicy.getDelay(
                    attempt,
                    limited ? retryAfterMs! / 1000 : undefined,
                );
                if (delay > this.#limiter.maxBackoff)
                    throw new RESTError(
                        `Discord asked to wait ${Math.ceil(delay / 1000)}s before retrying, longer than maxBackoff (${Math.ceil(this.#limiter.maxBackoff / 1000)}s).`,
                        response.status,
                        data.code,
                        payload,
                        { method, path },
                    );
                this.#emit(this.#hooks.onRetry, {
                    method,
                    path,
                    attempt,
                    status: response.status,
                    delayMs: delay,
                });
                emitTelemetry(this.#telemetry, {
                    type: "retry",
                    route: label,
                    reason: limited ? "rateLimited" : "server",
                    attempt,
                });
                // A 429's wait is now in the limiter's state, where every
                // request on the bucket (in every process) honours it; the
                // next acquire waits it out. Sleep only what the retry policy
                // adds on top.
                await this.#retrySleep(
                    limited ? delay - retryAfterMs! : delay,
                    waitSignal,
                    path,
                );
                continue;
            }
            throw new RESTError(
                data.message ??
                    response.statusText ??
                    `Discord REST request failed with status ${response.status}`,
                response.status,
                data.code,
                payload,
                { method, path },
            );
        }
        throw new RESTError(
            "Discord REST request exhausted its retry attempts",
            0,
            undefined,
            undefined,
            { method, path },
        );
    }
    /** The pause between attempts, reported as a cancellation when cut short. */
    async #retrySleep(
        delay: number,
        signal: AbortSignal,
        path: string,
    ): Promise<void> {
        try {
            await sleep(delay, signal, path);
        } catch (error) {
            emitTelemetry(this.#telemetry, {
                type: "cancelled",
                stage: "retry",
            });
            throw error;
        }
    }
    /** Builds the header set for one attempt; library headers win over caller headers. */
    #headers(body: unknown, options: RequestData): Record<string, string> {
        const isFormData =
            typeof FormData !== "undefined" && body instanceof FormData;
        const headers: Record<string, string> = { ...options.headers };
        // Header names are case-insensitive: drop the caller's spelling first,
        // or `authorization` and `Authorization` are joined into one value.
        const set = (name: string, value: string): void => {
            for (const key of Object.keys(headers))
                if (key.toLowerCase() === name.toLowerCase())
                    delete headers[key];
            headers[name] = value;
        };
        if (options.auth !== false && this.#token)
            set("Authorization", `Bot ${this.#token}`);
        set("User-Agent", USER_AGENT);
        if (options.reason !== undefined)
            set("X-Audit-Log-Reason", encodeURIComponent(options.reason));
        if (!isFormData) set("Content-Type", "application/json");
        return headers;
    }
    /** Encodes a body as multipart (passed through) or JSON. */
    #encodeBody(body: unknown): BodyInit | undefined {
        if (typeof FormData !== "undefined" && body instanceof FormData)
            return body;
        return body === undefined ? undefined : JSON.stringify(body);
    }
    /** Sends a GET request. @param path API path. @param options Request options (`query`, `headers`, `signal`, …). @returns Decoded response. @throws {RESTError} When the request fails. */
    public get<T>(path: string, options?: RequestData): Promise<T> {
        return this.request<T>("GET", path, options?.body, options);
    }
    /** Sends a POST request. @param path API path. @param body Optional JSON body. @param options Request options (`files`, `reason`, `query`, `headers`, `signal`, …). @returns Decoded response. @throws {RESTError} When the request fails. */
    public post<T>(
        path: string,
        body?: unknown,
        options?: RequestData,
    ): Promise<T> {
        const removed = wrapperError("post", body);
        if (removed) return Promise.reject(removed);
        return this.request<T>("POST", path, body, options);
    }
    /** Sends a PATCH request. @param path API path. @param body Optional JSON body. @param options Request options (`files`, `reason`, `query`, `headers`, `signal`, …). @returns Decoded response. @throws {RESTError} When the request fails. */
    public patch<T>(
        path: string,
        body?: unknown,
        options?: RequestData,
    ): Promise<T> {
        const removed = wrapperError("patch", body);
        if (removed) return Promise.reject(removed);
        return this.request<T>("PATCH", path, body, options);
    }
    /** Sends a PUT request. @param path API path. @param body Optional JSON body. @param options Request options (`files`, `reason`, `query`, `headers`, `signal`, …). @returns Decoded response. @throws {RESTError} When the request fails. */
    public put<T>(
        path: string,
        body?: unknown,
        options?: RequestData,
    ): Promise<T> {
        const removed = wrapperError("put", body);
        if (removed) return Promise.reject(removed);
        return this.request<T>("PUT", path, body, options);
    }
    /** Sends a DELETE request. @param path API path. @param options Request options (`reason`, `headers`, `signal`, …). @returns Decoded response. @throws {RESTError} When the request fails. */
    public delete<T>(path: string, options?: RequestData): Promise<T> {
        return this.request<T>("DELETE", path, options?.body, options);
    }
    /**
     * Builds a multipart form with a JSON payload and file attachments.
     */
    #fileForm(
        payload: unknown,
        files: (RESTFileAttachment & {
            data: Blob | Uint8Array | ArrayBuffer;
        })[],
    ): FormData {
        const form = new FormData();
        form.append("payload_json", JSON.stringify(payload));
        for (let i = 0; i < files.length; i++) {
            const file = files[i]!;
            const blob =
                file.data instanceof Blob
                    ? file.data
                    : new Blob([file.data as ArrayBuffer], {
                          type: file.contentType ?? "application/octet-stream",
                      });
            form.append(
                `files[${i}]`,
                blob,
                file.name.replace(/[\r\n"\\]/g, "_"),
            );
        }
        return form;
    }

    /**
     * Sends a multipart/form-data POST request for file uploads.
     * Attaches a JSON payload as `payload_json` and files as additional fields.
     * @param path API path.
     * @param payload JSON payload (e.g. message content, embeds).
     * @param files Array of file attachments.
     * @param options Cancellation options.
     * @returns Decoded response.
     * @throws {RESTError} When the request fails.
     */
    public postWithFiles<T>(
        path: string,
        payload: unknown,
        files: RESTFileAttachment[],
        options?: RESTRequestOptions,
    ): Promise<T> {
        return this.request<T>("POST", path, payload, { ...options, files });
    }

    /**
     * Sends a multipart/form-data PATCH request for editing messages with files.
     * @param path API path.
     * @param payload JSON payload.
     * @param files Array of file attachments.
     * @param options Cancellation options.
     * @returns Decoded response.
     * @throws {RESTError} When the request fails.
     */
    public patchWithFiles<T>(
        path: string,
        payload: unknown,
        files: RESTFileAttachment[],
        options?: RESTRequestOptions,
    ): Promise<T> {
        return this.request<T>("PATCH", path, payload, { ...options, files });
    }
    /** Dispatches a lifecycle hook in isolation: deferred to a microtask so it
     * cannot block the request path, with any thrown error swallowed so a faulty
     * hook cannot reject the request. @param hook Optional callback. @param ctx Event context. */
    #emit<C>(hook: ((ctx: C) => void) | undefined, ctx: C): void {
        if (!hook) return;
        const withPath = ctx as { path?: unknown };
        if (typeof withPath.path === "string")
            ctx = { ...ctx, path: redactPath(withPath.path) };
        Promise.resolve()
            .then(() => hook(ctx))
            .catch(() => {});
    }
}

export { Routes } from "./routes.js";
export {
    RESTError,
    abortError,
    redactPath,
    type RESTErrorKind,
} from "./errors.js";
export { RESTErrorCode } from "./error-codes.js";
export {
    createRouteKey,
    normalizeRoutePath,
    majorParameter,
    scopeBucket,
    serializeQuery,
    type RouteKey,
    type RESTQuery,
} from "./route.js";
export { RequestScheduler, type SchedulerOptions } from "./scheduler.js";
export {
    RateLimiter,
    DEFAULT_MAX_BACKOFF_MS,
    type Grant,
    type ApplyResponseOptions,
} from "./limiter.js";
export {
    parseRateLimitHeaders,
    headerNumber,
    type RateLimitHeaders,
    type RateLimitScope,
} from "./headers.js";
export {
    requestIdentity,
    tokenFingerprint,
    type RequestIdentity,
} from "./identity.js";
export {
    RESTMetrics,
    type RESTMetricsSnapshot,
    type RESTTelemetry,
    type RESTTelemetryEvent,
    type CoordinationMode,
} from "./telemetry.js";
export {
    HttpTransport,
    TransportError,
    type TransportRequest,
    type FetchLike,
} from "./transport.js";
export { ResponseDecoder, type DecodedError } from "./decoder.js";
export {
    type RateLimitStore,
    type BucketState,
    type BucketUpdate,
    type Reservation,
    type ReserveOptions,
    MemoryRateLimitStore,
} from "./store.js";
export {
    RedisRateLimitStore,
    fromBunRedis,
    type RedisRateLimitStoreOptions,
    type RedisFailurePolicy,
    type RedisStoreDiagnostics,
    type MinimalRedisClient,
} from "./redis.js";

export {
    WebhookClient,
    type WebhookClientOptions,
    type WebhookMessageOptions,
} from "./webhook.js";
