import {
    MemoryRateLimitStore,
    type RateLimitStore,
    type BucketState,
    type Reservation,
} from "./store.js";

/**
 * Atomically consumes one unit of a bucket's allowance.
 *
 * Runs inside Redis so the read, the decrement and the write cannot interleave
 * across workers — the whole point of the reservation. Grants when the bucket
 * is unknown or its window has elapsed, because an unknown bucket is only
 * discovered by sending; refusing would deadlock the route across the fleet.
 *
 * `KEYS[1]` bucket key · `ARGV[1]` current time in ms.
 * Returns `{granted, retryAfterMs}`.
 */
const RESERVE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {1, 0} end
local ok, state = pcall(cjson.decode, raw)
if not ok or type(state) ~= 'table' or type(state.resetAt) ~= 'number' then
  return {1, 0}
end
local now = tonumber(ARGV[1])
local wait = state.resetAt - now
if wait <= 0 then return {1, 0} end
if type(state.remaining) == 'number' and state.remaining > 0 then
  state.remaining = state.remaining - 1
  redis.call('SET', KEYS[1], cjson.encode(state), 'PX', math.ceil(wait))
  return {1, 0}
end
return {0, math.ceil(wait)}
`;

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
    /**
     * Optional Lua evaluation (ioredis/node-redis compatible). When present,
     * {@link RedisRateLimitStore.reserve} becomes available and the limiter
     * reserves allowance atomically instead of racing on observed state.
     */
    eval?(
        script: string,
        numKeys: number,
        ...args: Array<string | number>
    ): Promise<unknown>;
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
    /**
     * In-process mirror of every write. Reads fall back to it when Redis is
     * unreachable: answering "no limit known" would drop every worker to
     * unlimited sending at the same moment, which is how a fleet earns a
     * Cloudflare ban during a Redis blip.
     */
    readonly #local = new MemoryRateLimitStore();
    #lastError?: unknown;

    public constructor(options: RedisRateLimitStoreOptions) {
        this.#client = options.client;
        this.#prefix = options.prefix ?? "lunibee:rest:";
        this.#onErrorCallback = options.onError;
        // The limiter detects reservation support by presence, so the method
        // exists only when the client can actually run the script atomically.
        // It is assigned here rather than declared on the prototype: a
        // prototype method cannot be removed from one instance.
        if (typeof options.client.eval === "function")
            this.reserve = (key) => this.#reserve(key);
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
            const hash = await this.#client.get(
                `${this.#prefix}route:${route}`,
            );
            this.#markHealthy();
            return hash ?? undefined;
        } catch (error) {
            this.#onError("getBucketHash", error);
            return this.#local.getBucketHash(route);
        }
    }

    public async setBucketHash(route: string, hash: string): Promise<void> {
        this.#local.setBucketHash(route, hash);
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
            return this.#local.getBucket(key);
        }
    }

    public async updateBucket(key: string, state: BucketState): Promise<void> {
        this.#local.updateBucket(key, state);
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
            await this.#client.set(bucketKey, JSON.stringify(state), "EX", ttl);
            this.#markHealthy();
        } catch (error) {
            this.#onError("updateBucket", error);
        }
    }

    /** Whether the backing client supports atomic reservations. */
    public get supportsReservation(): boolean {
        return typeof this.#client.eval === "function";
    }

    /**
     * Atomically consumes one unit of a bucket's allowance across the fleet.
     *
     * Assigned in the constructor only when the client exposes `eval`, so a
     * client that cannot reserve atomically does not advertise that it can.
     * A Redis failure falls back to the local mirror rather than blocking:
     * refusing every request during an outage would stall the bot.
     */
    public reserve?: (key: string) => Promise<Reservation>;

    async #reserve(key: string): Promise<Reservation> {
        try {
            const result = (await this.#client.eval!(
                RESERVE_SCRIPT,
                1,
                `${this.#prefix}bucket:${key}`,
                Date.now(),
            )) as [number, number] | undefined;
            this.#markHealthy();
            if (!Array.isArray(result)) return { granted: true };
            const [granted, retryAfterMs] = result;
            return Number(granted) === 1
                ? { granted: true }
                : { granted: false, retryAfterMs: Number(retryAfterMs) || 0 };
        } catch (error) {
            this.#onError("reserve", error);
            return this.#local.reserve(key);
        }
    }

    public async getGlobalReset(): Promise<number> {
        try {
            const resetAt = await this.#client.get(`${this.#prefix}global`);
            this.#markHealthy();
            return resetAt ? Number(resetAt) : 0;
        } catch (error) {
            this.#onError("getGlobalReset", error);
            return this.#local.getGlobalReset();
        }
    }

    public async setGlobalReset(resetAt: number): Promise<void> {
        this.#local.setGlobalReset(resetAt);
        const globalKey = `${this.#prefix}global`;
        const ttl = Math.ceil((resetAt - Date.now()) / 1000);
        try {
            if (ttl <= 0) {
                await this.#client.del(globalKey);
                this.#markHealthy();
                return;
            }
            await this.#client.set(globalKey, String(resetAt), "EX", ttl);
            this.#markHealthy();
        } catch (error) {
            this.#onError("setGlobalReset", error);
        }
    }
}
