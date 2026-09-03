import type { RateLimitStore, BucketState } from "./store.js";

/** 
 * A Redis client interface that matches the subset of ioredis 
 * methods needed for the RedisRateLimitStore. 
 */
export interface MinimalRedisClient {
    get(key: string): Promise<string | null>;
    mget(keys: string[]): Promise<Array<string | null>>;
    set(key: string, value: string | number, mode?: string, duration?: number): Promise<any>;
    del(...keys: string[]): Promise<number>;
}

export interface RedisRateLimitStoreOptions {
    /** The Redis client instance (e.g. ioredis). */
    client: MinimalRedisClient;
    /** Prefix to prepend to all Redis keys. Defaults to 'lunibee:rest:' */
    prefix?: string;
}

/** 
 * Redis-backed implementation of RateLimitStore for distributed rate limit synchronization. 
 * Allows multiple shards or workers to share Discord API rate limits seamlessly.
 */
export class RedisRateLimitStore implements RateLimitStore {
    readonly #client: MinimalRedisClient;
    readonly #prefix: string;

    public constructor(options: RedisRateLimitStoreOptions) {
        this.#client = options.client;
        this.#prefix = options.prefix ?? "lunibee:rest:";
    }

    /** Logs a Redis failure once and lets callers fall back to safe defaults. */
    #onError(operation: string, error: unknown): void {
        console.warn(
            `[lunibee/rest] Redis rate-limit store ${operation} failed; ` +
                `falling back to local limiting for this call.`,
            error,
        );
    }

    public async getBucketHash(route: string): Promise<string | undefined> {
        try {
            const hash = await this.#client.get(`${this.#prefix}route:${route}`);
            return hash ?? undefined;
        } catch (error) {
            this.#onError("getBucketHash", error);
            return undefined;
        }
    }

    public async setBucketHash(route: string, hash: string): Promise<void> {
        try {
            // Cache bucket hashes for 7 days
            await this.#client.set(`${this.#prefix}route:${route}`, hash, "EX", 604800);
        } catch (error) {
            this.#onError("setBucketHash", error);
        }
    }

    public async getBucket(key: string): Promise<BucketState | undefined> {
        try {
            const data = await this.#client.get(`${this.#prefix}bucket:${key}`);
            if (!data) return undefined;
            return JSON.parse(data) as BucketState;
        } catch (error) {
            this.#onError("getBucket", error);
            return undefined;
        }
    }

    public async updateBucket(key: string, state: BucketState): Promise<void> {
        const bucketKey = `${this.#prefix}bucket:${key}`;
        // Expired buckets hold no useful limit info; drop them instead of
        // persisting stale state under a clamped 1s TTL.
        const ttl = Math.ceil((state.resetAt - Date.now()) / 1000);
        try {
            if (ttl <= 0) {
                await this.#client.del(bucketKey);
                return;
            }
            await this.#client.set(bucketKey, JSON.stringify(state), "EX", ttl);
        } catch (error) {
            this.#onError("updateBucket", error);
        }
    }

    public async getGlobalReset(): Promise<number> {
        try {
            const resetAt = await this.#client.get(`${this.#prefix}global`);
            return resetAt ? Number(resetAt) : 0;
        } catch (error) {
            this.#onError("getGlobalReset", error);
            return 0;
        }
    }

    public async setGlobalReset(resetAt: number): Promise<void> {
        const globalKey = `${this.#prefix}global`;
        const ttl = Math.ceil((resetAt - Date.now()) / 1000);
        try {
            if (ttl <= 0) {
                await this.#client.del(globalKey);
                return;
            }
            await this.#client.set(globalKey, String(resetAt), "EX", ttl);
        } catch (error) {
            this.#onError("setGlobalReset", error);
        }
    }
}
