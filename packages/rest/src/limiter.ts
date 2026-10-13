import { sleep } from "./errors.js";
import { scopeBucket } from "./route.js";
import type { RateLimitStore } from "./store.js";

/**
 * Owns Discord's rate-limit state: when a request may go out, and what a
 * response says about the bucket it landed in.
 *
 * The limiter holds no queueing logic of its own — {@link RequestScheduler}
 * decides ordering — and no HTTP knowledge beyond reading rate-limit headers.
 */
/** Default for `maxBackoff`: ten minutes. */
export const DEFAULT_MAX_BACKOFF_MS = 600_000;

export class RateLimiter {
    readonly #store: RateLimitStore;
    /** Whether responses may arrive out of order for one bucket. */
    readonly #concurrent: boolean;
    /** Longest wait the limiter will impose on the strength of a server header. */
    readonly #maxBackoff: number;

    /**
     * @param store Rate-limit state store.
     * @param options `concurrent`: set when several requests per bucket can be
     *   in flight, so a late response cannot raise `remaining` within its window.
     *   `maxBackoff`: the most, in ms, that a rate-limit header can make later
     *   requests wait (default 10 minutes).
     */
    public constructor(
        store: RateLimitStore,
        options: { concurrent?: boolean; maxBackoff?: number } = {},
    ) {
        this.#store = store;
        this.#concurrent = options.concurrent ?? false;
        this.#maxBackoff = options.maxBackoff ?? DEFAULT_MAX_BACKOFF_MS;
        if (!(this.#maxBackoff >= 0))
            throw new RangeError("maxBackoff must be a non-negative number.");
    }

    /** The ceiling on a wait a server header can cause, in ms. */
    public get maxBackoff(): number {
        return this.#maxBackoff;
    }

    /** A reset time no further away than `maxBackoff`: a header cannot wedge the limiter. */
    #cap(resetAt: number): number {
        return Math.min(resetAt, Date.now() + this.#maxBackoff);
    }

    /** The backing store, shared across processes when a distributed store is used. */
    public get store(): RateLimitStore {
        return this.#store;
    }

    /** Resolves the bucket key a request should be gated on. */
    public async resolveBucketKey(
        route: string,
        major: string,
    ): Promise<string> {
        return scopeBucket(
            (await this.#store.getBucketHash(route)) ?? route,
            major,
        );
    }

    /** Whether the backing store can reserve allowance atomically. */
    public get reserves(): boolean {
        return typeof this.#store.reserve === "function";
    }

    /**
     * Waits until both the route bucket and the global limit permit sending.
     *
     * When the store supports it, allowance is *reserved* rather than merely
     * observed. Reading `remaining` and deciding to send is a race across
     * workers: three processes all read `remaining: 1` and all send. A
     * reservation hands the unit to exactly one of them.
     */
    public async acquire(
        bucketKey: string,
        signal: AbortSignal | undefined,
        path: string,
    ): Promise<void> {
        await this.#waitGlobal(signal, path);
        if (!this.#store.reserve) {
            const bucket = await this.#store.getBucket(bucketKey);
            if (bucket) {
                const delay = bucket.resetAt - Date.now();
                if (bucket.remaining <= 0 && delay > 0)
                    await sleep(
                        Math.min(delay, this.#maxBackoff),
                        signal,
                        path,
                    );
            }
            return;
        }
        // Each refusal carries the wait until the window resets, so the loop
        // advances by a real interval every time; the bound only guards against
        // a pathological store that keeps refusing with a zero wait.
        for (let attempt = 0; attempt < 8; attempt++) {
            const reservation = await this.#store.reserve(bucketKey);
            if (reservation.granted) return;
            await sleep(
                Math.min(
                    Math.max(1, reservation.retryAfterMs),
                    this.#maxBackoff,
                ),
                signal,
                path,
            );
            await this.#waitGlobal(signal, path);
        }
    }

    async #waitGlobal(
        signal: AbortSignal | undefined,
        path: string,
    ): Promise<void> {
        const globalDelay = (await this.#store.getGlobalReset()) - Date.now();
        if (globalDelay > 0)
            await sleep(Math.min(globalDelay, this.#maxBackoff), signal, path);
    }

    /** Extends the global limit, never shortening a longer one already recorded. */
    public async noteGlobalReset(resetAt: number): Promise<void> {
        const current = await this.#store.getGlobalReset();
        await this.#store.setGlobalReset(Math.max(current, this.#cap(resetAt)));
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
    ): Promise<string> {
        let currentKey = bucketKey;
        const serverBucket = response.headers.get("X-RateLimit-Bucket");
        if (serverBucket) {
            await this.#store.setBucketHash(route, serverBucket);
            currentKey = scopeBucket(serverBucket, major);
        }

        const stored = await this.#store.getBucket(currentKey);
        const bucket = stored ? { ...stored } : { remaining: 1, resetAt: 0 };
        const windowActive =
            this.#concurrent && !!stored && stored.resetAt > Date.now();
        const remaining = Number(response.headers.get("X-RateLimit-Remaining"));
        const resetAfter = Number(
            response.headers.get("X-RateLimit-Reset-After"),
        );
        const reset = Number(response.headers.get("X-RateLimit-Reset"));

        if (Number.isFinite(remaining))
            bucket.remaining = Math.max(0, remaining);
        if (Number.isFinite(resetAfter))
            bucket.resetAt = this.#cap(
                Date.now() + Math.max(0, resetAfter) * 1000,
            );
        else if (Number.isFinite(reset))
            bucket.resetAt = this.#cap(reset * 1000);
        // With concurrent requests, responses from one window can arrive out of
        // order: never let a late one hand back allowance already reserved.
        if (windowActive && stored) {
            bucket.remaining = Math.min(bucket.remaining, stored.remaining);
            bucket.resetAt = Math.max(bucket.resetAt, stored.resetAt);
        }

        if (response.status === 429) {
            const retryAfter = Number(response.headers.get("Retry-After"));
            if (Number.isFinite(retryAfter))
                bucket.resetAt = Math.max(
                    bucket.resetAt,
                    this.#cap(Date.now() + retryAfter * 1000),
                );
        }
        await this.#store.updateBucket(currentKey, bucket);

        if (response.headers.get("X-RateLimit-Global") === "true") {
            const retryAfter = Number(response.headers.get("Retry-After"));
            if (Number.isFinite(retryAfter))
                await this.noteGlobalReset(Date.now() + retryAfter * 1000);
        }

        return currentKey;
    }
}
