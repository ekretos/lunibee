import { RESTError, sanitizeCause } from "./errors.js";
import {
    BUCKET_LINGER_MS,
    DEFAULT_PROBE_MS,
    GLOBAL_WINDOW_MS,
    MemoryRateLimitStore,
    PROBE_POLL_MS,
    type BucketState,
    type BucketUpdate,
    type RateLimitStore,
    type Reservation,
    type ReserveOptions,
} from "./store.js";
import {
    emitTelemetry,
    type CoordinationMode,
    type RESTTelemetry,
} from "./telemetry.js";

/**
 * Shared Lua helpers. Every script reads the clock from Redis (`TIME`), so
 * workers whose clocks disagree still agree on when a window resets.
 */
const LUA_PRELUDE = `
local function now_ms()
  local t = redis.call('TIME')
  return tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
end
local function load(key)
  local raw = redis.call('GET', key)
  if not raw then return nil end
  local ok, s = pcall(cjson.decode, raw)
  if ok and type(s) == 'table' and type(s.resetAt) == 'number'
    and type(s.remaining) == 'number' then return s end
  return nil
end
local function save(key, s, now, linger)
  local ttl = math.max(1, math.ceil(s.resetAt - now)) + linger
  redis.call('SET', key, cjson.encode(s), 'PX', ttl)
end
`;

/**
 * Atomically checks the global limit and consumes one unit of a bucket.
 * A port of `reserveState` in store.ts.
 *
 * `KEYS[1]` bucket · `KEYS[2]` global reset · `KEYS[3]` global request count
 * (both optional) · `ARGV` probe ms, poll ms, linger ms, global limit, window ms.
 * Returns `{1, resetAt, known}` or `{0, waitMs, reason}`.
 */
export const RESERVE_SCRIPT = `${LUA_PRELUDE}
local now = now_ms()
local glimit, gwindow = tonumber(ARGV[4]) or 0, tonumber(ARGV[5]) or 1000
if #KEYS > 1 then
  local g = tonumber(redis.call('GET', KEYS[2]) or '0') or 0
  if g > now then return {0, math.ceil(g - now), 'global'} end
end
if #KEYS < 3 then glimit = 0 end
-- A sliding log of send times: at most glimit in any gwindow span.
if glimit > 0 then
  redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now - gwindow)
  if redis.call('ZCARD', KEYS[3]) >= glimit then
    local oldest = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
    return {0, math.max(1, tonumber(oldest[2]) + gwindow - now + 1), 'global'}
  end
end
local function count()
  if glimit > 0 then
    local seq = redis.call('ZCARD', KEYS[3])
    redis.call('ZADD', KEYS[3], now, now .. ':' .. seq)
    redis.call('PEXPIRE', KEYS[3], gwindow + 1000)
  end
end
local probe, poll, linger = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local s = load(KEYS[1])
if s and s.resetAt > now then
  if s.remaining > 0 then
    s.remaining = s.remaining - 1
    save(KEYS[1], s, now, linger)
    count()
    return {1, s.resetAt, 1}
  end
  local wait = s.resetAt - now
  if s.provisional then wait = math.min(wait, poll) end
  local reason = 'bucket'
  if s.probe then reason = 'probe' end
  return {0, math.ceil(wait), reason}
end
local resetAt = now + probe
if s and type(s.limit) == 'number' and s.limit > 0 then
  save(KEYS[1], {remaining = s.limit - 1, resetAt = resetAt, limit = s.limit, provisional = true}, now, linger)
  count()
  return {1, resetAt, 1}
end
save(KEYS[1], {remaining = 0, resetAt = resetAt, provisional = true, probe = true}, now, 0)
count()
return {1, resetAt, 0}
`;

/**
 * Atomically merges a response into a bucket. A port of `reconcileState`.
 *
 * `KEYS[1]` bucket · `ARGV` remaining, reset-after ms, limit, window, retry ms
 * (each '' when absent), linger ms.
 */
