/** Library version and source URL used for the Discord-compliant User-Agent. */
import packageJson from "../package.json" with { type: "json" };
const LIBRARY_VERSION = packageJson.version;
const LIBRARY_URL = "https://github.com/Ekretos/lunibee";
const USER_AGENT = `DiscordBot (${LIBRARY_URL}, ${packageJson.version})`;

import {
    MemoryRateLimitStore,
    type RateLimitStore,
    type BucketState,
} from "./store.js";
import { RESTError, abortError, sleep } from "./errors.js";
import {
    createRouteKey,
    serializeQuery,
    type RESTQuery,
    type RouteKey,
} from "./route.js";
import { RequestScheduler } from "./scheduler.js";
import { RateLimiter } from "./limiter.js";
import { HttpTransport, TransportError } from "./transport.js";
import { ResponseDecoder } from "./decoder.js";

/** Internal state shared by requests mapped to one Discord rate-limit bucket. */
type Bucket = { remaining: number; resetAt: number };
/** A file attachment sent as part of a multipart REST request. */
export interface RESTFileAttachment {
    name: string;
    data: Blob | Uint8Array | ArrayBuffer;
    contentType?: string;
}

/**
 * Options controlling an individual REST request.
 *
 * Lunibee's canonical call shape is positional (`post(path, body)`); these options
 * add the Discord.js-`@discordjs/rest`-familiar per-request knobs (`query`, `headers`,
 * `reason`, `auth`) additively without changing that positional default.
 */
export interface RESTRequestOptions {
    /** Abort signal used to cancel the request and any queued wait. */ signal?: AbortSignal;
    /** Query-string appended to the path (`URLSearchParams`, a record, or a raw string). */ query?: RESTQuery;
    /** Extra request headers merged in (library headers such as `Authorization` win). */ headers?: Record<
        string,
        string
    >;
    /** Audit-log reason, sent as the `X-Audit-Log-Reason` header. */ reason?: string;
    /** Set `false` to omit the `Authorization` header for this request. Defaults to `true`. */ auth?: boolean;
}

/**
 * Discord.js-familiar request payload. Superset of {@link RESTRequestOptions} that also
 * carries the `body` and `files`, matching `@discordjs/rest`'s `RequestData`. It powers the
 * additive `method(path, { body })` overloads without breaking the positional signature.
 */
export interface RequestData extends RESTRequestOptions {
    /** Request body. Encoded as JSON unless `files` are present (then multipart). */ body?: unknown;
    /** File attachments; presence upgrades the request to `multipart/form-data`. */ files?: RESTFileAttachment[];
}

/** Keys recognised on a {@link RequestData} wrapper, used to disambiguate it from a raw body. */
const REQUEST_DATA_KEYS = new Set([
    "body",
    "files",
    "query",
    "headers",
    "reason",
    "auth",
    "signal",
]);

/**
 * Detects a Discord.js-style `RequestData` wrapper so verb helpers can accept both
 * `post(path, rawBody)` (Lunibee-canonical) and `post(path, { body })` (Discord.js-familiar).
 * Conservative by design: only a plain object whose every own key is a known `RequestData`
 * key counts — a raw Discord payload (which always carries entity keys like `content`/`name`)
 * never matches, so existing positional callers are unaffected.
 */
