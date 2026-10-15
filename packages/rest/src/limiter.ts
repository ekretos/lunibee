import { RESTError, sanitizeCause, sleep } from "./errors.js";
import { parseRateLimitHeaders } from "./headers.js";
import { scopeBucket } from "./route.js";
import {
    DEFAULT_PROBE_MS,
    GLOBAL_WINDOW_MS,
    reconcileState,
    type BucketUpdate,
    type RateLimitStore,
} from "./store.js";
import { emitTelemetry, type RESTTelemetry } from "./telemetry.js";

/** Default for `maxBackoff`: ten minutes. */
export const DEFAULT_MAX_BACKOFF_MS = 600_000;

/** Refusals in a row without a wait before a store is declared broken. */
const MAX_IDLE_REFUSALS = 16;
/** Route-to-hash mappings cached in-process. */
const MAX_CACHED_ROUTES = 10_000;

/** What {@link RateLimiter.acquire} obtained. */
export interface Grant {
    /** A unit was reserved atomically (false for a store without `reserve`). */
    reserved: boolean;
    /** The bucket's limit is known, so further requests need not wait for this one's response. */
    known: boolean;
    /** The window the unit came from (store clock), when the store reports it. */
    resetAt?: number;
}

/** Context for {@link RateLimiter.applyResponse} beyond the response itself. */
export interface ApplyResponseOptions {
    /** Bucket-key prefix of the request's identity (see `requestIdentity`). */
    identity?: string;
    /** Global-limit scope the request counts against, if any. */
    global?: string;
    /** The decoded error body, for `retry_after` and `global` on a 429. */
    body?: { retry_after?: number; global?: boolean };
    /** The grant the request was sent under. */
    grant?: Grant;
}

/**
 * Owns Discord's rate-limit state: when a request may go out, and what a
 * response says about the bucket it landed in.
 *
 * The limiter holds no queueing logic of its own — {@link RequestScheduler}
 * decides ordering — and no HTTP knowledge beyond reading rate-limit headers.
 */
export class RateLimiter {
    readonly #store: RateLimitStore;
    /** The longest wait the limiter will impose on the strength of a server header. */
    readonly #maxBackoff: number;
    readonly #telemetry?: RESTTelemetry;
    readonly #probeMs: number;
    /** Route → bucket hash, learned from this process's own responses or the store. */
    readonly #routes = new Map<string, string>();
    readonly #globalLimit: number;
    /** Per-scope request windows, for stores that cannot count globally themselves. */
    readonly #localGlobal = new Map<string, { start: number; count: number }>();