export const RECONCILE_SCRIPT = `${LUA_PRELUDE}
local now = now_ms()
local rem, after, limit = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local win, retry, linger = tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6])
local tol = 50
local incoming = nil
if after then incoming = math.ceil(now + after) end
local s = load(KEYS[1])
local n
if s and s.resetAt > now and not s.probe then
  n = s
  local stale = win and n.window and win < n.window - tol
  if not stale then
    if rem then n.remaining = math.min(n.remaining, rem) end
    if incoming then
      local newer = win and n.window and win > n.window + tol
      if n.provisional or newer then n.resetAt = incoming
      else n.resetAt = math.max(n.resetAt, incoming) end
      n.provisional = nil
    end
    if win then n.window = math.max(n.window or 0, win) end
  end
else
  if not rem and not retry then
    if s and s.probe then redis.call('DEL', KEYS[1]) end
    return 0
  end
  n = {remaining = rem or 0, resetAt = incoming or now}
  if s and type(s.limit) == 'number' then n.limit = s.limit end
  if win then n.window = win end
end
if limit and limit > 0 then n.limit = limit end
if retry then
  n.remaining = 0
  n.resetAt = math.max(n.resetAt, math.ceil(now + retry))
  n.provisional = nil
end
save(KEYS[1], n, now, linger)
return 1
`;

/** Extends a global limit, never shortening it. `KEYS[1]` global · `ARGV[1]` wait ms. */
export const EXTEND_GLOBAL_SCRIPT = `${LUA_PRELUDE}
local now = now_ms()
local target = math.ceil(now + tonumber(ARGV[1]))
local cur = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
if target > cur then
  redis.call('SET', KEYS[1], tostring(target), 'PX', math.max(1, target - now))
  return target - now
end
return math.max(0, cur - now)
`;

/** Clears a probe or refunds a unit. `KEYS[1]` bucket · `ARGV` resetAt, refund (1/0). */
export const RELEASE_SCRIPT = `${LUA_PRELUDE}
local s = load(KEYS[1])
if not s or s.resetAt ~= tonumber(ARGV[1]) then return 0 end
if s.probe then
  redis.call('DEL', KEYS[1])
  return 1
end
if ARGV[2] == '1' then
  local cap = s.remaining + 1
  if type(s.limit) == 'number' then cap = math.min(cap, s.limit) end
  s.remaining = cap
  redis.call('SET', KEYS[1], cjson.encode(s), 'KEEPTTL')
  return 1
end
return 0
`;

/** Checks that scripting and `TIME` are available. */
const VERIFY_SCRIPT = "return redis.call('TIME')[1]";

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
    ): Promise<string | null>;
    del(...keys: string[]): Promise<number>;
    /**
     * Optional Lua evaluation (ioredis/node-redis compatible). When present,
     * the store reserves, reconciles and extends limits atomically; without
     * it the store is observational and workers can race on the last unit.
     */
    eval?(
        script: string,
        numKeys: number,
        ...args: Array<string | number>
    ): Promise<unknown>;
}

/**
 * Adapts Bun's built-in `Bun.RedisClient` (or anything with
 * `send(command, args)`) to {@link MinimalRedisClient}, with `eval`.
 *
 * ```ts
 * const store = new RedisRateLimitStore({
 *     client: fromBunRedis(new Bun.RedisClient(process.env.REDIS_URL)),
 * });
 * ```
 */
export function fromBunRedis(client: {
    send(command: string, args: string[]): Promise<unknown>;
}): MinimalRedisClient {
    return {
        get: (key) => client.send("GET", [key]) as Promise<string | null>,
        mget: (keys) =>
            client.send("MGET", keys) as Promise<Array<string | null>>,
        set: (key, value, mode, duration) =>
            client.send(
                "SET",
                mode === undefined
                    ? [key, String(value)]
                    : [key, String(value), mode, String(duration)],
            ) as Promise<string | null>,
        del: (...keys) => client.send("DEL", keys) as Promise<number>,
        eval: (script, numKeys, ...args) =>
            client.send("EVAL", [script, String(numKeys), ...args.map(String)]),
    };
}