function isRequestData(value: unknown): value is RequestData {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    if (typeof FormData !== "undefined" && value instanceof FormData)
        return false;
    if (
        value instanceof Blob ||
        value instanceof Uint8Array ||
        value instanceof ArrayBuffer
    )
        return false;
    const keys = Object.keys(value);
    if (keys.length === 0) return false;
    return keys.every((key) => REQUEST_DATA_KEYS.has(key));
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
    /** Maximum retry attempts. */ maxRetries: number;
    /** Determines whether a request may be retried. @param method HTTP method. @param status HTTP status, or zero for transport errors. @returns True when retrying is safe under the policy. */ shouldRetry(
        method: string,
        status: number,
    ): boolean;
    /** Calculates delay before the next attempt. @param attempt Zero-based retry number. @param retryAfter Server-provided delay, when available. @returns Delay in milliseconds. */ getDelay(
        attempt: number,
        retryAfter?: number,
    ): number;
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

/** Bun-native REST transport with Discord bucket-aware rate limiting, retries, and cancellation. */
export class REST {
    readonly #retryPolicy: RetryPolicy;
    #token?: string;
    /** Rate-limit state: when a request may go out, what a response says. */
    readonly #limiter: RateLimiter;
    /** Per-bucket ordering. */
    readonly #scheduler = new RequestScheduler();
    /** One HTTP attempt, with timeout and cancellation. */
    readonly #transport: HttpTransport;
    /** Response payload and error metadata. */
    readonly #decoder = new ResponseDecoder();
    #hooks: RESTHooks = {};
    /** Creates a REST transport. @param options Transport configuration. @throws {TypeError} If retry configuration is invalid. */
    public constructor(
        options: {
            token?: string;
            timeout?: number;
            retries?: number;
            retryPolicy?: RetryPolicy;
            baseURL?: string;
            hooks?: RESTHooks;
            store?: RateLimitStore;
            /** Replaces the HTTP stage, e.g. with a recording transport in tests. */
            transport?: HttpTransport;
        } = {},
    ) {
        this.#token = options.token;
        this.#retryPolicy =
            options.retryPolicy ?? createRetryPolicy(options.retries ?? 2);
        this.#transport =
            options.transport ??
            new HttpTransport({
                baseURL: options.baseURL,
                timeout: options.timeout,
            });
        this.#limiter = new RateLimiter(
            options.store ?? new MemoryRateLimitStore(),
        );
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
    }
    /** Executes an HTTP request with Discord bucket/global rate limits, retry handling, and AbortSignal support.
     * Accepts a JSON body, a FormData body (for file uploads), or undefined.
     * @param method HTTP method.
     * @param path API path.
     * @param body Optional JSON body, FormData for file uploads, or undefined.
     * @param options Request options: cancellation `signal` plus the Discord.js-familiar
     *   `query`, `headers`, `reason`, `auth`, and `files` (which upgrade to multipart).
     * @returns Decoded response body.
     * @throws {RESTError} If Discord or transport rejects the request.
     */
    public async request<T>(
        method: string,
        path: string,
        body?: unknown,
        options: RequestData = {},
    ): Promise<T> {
        if (!method.toUpperCase())
            throw new TypeError("REST method is required.");
        if (!path.startsWith("/"))
            throw new TypeError("REST paths must start with '/'.");
        const route = createRouteKey(method, path);
        // Upgrade to multipart when file attachments are supplied via options.
        const files = options.files;
        if (files && files.length > 0 && !(body instanceof FormData))
            body = this.#fileForm(body, files);
        const query = serializeQuery(options.query);
        const requestPath = query ? `${path}${query}` : path;

        // Discord scopes a rate limit by (bucket hash, major parameter): two
        // channels sharing an endpoint have independent limits, while two
        // different routes can share one hash. The key is therefore resolved
        // again once the slot is acquired, so a request that queued under its
        // route-derived key joins the shared bucket's queue if one was
        // discovered while it waited.
        return this.#scheduler.runResolved(
            () => this.#limiter.resolveBucketKey(route.route, route.major),
            options.signal,
            path,
            (bucketKey) =>
                this.#attempts<T>(route, requestPath, body, options, bucketKey),
        );
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
        initialBucketKey: string,
    ): Promise<T> {
        const { method, path } = route;
        let bucketKey = initialBucketKey;
        for (
            let attempt = 0;
            attempt <= this.#retryPolicy.maxRetries;
            attempt++
        ) {
            await this.#limiter.acquire(bucketKey, options.signal, path);
            this.#emit(this.#hooks.onRequest, { method, path, attempt });
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
                if (error instanceof RESTError) throw error;
                if (options.signal?.aborted)
                    throw abortError(path, options.signal.reason);
                const failure =
                    error instanceof TransportError
                        ? error
                        : new TransportError(
                              "Discord REST request failed",
                              false,
                              error,
                          );
                if (
                    !failure.timedOut &&
                    attempt < this.#retryPolicy.maxRetries &&
                    this.#retryPolicy.shouldRetry(method, 0)
                ) {
                    await sleep(
                        this.#retryPolicy.getDelay(attempt),
                        options.signal,
                        path,
                    );
                    continue;
                }
                throw new RESTError(failure.message, 0, undefined, undefined, {
                    method,
                    path,
                    cause: failure.cause ?? failure,
                });
            }
            this.#emit(this.#hooks.onResponse, {
                method,
                path,
                status: response.status,
                durationMs: Date.now() - requestStart,
            });
            bucketKey = await this.#limiter.applyResponse(
                response,
                bucketKey,
                route.route,
                route.major,
            );
            const payload = await this.#decoder.read(response);
            if (response.ok)
                return (response.status === 204 ? undefined : payload) as T;

            const data = this.#decoder.errorData(payload);
            const retryAfter =
                response.status === 429
                    ? this.#decoder.retryAfter(response, data)
                    : undefined;
            if (data.global && retryAfter !== undefined)
                await this.#limiter.noteGlobalReset(
                    Date.now() + retryAfter * 1000,
                );
            // Fire for ANY 429, including a global limit that arrives without a
            // Retry-After header; fall back to 1s in that case.
            if (response.status === 429)
                this.#emit(this.#hooks.onRateLimit, {
                    method,
                    path,
                    retryAfterMs: (retryAfter ?? 1) * 1000,
                    global: data.global ?? false,
                    bucket: await this.#limiter.store.getBucketHash(
                        route.route,
                    ),
                });
            if (
                attempt < this.#retryPolicy.maxRetries &&
                this.#retryPolicy.shouldRetry(method, response.status)
            ) {
                const delay = this.#retryPolicy.getDelay(attempt, retryAfter);
                this.#emit(this.#hooks.onRetry, {
                    method,
                    path,
                    attempt,
                    status: response.status,
                    delayMs: delay,
                });
                await sleep(delay, options.signal, path);
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
    /** Builds the header set for one attempt; library headers win over caller headers. */
    #headers(body: unknown, options: RequestData): Record<string, string> {
        const isFormData =
            typeof FormData !== "undefined" && body instanceof FormData;
        const headers: Record<string, string> = { ...options.headers };
        if (options.auth !== false && this.#token)
            headers["Authorization"] = `Bot ${this.#token}`;
        headers["User-Agent"] = USER_AGENT;
        if (options.reason !== undefined)
            headers["X-Audit-Log-Reason"] = encodeURIComponent(options.reason);
        if (!isFormData) headers["Content-Type"] = "application/json";
        return headers;
    }
    /** Encodes a body as multipart (passed through) or JSON. */
    #encodeBody(body: unknown): BodyInit | undefined {
        if (typeof FormData !== "undefined" && body instanceof FormData)
            return body;
        return body === undefined ? undefined : JSON.stringify(body);
    }
    /**
     * Normalizes a verb helper's second argument into `(body, options)`.
     * Supports both `verb(path, rawBody, options?)` (Lunibee-canonical positional) and the
     * Discord.js-familiar `verb(path, { body, query, headers, reason, files })` wrapper.
     */
    #dispatch<T>(
        method: string,
        path: string,
        bodyOrOptions?: unknown,
        options?: RequestData,
    ): Promise<T> {
        if (options === undefined && isRequestData(bodyOrOptions))
            return this.request<T>(
                method,
                path,
                bodyOrOptions.body,
                bodyOrOptions,
            );
        return this.request<T>(method, path, bodyOrOptions, options);
    }
    /** Sends a GET request. @param path API path. @param options Request options (`query`, `headers`, `signal`, …). @returns Decoded response. @throws {RESTError} When the request fails. */ public get<
        T,
    >(path: string, options?: RequestData): Promise<T> {
        return this.request<T>("GET", path, options?.body, options);
    }
    /** Sends a POST request. Accepts a raw body (`post(path, body)`) or a Discord.js-familiar `post(path, { body })`. @param path API path. @param body Optional JSON body, or a `RequestData` wrapper. @param options Request options. @returns Decoded response. @throws {RESTError} When the request fails. */
    public post<T>(path: string, options: RequestData): Promise<T>;
    public post<T>(
        path: string,
        body?: unknown,
        options?: RequestData,
    ): Promise<T>;
    public post<T>(
        path: string,
        body?: unknown,
        options?: RequestData,
    ): Promise<T> {
        return this.#dispatch<T>("POST", path, body, options);
    }
    /** Sends a PATCH request. Accepts a raw body (`patch(path, body)`) or a Discord.js-familiar `patch(path, { body })`. @param path API path. @param body Optional JSON body, or a `RequestData` wrapper. @param options Request options. @returns Decoded response. @throws {RESTError} When the request fails. */
    public patch<T>(path: string, options: RequestData): Promise<T>;
    public patch<T>(
        path: string,
        body?: unknown,
        options?: RequestData,
    ): Promise<T>;
    public patch<T>(
        path: string,
        body?: unknown,
        options?: RequestData,
    ): Promise<T> {
        return this.#dispatch<T>("PATCH", path, body, options);
    }
    /** Sends a PUT request. Accepts a raw body (`put(path, body)`) or a Discord.js-familiar `put(path, { body })`. @param path API path. @param body Optional JSON body, or a `RequestData` wrapper. @param options Request options. @returns Decoded response. @throws {RESTError} When the request fails. */
    public put<T>(path: string, options: RequestData): Promise<T>;
    public put<T>(
        path: string,
        body?: unknown,
        options?: RequestData,
    ): Promise<T>;
    public put<T>(
        path: string,
        body?: unknown,
        options?: RequestData,
    ): Promise<T> {
        return this.#dispatch<T>("PUT", path, body, options);
    }
    /** Sends a DELETE request. @param path API path. @param options Request options (`reason`, `headers`, `signal`, …). @returns Decoded response. @throws {RESTError} When the request fails. */ public delete<
        T,
    >(path: string, options?: RequestData): Promise<T> {
        return this.request<T>("DELETE", path, options?.body, options);
    }
    /**
     * Builds a multipart form with a JSON payload and file attachments.
     */
    #fileForm(payload: unknown, files: RESTFileAttachment[]): FormData {
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
            form.append(`files[${i}]`, blob, file.name);
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
        return this.request<T>(
            "POST",
            path,
            this.#fileForm(payload, files),
            options,
        );
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
        return this.request<T>(
            "PATCH",
            path,
            this.#fileForm(payload, files),
            options,
        );
    }
    /** Dispatches a lifecycle hook in isolation: deferred to a microtask so it
     * cannot block the request path, with any thrown error swallowed so a faulty
     * hook cannot reject the request. @param hook Optional callback. @param ctx Event context. */
    #emit<C>(hook: ((ctx: C) => void) | undefined, ctx: C): void {
        if (!hook) return;
        Promise.resolve()
            .then(() => hook(ctx))
            .catch(() => {});
    }
}

export { Routes } from "./routes.js";
export { RESTError, abortError } from "./errors.js";
export {
    createRouteKey,
    normalizeRoutePath,
    majorParameter,
    scopeBucket,
    serializeQuery,
    type RouteKey,
    type RESTQuery,
} from "./route.js";
export { RequestScheduler } from "./scheduler.js";
export { RateLimiter } from "./limiter.js";
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
    type Reservation,
    MemoryRateLimitStore,
} from "./store.js";
export {
    RedisRateLimitStore,
    type RedisRateLimitStoreOptions,
    type MinimalRedisClient,
} from "./redis.js";

export {
    WebhookClient,
    type WebhookClientOptions,
    type WebhookMessageOptions,
} from "./webhook.js";

/**
 * Discord.js-familiar alias for {@link RESTError}. `@discordjs/rest` throws `DiscordAPIError`
 * on a Discord-rejected request; Lunibee keeps `RESTError` as the canonical class and exports
 * this alias so Discord.js-shaped `catch (err) { if (err instanceof DiscordAPIError) … }` works.
 */
export { RESTError as DiscordAPIError };
