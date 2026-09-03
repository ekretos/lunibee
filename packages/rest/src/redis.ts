import type { RateLimitStore, BucketState } from "./store.js";

/**
 * A Redis client interface that matches the subset of ioredis
 * methods needed for the RedisRateLimitStore.
 */
export interface MinimalRedisClient {
    get(key: string): Promise<string | null>;
    mget(keys: string[]): Promise<Array<string | null>>;
    set(
        key: string,
        value: string | number,
        mode?: string,
        duration?: number,
    ): Promise<any>;
    del(...keys: string[]): Promise<number>;
}

export interface RedisRateLimitStoreOptions {
    /** The Redis client instance (e.g. ioredis). */
    client: MinimalRedisClient;
    /** Prefix to prepend to all Redis keys. Defaults to 'lunibee:rest:' */
    prefix?: string;
    /** Called whenever a Redis operation fails before local fallback behavior is used. */
    onError?: (operation: string, error: unknown) => void;
}

/**
 * Redis-backed implementation of RateLimitStore for distributed rate limit synchronization.
 * Allows multiple shards or workers to share Discord API rate limits seamlessly.
 */
export class RedisRateLimitStore implements RateLimitStore {
    readonly #client: MinimalRedisClient;
    readonly #prefix: string;
    readonly #onErrorCallback?: RedisRateLimitStoreOptions["onError"];
    #lastError?: unknown;

    public constructor(options: RedisRateLimitStoreOptions) {
        this.#client = options.client;
        this.#prefix = options.prefix ?? "lunibee:rest:";
        this.#onErrorCallback = options.onError;
    }

    /** The most recent Redis error, if any. */
    public get lastError(): unknown {
        return this.#lastError;
    }

    /** Whether no Redis operation has failed since construction or the last successful health check. */
    public isHealthy(): boolean {
        return this.#lastError === undefined;
    }

    /** Logs and surfaces a Redis failure while retaining safe local fallback behavior. */
    #onError(operation: string, error: unknown): void {
        this.#lastError = error;
        console.warn(
            `[lunibee/rest] Redis rate-limit store ${operation} failed; ` +
                `falling back to local limiting for this call.`,
            error,
        );
        try {
            this.#onErrorCallback?.(operation, error);
        } catch {
            // User-provided diagnostics must never break REST operations.
        }
    }

    /** Marks the store healthy after a successful Redis operation. */
    #markHealthy(): void {
        this.#lastError = undefined;
    }

    public async getBucketHash(route: string): Promise<string | undefined> {
        try {
            const hash = await this.#client.get(`${this.#prefix}route:${route}`);
            this.#markHealthy();
            return hash ?? undefined;
        } catch (error) {
            this.#onError("getBucketHash", error);
            return undefined;
        }
    }

    public async setBucketHash(route: string, hash: string): Promise<void> {
        try {
            await this.#client.set(
                `${this.#prefix}route:${route}`,
                hash,
                "EX",
                604800,
            );
            this.#markHealthy();
        } catch (error) {
            this.#onError("setBucketHash", error);
        }
    }

    public async getBucket(key: string): Promise<BucketState | undefined> {
        try {
            const data = await this.#client.get(`${this.#prefix}bucket:${key}`);
            this.#markHealthy();
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
                this.#markHealthy();
                return;
            }
            await this.#client.set(
                bucketKey,
                JSON.stringify(state),
                "EX",
                ttl,
            );
            this.#markHealthy();
        } catch (error) {
            this.#onError("updateBucket", error);
        }
    }

    public async getGlobalReset(): Promise<number> {
        try {
            const resetAt = await this.#client.get(`${this.#prefix}global`);
            this.#markHealthy();
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
                this.#markHealthy();
                return;
            }
            await this.#client.set(
                globalKey,
                String(resetAt),
                "EX",
                ttl,
            );
            this.#markHealthy();
        } catch (error) {
            this.#onError("setGlobalReset", error);
        }
    }
}