/**
 * What the store does when Redis cannot be reached.
 *
 * - `degraded-local` (default): limit from this process's last known state,
 *   report the mode change, and return to Redis when it answers again. Several
 *   processes limiting alone can together exceed a limit.
 * - `fail-closed`: refuse to send. Requests fail with a `RESTError` of kind
 *   `"coordination"` until Redis answers.
 */
export type RedisFailurePolicy = "degraded-local" | "fail-closed";

/** Options for `RedisRateLimitStore`. */
export interface RedisRateLimitStoreOptions {
    /** The Redis client instance (e.g. ioredis, or `fromBunRedis(...)`). */
    client: MinimalRedisClient;
    /**
     * Prefix of every key. Defaults to `lunibee:rest:`; keys are then
     * versioned (`lunibee:rest:v1:…`). On Redis Cluster, put a hash tag in it
     * (`{lunibee}:rest:`) so one script's keys share a slot.
     */
    prefix?: string;
    /** Called whenever a Redis operation fails. */
    onError?: (operation: string, error: unknown) => void;
    /** What to do while Redis is unreachable. Default `"degraded-local"`. */
    failurePolicy?: RedisFailurePolicy;
    /** Longest one Redis command may take before it counts as failed, in ms. Default 2000. */
    commandTimeout?: number;
    /** Throw at construction when the client has no `eval` (no atomic reservations). Default false. */
    requireAtomic?: boolean;
    /** Receives `store` latency and `mode` events. */
    telemetry?: RESTTelemetry;
}

/** The store's health, for diagnostics endpoints. */
export interface RedisStoreDiagnostics {
    mode: CoordinationMode;
    failurePolicy: RedisFailurePolicy;
    atomic: boolean;
    failures: number;
    lastFailureAt?: number;
    lastError?: string;
}

/** Bumped when the stored shape changes; old keys are then simply ignored. */
const SCHEMA = "v1";

/**
 * Redis-backed implementation of RateLimitStore for distributed rate limit
 * synchronization: workers sharing one Redis share every limit, reserve
 * allowance atomically, and merge responses atomically.
 */
export class RedisRateLimitStore implements RateLimitStore {
    readonly #client: MinimalRedisClient;
    readonly #prefix: string;
    readonly #onErrorCallback?: RedisRateLimitStoreOptions["onError"];
    readonly #policy: RedisFailurePolicy;
    readonly #timeout: number;
    readonly #telemetry?: RESTTelemetry;
    readonly #atomic: boolean;
    /**
     * In-process mirror of every write. Reads fall back to it when Redis is
     * unreachable: answering "no limit known" would drop every worker to
     * unlimited sending at the same moment, which is how a fleet earns a
     * Cloudflare ban during a Redis blip.
     */
    readonly #local = new MemoryRateLimitStore();
    #lastError?: unknown;
    #lastFailureAt?: number;
    #failures = 0;
    #mode: CoordinationMode;

