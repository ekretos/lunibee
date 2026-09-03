import type { RateLimitStore, BucketState } from "./store.js";

/** 
 * A Redis client interface that matches the subset of ioredis 
 * methods needed for the RedisRateLimitStore. 
 */
export interface MinimalRedisClient {
    get(key: string): Promise<string | null>;
    mget(keys: string[]): Promise<Array<string | null>>;
    set(key: string, value: string | number, mode?: string, duration?: number): Promise<any>;
    eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;
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

    public async getBucketHash(route: string): Promise<string | undefined> {
        const hash = await this.#client.get(`${this.#prefix}route:${route}`);
        return hash ?? undefined;
    }

    public async setBucketHash(route: string, hash: string): Promise<void> {
        // Cache bucket hashes for 7 days
        await this.#client.set(`${this.#prefix}route:${route}`, hash, "EX", 604800);
    }

    public async getBucket(key: string): Promise<BucketState | undefined> {
        const data = await this.#client.get(`${this.#prefix}bucket:${key}`);
        if (!data) return undefined;
        try {
            return JSON.parse(data) as BucketState;
        } catch {
            return undefined;
        }
    }

    public async updateBucket(key: string, state: BucketState): Promise<void> {
        const ttl = Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000));
        await this.#client.set(
            `${this.#prefix}bucket:${key}`,
            JSON.stringify(state),
            "EX",
            ttl
        );
    }

    public async getGlobalReset(): Promise<number> {
        const resetAt = await this.#client.get(`${this.#prefix}global`);
        return resetAt ? Number(resetAt) : 0;
    }

    public async setGlobalReset(resetAt: number): Promise<void> {
        const ttl = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
        await this.#client.set(`${this.#prefix}global`, String(resetAt), "EX", ttl);
    }
}
