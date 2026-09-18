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
export class RateLimiter {
    readonly #store: RateLimitStore;

    public constructor(store: RateLimitStore) {
        this.#store = store;
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
                    await sleep(delay, signal, path);
            }
            return;
        }
        // Each refusal carries the wait until the window resets, so the loop
        // advances by a real interval every time; the bound only guards against
        // a pathological store that keeps refusing with a zero wait.
        for (let attempt = 0; attempt < 8; attempt++) {
            const reservation = await this.#store.reserve(bucketKey);
            if (reservation.granted) return;
            await sleep(Math.max(1, reservation.retryAfterMs), signal, path);
            await this.#waitGlobal(signal, path);
        }
    }

    async #waitGlobal(
        signal: AbortSignal | undefined,
        path: string,
    ): Promise<void> {
        const globalDelay = (await this.#store.getGlobalReset()) - Date.now();
        if (globalDelay > 0) await sleep(globalDelay, signal, path);
    }

    /** Extends the global limit, never shortening a longer one already recorded. */
    public async noteGlobalReset(resetAt: number): Promise<void> {
        const current = await this.#store.getGlobalReset();
        await this.#store.setGlobalReset(Math.max(current, resetAt));
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

        const bucket = (await this.#store.getBucket(currentKey)) ?? {
            remaining: 1,
            resetAt: 0,
        };
        const remaining = Number(response.headers.get("X-RateLimit-Remaining"));
        const resetAfter = Number(
            response.headers.get("X-RateLimit-Reset-After"),
        );
        const reset = Number(response.headers.get("X-RateLimit-Reset"));

        if (Number.isFinite(remaining))
            bucket.remaining = Math.max(0, remaining);
        if (Number.isFinite(resetAfter))
            bucket.resetAt = Date.now() + Math.max(0, resetAfter) * 1000;
        else if (Number.isFinite(reset)) bucket.resetAt = reset * 1000;

        if (response.status === 429) {
            const retryAfter = Number(response.headers.get("Retry-After"));
            if (Number.isFinite(retryAfter))
                bucket.resetAt = Math.max(
                    bucket.resetAt,
                    Date.now() + retryAfter * 1000,
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