    public constructor(options: RedisRateLimitStoreOptions) {
        this.#client = options.client;
        this.#prefix = `${options.prefix ?? "lunibee:rest:"}${SCHEMA}:`;
        this.#onErrorCallback = options.onError;
        this.#policy = options.failurePolicy ?? "degraded-local";
        if (this.#policy !== "degraded-local" && this.#policy !== "fail-closed")
            throw new TypeError(
                'failurePolicy must be "degraded-local" or "fail-closed".',
            );
        this.#timeout = options.commandTimeout ?? 2000;
        if (!(this.#timeout > 0))
            throw new RangeError("commandTimeout must be a positive number.");
        this.#telemetry = options.telemetry;
        this.#atomic = typeof options.client.eval === "function";
        if (options.requireAtomic && !this.#atomic)
            throw new TypeError(
                "requireAtomic: the Redis client has no eval method, so reservations cannot be atomic.",
            );
        this.#mode = this.#atomic ? "distributed" : "observational";
        // The limiter detects these by presence, so they exist only when the
        // client can run them atomically. They are assigned here rather than
        // declared on the prototype: a prototype method cannot be removed
        // from one instance.
        if (this.#atomic) {
            this.reserve = (key, opts) => this.#reserve(key, opts);
            this.reconcile = (key, update) => this.#reconcile(key, update);
            this.extendGlobalReset = (scope, waitMs) =>
                this.#extendGlobal(scope, waitMs);
            this.release = (key, grant, refund) =>
                this.#release(key, grant, refund);
            this.reservesGlobal = true;
        }
    }

    /** The most recent Redis error, if any. */
    public get lastError(): unknown {
        return this.#lastError;
    }

    /** Whether no Redis operation has failed since construction or the last successful one. */
    public isHealthy(): boolean {
        return this.#lastError === undefined;
    }

    /** How limits are being enforced right now. */
    public get mode(): CoordinationMode {
        return this.#mode;
    }

    /** Whether the backing client supports atomic reservations. */
    public get supportsReservation(): boolean {
        return this.#atomic;
    }

    /** The store's current health. */
    public diagnostics(): RedisStoreDiagnostics {
        const error = this.#lastError;
        return {
            mode: this.#mode,
            failurePolicy: this.#policy,
            atomic: this.#atomic,
            failures: this.#failures,
            lastFailureAt: this.#lastFailureAt,
            lastError:
                error === undefined
                    ? undefined
                    : String(
                          (sanitizeCause(error) as Error | undefined)
                              ?.message ?? error,
                      ),
        };
    }

    /**
     * Checks that the client can run the store's scripts (some managed Redis
     * services disable `EVAL`). Call it at startup to fail fast.
     * @throws {TypeError} If the client has no `eval`.
     * @throws {RESTError} Of kind `"coordination"`, if the script cannot run.
     */
    public async verify(): Promise<void> {
        if (!this.#atomic)
            throw new TypeError(
                "The Redis client has no eval method: reservations cannot be atomic.",
            );
        try {
            await this.#withTimeout(this.#client.eval!(VERIFY_SCRIPT, 0));
        } catch (error) {
            throw new RESTError(
                "The Redis rate-limit store cannot run its scripts.",
                0,
                undefined,
                undefined,
                { kind: "coordination", cause: sanitizeCause(error) },
            );
        }
    }

    #setMode(mode: CoordinationMode): void {
        if (mode === this.#mode) return;
        const previous = this.#mode;
        this.#mode = mode;
        emitTelemetry(this.#telemetry, { type: "mode", mode, previous });
        console.warn(
            mode === "degraded-local"
                ? "[lunibee/rest] Redis rate-limit store unreachable: limiting locally in this process until it answers."
                : mode === "unavailable"
                  ? "[lunibee/rest] Redis rate-limit store unreachable: requests fail until it answers (fail-closed)."
                  : "[lunibee/rest] Redis rate-limit store reachable again: limits are shared.",
        );
    }

    #withTimeout<T>(promise: Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout>;
        return Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                `Redis command timed out after ${this.#timeout}ms`,
                            ),
                        ),
                    this.#timeout,
                );
            }),
        ]).finally(() => clearTimeout(timer));
    }

    /**
     * Runs one Redis command with the timeout, telemetry and failure policy.
     * `enforcing` commands decide whether a request may be sent: under
     * `fail-closed` their failure throws. Others (writes after a response,
     * route hashes) fall back to the mirror under either policy, because
     * failing a request Discord already answered helps nobody.
     */
    async #run<T>(
        operation: string,
        command: () => Promise<T>,
        fallback: () => T,
        enforcing: boolean,
    ): Promise<T> {
        const started = performance.now();
        try {
            const value = await this.#withTimeout(command());
            emitTelemetry(this.#telemetry, {
                type: "store",
                operation,
                latencyMs: performance.now() - started,
                ok: true,
            });
            this.#lastError = undefined;
            this.#setMode(this.#atomic ? "distributed" : "observational");
            return value;
        } catch (error) {
            emitTelemetry(this.#telemetry, {
                type: "store",
                operation,
                latencyMs: performance.now() - started,
                ok: false,
            });
            this.#lastError = error;
            this.#lastFailureAt = Date.now();
            this.#failures++;
            try {
                this.#onErrorCallback?.(operation, error);
            } catch {
                // User-provided diagnostics must never break REST operations.
            }
            if (this.#policy === "fail-closed") {
                this.#setMode("unavailable");
                if (enforcing)
                    throw new RESTError(
                        `The Redis rate-limit store is unavailable (${operation}); request not sent (failurePolicy: "fail-closed").`,
                        0,
                        undefined,
                        undefined,
                        { kind: "coordination", cause: sanitizeCause(error) },
                    );
            } else this.#setMode("degraded-local");
            return fallback();
        }
    }

    #bucketKey(key: string): string {
        return `${this.#prefix}bucket:${key}`;
    }
    #globalKey(scope: string): string {
        return `${this.#prefix}global:${scope}`;
    }

    public async getBucketHash(route: string): Promise<string | undefined> {
        return this.#run(
            "getBucketHash",
            async () =>
                (await this.#client.get(`${this.#prefix}route:${route}`)) ??
                undefined,
            () => this.#local.getBucketHash(route),
            false,
        );
    }

    public async setBucketHash(route: string, hash: string): Promise<void> {
        this.#local.setBucketHash(route, hash);
        await this.#run(
            "setBucketHash",
            async () => {
                await this.#client.set(
                    `${this.#prefix}route:${route}`,
                    hash,
                    "EX",
                    604800,
                );
            },
            () => undefined,
            false,
        );
    }

    public async getBucket(key: string): Promise<BucketState | undefined> {
        return this.#run(
            "getBucket",
            async () => {
                const data = await this.#client.get(this.#bucketKey(key));
                if (!data) return undefined;
                try {
                    return JSON.parse(data) as BucketState;
                } catch {
                    return undefined;
                }
            },
            () => this.#local.getBucket(key),
            true,
        );
    }

    public async updateBucket(key: string, state: BucketState): Promise<void> {
        this.#local.updateBucket(key, state);
        // Expired buckets hold no useful limit info; drop them instead of
        // persisting stale state under a clamped TTL.
        const ttl = Math.ceil(state.resetAt - Date.now());
        await this.#run(
            "updateBucket",
            async () => {
                if (ttl <= 0) await this.#client.del(this.#bucketKey(key));
                else
                    await this.#client.set(
                        this.#bucketKey(key),
                        JSON.stringify(state),
                        "PX",
                        ttl,
                    );
            },
            () => undefined,
            false,
        );
    }

    /** Atomically checks the global limit and consumes one unit of the bucket. */
    public reserve?: (
        key: string,
        options?: ReserveOptions,
    ) => Promise<Reservation>;
    /** Atomically merges a response into the bucket. */
    public reconcile?: (key: string, update: BucketUpdate) => Promise<void>;
    /** Atomically extends a global limit, never shortening it. */
    public extendGlobalReset?: (scope: string, waitMs: number) => Promise<void>;
    /** Clears a probe placeholder or refunds an unsent request's unit. */
    public release?: (
        key: string,
        grant: { resetAt?: number },
        refund: boolean,
    ) => Promise<void>;
    /** Whether {@link reserve} checks the global limit itself. */
    public readonly reservesGlobal?: boolean;

    async #reserve(
        key: string,
        options: ReserveOptions = {},
    ): Promise<Reservation> {
        const keys = [this.#bucketKey(key)];
        if (options.global !== undefined) {
            keys.push(this.#globalKey(options.global));
            if (options.globalLimit)
                keys.push(`${this.#prefix}global-log:${options.global}`);
        }
        return this.#run(
            "reserve",
            async () => {
                const result = await this.#client.eval!(
                    RESERVE_SCRIPT,
                    keys.length,
                    ...keys,
                    options.probeMs ?? DEFAULT_PROBE_MS,
                    PROBE_POLL_MS,
                    BUCKET_LINGER_MS,
                    options.globalLimit ?? 0,
                    GLOBAL_WINDOW_MS,
                );
                return parseReservation(result);
            },
            () => this.#local.reserve(key, options),
            true,
        );
    }

    async #reconcile(key: string, update: BucketUpdate): Promise<void> {
        this.#local.reconcile(key, update);
        const arg = (value: number | undefined): string =>
            value === undefined ? "" : String(value);
        await this.#run(
            "reconcile",
            async () => {
                await this.#client.eval!(
                    RECONCILE_SCRIPT,
                    1,
                    this.#bucketKey(key),
                    arg(update.remaining),
                    arg(update.resetAfterMs),
                    arg(update.limit),
                    arg(update.window),
                    arg(update.retryAfterMs),
                    BUCKET_LINGER_MS,
                );
            },
            () => undefined,
            false,
        );
    }

    async #extendGlobal(scope: string, waitMs: number): Promise<void> {
        this.#local.extendGlobalReset(scope, waitMs);
        await this.#run(
            "extendGlobalReset",
            async () => {
                await this.#client.eval!(
                    EXTEND_GLOBAL_SCRIPT,
                    1,
                    this.#globalKey(scope),
                    Math.max(0, Math.ceil(waitMs)),
                );
            },
            () => undefined,
            false,
        );
    }

    async #release(
        key: string,
        grant: { resetAt?: number },
        refund: boolean,
    ): Promise<void> {
        this.#local.release(key, grant, refund);
        if (grant.resetAt === undefined) return;
        await this.#run(
            "release",
            async () => {
                await this.#client.eval!(
                    RELEASE_SCRIPT,
                    1,
                    this.#bucketKey(key),
                    grant.resetAt!,
                    refund ? "1" : "0",
                );
            },
            () => undefined,
            false,
        );
    }

    public async getGlobalReset(scope = ""): Promise<number> {
        return this.#run(
            "getGlobalReset",
            async () => {
                const resetAt = await this.#client.get(this.#globalKey(scope));
                return resetAt ? Number(resetAt) || 0 : 0;
            },
            () => this.#local.getGlobalReset(scope),
            true,
        );
    }

    public async setGlobalReset(resetAt: number, scope = ""): Promise<void> {
        this.#local.setGlobalReset(resetAt, scope);
        const ttl = Math.ceil(resetAt - Date.now());
        await this.#run(
            "setGlobalReset",
            async () => {
                if (ttl <= 0) await this.#client.del(this.#globalKey(scope));
                else
                    await this.#client.set(
                        this.#globalKey(scope),
                        String(resetAt),
                        "PX",
                        ttl,
                    );
            },
            () => undefined,
            false,
        );
    }
}

/**
 * Reads the reservation script's reply. Anything unexpected is an error, not
 * a grant: a broken reply must never let a request through unreserved.
 */
function parseReservation(result: unknown): Reservation {
    if (!Array.isArray(result) || result.length < 3)
        throw new Error("Unexpected reply from the reservation script.");
    const [granted, value, flag] = result as [unknown, unknown, unknown];
    const n = Number(value);
    if (!Number.isFinite(n))
        throw new Error("Unexpected reply from the reservation script.");
    if (Number(granted) === 1)
        return { granted: true, known: Number(flag) === 1, resetAt: n };
    const reason = String(flag);
    return {
        granted: false,
        retryAfterMs: Math.max(0, n),
        reason: reason === "global" || reason === "probe" ? reason : "bucket",
    };
}