    /**
     * @param store Rate-limit state store.
     * @param options `maxBackoff`: the most, in ms, that a rate-limit header can
     *   make later requests wait (default 10 minutes). `probeMs`: how long a
     *   request discovering an unknown bucket holds it (default 16 s; keep it
     *   above the transport timeout). `globalLimit`: most requests per second
     *   per global scope, enforced before Discord answers 429 (default none;
     *   `REST` passes 50). `telemetry`: event sink. `concurrent` is
     *   accepted for compatibility: responses are always merged so a late one
     *   cannot raise `remaining`.
     */
    public constructor(
        store: RateLimitStore,
        options: {
            concurrent?: boolean;
            maxBackoff?: number;
            probeMs?: number;
            globalLimit?: number;
            telemetry?: RESTTelemetry;
        } = {},
    ) {
        this.#store = store;
        this.#maxBackoff = options.maxBackoff ?? DEFAULT_MAX_BACKOFF_MS;
        if (!(this.#maxBackoff >= 0))
            throw new RangeError("maxBackoff must be a non-negative number.");
        this.#probeMs = options.probeMs ?? DEFAULT_PROBE_MS;
        if (!(this.#probeMs > 0))
            throw new RangeError("probeMs must be a positive number.");
        this.#telemetry = options.telemetry;
        this.#globalLimit = options.globalLimit ?? 0;
        if (!(this.#globalLimit >= 0) || !Number.isFinite(this.#globalLimit))
            throw new RangeError("globalLimit must be a non-negative number.");
    }

    /** The ceiling on a wait a server header can cause, in ms. */
    public get maxBackoff(): number {
        return this.#maxBackoff;
    }

    /** A wait no longer than `maxBackoff`: a header cannot wedge the limiter. */
    #capWait(ms: number): number {
        return Math.min(Math.max(0, ms), this.#maxBackoff);
    }

    /** The backing store, shared across processes when a distributed store is used. */
    public get store(): RateLimitStore {
        return this.#store;
    }

    /** Whether the backing store can reserve allowance atomically. */
    public get reserves(): boolean {
        return typeof this.#store.reserve === "function";
    }

    #cacheRoute(route: string, hash: string): void {
        this.#routes.delete(route);
        this.#routes.set(route, hash);
        if (this.#routes.size > MAX_CACHED_ROUTES)
            this.#routes.delete(this.#routes.keys().next().value as string);
    }

    /**
     * Resolves the bucket key a request should be gated on. With an
     * `identity`, the key is prefixed by it, so two bots never share a bucket.
     */
    public async resolveBucketKey(
        route: string,
        major: string,
        identity?: string,
    ): Promise<string> {
        // What this major parameter's own responses said wins over what the
        // route said for another one: if hashes ever differ between them, or
        // change, a request is not split across two keys of one bucket.
        let hash =
            this.#routes.get(`${route}\u0000${major}`) ??
            this.#routes.get(route);
        if (hash === undefined) {
            hash = await this.#store.getBucketHash(route);
            if (hash !== undefined) this.#cacheRoute(route, hash);
        }
        const key = scopeBucket(hash ?? route, major);
        return identity === undefined ? key : `${identity}/${key}`;
    }

    /** Runs a store call, turning an unexpected failure into a coordination error. */
    async #call<T>(
        path: string,
        operation: string,
        call: () => Promise<T> | T,
    ): Promise<T> {
        try {
            return await call();
        } catch (error) {
            if (error instanceof RESTError) throw error;
            throw new RESTError(
                `The rate-limit store failed (${operation}); request not sent.`,
                0,
                undefined,
                undefined,
                { path, kind: "coordination", cause: sanitizeCause(error) },
            );
        }
    }

    /**
     * Waits until both the route bucket and the global limit permit sending.
     *
     * When the store supports it, allowance is *reserved* rather than merely
     * observed. Reading `remaining` and deciding to send is a race across
     * workers: three processes all read `remaining: 1` and all send. A
     * reservation hands the unit to exactly one of them. A request is never
     * sent without its reservation: a store that keeps refusing without a
     * wait, or that fails, ends the request with a `"coordination"` error.
     * @throws {RESTError} `"aborted"` on cancellation, `"coordination"` on a
     *   broken store, `"rateLimited"` when waiting would exceed `maxBackoff`.
     */
    public async acquire(
        bucketKey: string,
        signal: AbortSignal | undefined,
        path: string,
        options: { global?: string } = {},
    ): Promise<Grant> {
        const store = this.#store;
        // Callers that name no scope get the default one, as before scopes.
        const global = "global" in options ? options.global : "";
        if (!store.reserve) {
            await this.#waitGlobal(global ?? "", signal, path);
            if (global !== undefined)
                await this.#localGlobalSlot(global, signal, path);
            const bucket = await this.#call(path, "getBucket", () =>
                store.getBucket(bucketKey),
            );
            if (bucket) {
                const delay = bucket.resetAt - Date.now();
                if (bucket.remaining <= 0 && delay > 0)
                    await this.#wait("bucket", delay, signal, path);
            }
            return {
                reserved: false,
                known: !!bucket && bucket.resetAt > Date.now(),
            };
        }
        const started = performance.now();
        let idle = 0;
        for (;;) {
            if (global !== undefined && !store.reservesGlobal) {
                await this.#waitGlobal(global, signal, path);
                await this.#localGlobalSlot(global, signal, path);
            }
            const asked = performance.now();
            const reservation = await this.#call(path, "reserve", () =>
                store.reserve!(bucketKey, {
                    global,
                    probeMs: this.#probeMs,
                    globalLimit: this.#globalLimit || undefined,
                }),
            );
            if (
                !reservation ||
                typeof reservation !== "object" ||
                typeof reservation.granted !== "boolean"
            )
                throw new RESTError(
                    "The rate-limit store returned an invalid reservation; request not sent.",
                    0,
                    undefined,
                    undefined,
                    { path, kind: "coordination" },
                );
            if (reservation.granted) {
                let known = reservation.known;
                // A store that does not say whether the limit is known: look.
                if (known === undefined) {
                    const bucket = await this.#call(path, "getBucket", () =>
                        store.getBucket(bucketKey),
                    );
                    known = !!bucket && bucket.resetAt > Date.now();
                }
                emitTelemetry(this.#telemetry, {
                    type: "reservation",
                    granted: true,
                    known,
                    latencyMs: performance.now() - asked,
                });
                return { reserved: true, known, resetAt: reservation.resetAt };
            }
            emitTelemetry(this.#telemetry, {
                type: "reservation",
                granted: false,
                known: true,
                latencyMs: performance.now() - asked,
            });
            let wait = Number(reservation.retryAfterMs);
            if (!(wait > 0)) {
                // A refusal with no wait is a broken store. Back off a little
                // and give up after a few, rather than spin or send anyway.
                if (++idle > MAX_IDLE_REFUSALS)
                    throw new RESTError(
                        "The rate-limit store keeps refusing without a wait; request not sent.",
                        0,
                        undefined,
                        undefined,
                        { path, kind: "coordination" },
                    );
                wait = Math.min(100, 2 ** idle);
            } else idle = 0;
            // One wait is capped at maxBackoff; a request that keeps losing
            // the race for its bucket gives up at twice that, not never.
            if (performance.now() - started + wait > 2 * this.#maxBackoff)
                throw new RESTError(
                    `Waited for the rate limit longer than twice maxBackoff (${Math.ceil(this.#maxBackoff / 1000)}s); request not sent.`,
                    429,
                    undefined,
                    undefined,
                    { path },
                );
            await this.#wait(
                reservation.reason ?? "bucket",
                wait,
                signal,
                path,
            );
        }
    }

