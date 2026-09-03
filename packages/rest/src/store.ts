export interface BucketState {
    remaining: number;
    resetAt: number;
}

/** Interface for distributed or local rate limit synchronization. */
export interface RateLimitStore {
    /** Gets the server bucket hash for a normalized route. */
    getBucketHash(route: string): Promise<string | undefined> | string | undefined;
    /** Associates a route with a server bucket hash. */
    setBucketHash(route: string, hash: string): Promise<void> | void;

    /** Gets the current state for a bucket key. */
    getBucket(key: string): Promise<BucketState | undefined> | BucketState | undefined;
    /** Updates the state for a bucket key. */
    updateBucket(key: string, state: BucketState): Promise<void> | void;

    /** Gets the global reset timestamp. */
    getGlobalReset(): Promise<number> | number;
    /** Sets the global reset timestamp. */
    setGlobalReset(resetAt: number): Promise<void> | void;

    /**
     * Evicts expired bucket entries. Optional: stores with native key
     * expiry (e.g. Redis) can omit it. `maxAge` (ms) additionally drops
     * buckets whose reset is older than that window; defaults to 0 (only
     * already-reset buckets are removed).
     */
    prune?(maxAge?: number): Promise<void> | void;
}

/** Local memory implementation of RateLimitStore. */
export class MemoryRateLimitStore implements RateLimitStore {
    readonly #buckets = new Map<string, BucketState>();
    readonly #routeBuckets = new Map<string, string>();
    #globalResetAt = 0;
    /** Minimum interval between automatic prunes, in ms. */
    static readonly #PRUNE_INTERVAL = 60_000;
    #lastPruneAt = 0;

    public getBucketHash(route: string): string | undefined {
        return this.#routeBuckets.get(route);
    }
    public setBucketHash(route: string, hash: string): void {
        this.#routeBuckets.set(route, hash);
    }
    public getBucket(key: string): BucketState | undefined {
        return this.#buckets.get(key);
    }
    public updateBucket(key: string, state: BucketState): void {
        this.#buckets.set(key, state);
        // Amortised eviction: sweep expired buckets at most once per interval
        // so the map cannot grow unbounded across long-lived processes.
        const now = Date.now();
        if (now - this.#lastPruneAt >= MemoryRateLimitStore.#PRUNE_INTERVAL) {
            this.#lastPruneAt = now;
            this.prune();
        }
    }
    /** Removes buckets whose reset is in the past (or older than `maxAge` ms). */
    public prune(maxAge = 0): void {
        const cutoff = Date.now() - Math.max(0, maxAge);
        for (const [key, state] of this.#buckets) {
            if (state.resetAt <= cutoff) this.#buckets.delete(key);
        }
    }
    public getGlobalReset(): number {
        return this.#globalResetAt;
    }
    public setGlobalReset(resetAt: number): void {
        this.#globalResetAt = resetAt;
    }
}
