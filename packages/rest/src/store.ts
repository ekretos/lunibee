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
}

/** Local memory implementation of RateLimitStore. */
export class MemoryRateLimitStore implements RateLimitStore {
    readonly #buckets = new Map<string, BucketState>();
    readonly #routeBuckets = new Map<string, string>();
    #globalResetAt = 0;

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
    }
    public getGlobalReset(): number {
        return this.#globalResetAt;
    }
    public setGlobalReset(resetAt: number): void {
        this.#globalResetAt = resetAt;
    }
}