    async #wait(
        reason: "bucket" | "global" | "probe",
        delay: number,
        signal: AbortSignal | undefined,
        path: string,
    ): Promise<void> {
        const ms = Math.min(delay, this.#maxBackoff);
        await sleep(ms, signal, path);
        emitTelemetry(this.#telemetry, {
            type: "wait",
            reason,
            durationMs: ms,
        });
    }

    /**
     * Takes one request of `scope`'s per-second allowance in this process,
     * for a store that cannot count it atomically across processes.
     */
    async #localGlobalSlot(
        scope: string,
        signal: AbortSignal | undefined,
        path: string,
    ): Promise<void> {
        if (!this.#globalLimit) return;
        for (;;) {
            const now = Date.now();
            let window = this.#localGlobal.get(scope);
            if (!window || now - window.start >= GLOBAL_WINDOW_MS) {
                window = { start: now, count: 0 };
                this.#localGlobal.set(scope, window);
                if (this.#localGlobal.size > MAX_CACHED_ROUTES)
                    this.#localGlobal.delete(
                        this.#localGlobal.keys().next().value as string,
                    );
            }
            if (window.count < this.#globalLimit) {
                window.count++;
                return;
            }
            await this.#wait(
                "global",
                window.start + GLOBAL_WINDOW_MS - now,
                signal,
                path,
            );
        }
    }

    async #waitGlobal(
        scope: string,
        signal: AbortSignal | undefined,
        path: string,
    ): Promise<void> {
        const globalDelay =
            (await this.#call(path, "getGlobalReset", () =>
                this.#store.getGlobalReset(scope),
            )) - Date.now();
        if (globalDelay > 0)
            await this.#wait("global", globalDelay, signal, path);
    }

    /**
     * Extends the global limit (of `scope`), never shortening a longer one
     * already recorded. Atomic when the store has `extendGlobalReset`.
     */
    public async noteGlobalReset(resetAt: number, scope = ""): Promise<void> {
        const waitMs = this.#capWait(resetAt - Date.now());
        if (this.#store.extendGlobalReset) {
            await this.#store.extendGlobalReset(scope, waitMs);
            return;
        }
        const current = await this.#store.getGlobalReset(scope);
        const target = Date.now() + waitMs;
        if (target > current) await this.#store.setGlobalReset(target, scope);
    }

    /**
     * How long a 429 asks to wait, in ms: the body's `retry_after`, else the
     * `Retry-After` header, else `X-RateLimit-Reset-After`, else one second.
     * Negative or non-numeric values are ignored, not read as zero.
     */
    public retryAfterMs(
        response: Response,
        body: { retry_after?: number } = {},
    ): number {
        const fromBody = body.retry_after;
        if (
            typeof fromBody === "number" &&
            Number.isFinite(fromBody) &&
            fromBody >= 0
        )
            return fromBody * 1000;
        const headers = parseRateLimitHeaders(response.headers);
        return headers.retryAfterMs ?? headers.resetAfterMs ?? 1000;
    }

    /**
     * Records a response's rate-limit headers and returns the bucket key the
     * request actually belongs to: Discord may reveal a server bucket hash that
     * differs from the route-derived key used before the first response.
     */
    public async applyResponse(
        response: Response,
        bucketKey: string,
        route: string,
        major: string,
        options: ApplyResponseOptions = {},
    ): Promise<string> {
        const headers = parseRateLimitHeaders(response.headers);
        let currentKey = bucketKey;
        if (headers.bucket) {
            const previous = this.#routes.get(route);
            this.#cacheRoute(`${route}\u0000${major}`, headers.bucket);
            if (previous !== headers.bucket) {
                await this.#store.setBucketHash(route, headers.bucket);
                this.#cacheRoute(route, headers.bucket);
                emitTelemetry(this.#telemetry, {
                    type: "bucket",
                    change: previous === undefined ? "discovered" : "remapped",
                    route,
                });
            }
            const key = scopeBucket(headers.bucket, major);
            currentKey =
                options.identity === undefined
                    ? key
                    : `${options.identity}/${key}`;
        }

        const limited = response.status === 429;
        const retryAfterMs = limited
            ? this.#capWait(this.retryAfterMs(response, options.body))
            : undefined;
        const global =
            limited &&
            (options.body?.global === true ||
                headers.global ||
                headers.scope === "global");
        // A global 429 on a request that counts against no global limit (an
        // interaction callback) is recorded on its bucket instead.
        const onGlobal = global && options.global !== undefined;

        let resetAfterMs = headers.resetAfterMs;
        if (resetAfterMs === undefined && headers.resetAtMs !== undefined)
            resetAfterMs = Math.max(0, headers.resetAtMs - Date.now());
        const update: BucketUpdate = {
            remaining: headers.remaining,
            resetAfterMs:
                resetAfterMs === undefined
                    ? undefined
                    : this.#capWait(resetAfterMs),
            limit: headers.limit,
            // The window id orders responses; one far from now (a hostile or
            // broken responder) would make every real response look stale.
            window:
                headers.resetAtMs !== undefined &&
                Math.abs(headers.resetAtMs - Date.now()) <= this.#maxBackoff
                    ? headers.resetAtMs
                    : undefined,
            retryAfterMs: limited && !onGlobal ? retryAfterMs : undefined,
        };
        if (this.#store.reconcile)
            await this.#store.reconcile(currentKey, update);
        else {
            const next = reconcileState(
                await this.#store.getBucket(currentKey),
                update,
                Date.now(),
            );
            if (next === null)
                await this.#store.updateBucket(currentKey, {
                    remaining: 0,
                    resetAt: 0,
                });
            else if (next) await this.#store.updateBucket(currentKey, next);
        }
        // The request probed under its route key and learned the real one:
        // clear the placeholder, so nobody else waits on it.
        if (
            currentKey !== bucketKey &&
            options.grant?.reserved &&
            this.#store.release
        )
            await this.#store.release(bucketKey, options.grant, false);

        if (onGlobal)
            await this.noteGlobalReset(
                Date.now() + retryAfterMs!,
                options.global,
            );
        return currentKey;
    }

    /**
     * Gives back what a grant held when the request did not get a response:
     * a probe placeholder is always cleared; the unit itself is returned only
     * with `notSent` (the request certainly never left), because a request
     * that may have reached Discord may also have spent it.
     */
    public async releaseGrant(
        bucketKey: string,
        grant: Grant,
        notSent: boolean,
    ): Promise<void> {
        if (!grant.reserved || !this.#store.release) return;
        try {
            await this.#store.release(bucketKey, grant, notSent);
        } catch {
            // Best effort: the placeholder expires on its own.
        }
    }
}
