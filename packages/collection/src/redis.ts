import type { CollectionStats, EvictionReason } from "./index.js";

/** Anything that runs one Redis command: `Bun.RedisClient` as it is, or an adapter. */
export interface RedisCommandClient {
    send(command: string, args: string[]): Promise<unknown>;
}

/** Turns values into strings for Redis and back. */
export interface RedisSerializer<V> {
    serialize(value: V): string;
    deserialize(raw: string): V;
}

/** Options for {@link RedisCollection}. */
export interface RedisCollectionOptions<V> {
    /** The Redis client. `Bun.RedisClient` works as it is; for ioredis pass `{ send: (c, a) => redis.call(c, ...a) }`. */
    client: RedisCommandClient;
    /** The collection's name: every process using the same name and prefix shares it. */
    name: string;
    /** Key prefix. Default `"lunibee:collection:"`; keys are versioned under it (`…v1:…`). */
    prefix?: string;
    /** Default TTL in ms for `set()`. Omit for no expiry. */
    ttl?: number;
    /** Whether a `get()` restarts a TTL entry's window. Default `true`. */
    slide?: boolean;
    /** Most entries; the least recently used (across every process) are evicted past it. */
    maxSize?: number;
    /** Default JSON. Provide one for values JSON cannot carry (bigint, Map, Date…). */
    serializer?: RedisSerializer<V>;
    /** Called when an operation of this instance removes entries automatically. Exceptions are swallowed. */
    onEvict?: (
        key: string,
        value: V | undefined,
        reason: EvictionReason,
    ) => void;
}

/**
 * Shared Lua helpers. Entries are `<ep><key>` strings holding `<ttl>:<payload>`;
 * `exp` is a sorted set of expiry times, `lru` one of access order (from an
 * `INCR` clock, so two writes in one millisecond still order). Every script
 * reads the time from Redis, so processes with skewed clocks agree.
 */
const PRELUDE = `
local exp, lru, clock, ep = KEYS[1], KEYS[2], KEYS[3], ARGV[1]
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local out = {}
local function drop(m, reason)
  local v = redis.call('GET', ep .. m)
  redis.call('DEL', ep .. m)
  redis.call('ZREM', exp, m)
  redis.call('ZREM', lru, m)
  if reason then
    table.insert(out, m)
    table.insert(out, v or false)
    table.insert(out, reason)
  end
end
local gone = redis.call('ZRANGEBYSCORE', exp, '-inf', now, 'LIMIT', 0, 1000)
for _, m in ipairs(gone) do drop(m, 'expired') end
local function touch(m) redis.call('ZADD', lru, redis.call('INCR', clock), m) end
`;

/** `ARGV`: ep, key, payload, ttl (0 none), maxSize (0 none), mode (`set` | `nx`). Returns `{existing|false, ...evictions}`. */
export const SET_SCRIPT = `${PRELUDE}
local m, payload, ttl, max, mode = ARGV[2], ARGV[3], tonumber(ARGV[4]), tonumber(ARGV[5]), ARGV[6]
if mode == 'nx' then
  local cur = redis.call('GET', ep .. m)
  if cur then
    touch(m)
    table.insert(out, 1, cur)
    return out
  end
end
local env = ttl .. ':' .. payload
if ttl > 0 then
  -- The key outlives its logical expiry by a grace second, so the prune
  -- that reports the expiry can still hand the value to onEvict.
  redis.call('SET', ep .. m, env, 'PX', ttl + 1000)
  redis.call('ZADD', exp, now + ttl, m)
else
  redis.call('SET', ep .. m, env)
  redis.call('ZREM', exp, m)
end
touch(m)
if max > 0 then
  local n = redis.call('ZCARD', lru)
  while n > max do
    local popped = redis.call('ZPOPMIN', lru)
    local victim = popped[1]
    if victim == nil then break end
    if victim ~= m then drop(victim, 'evicted') end
    n = n - 1
  end
end
table.insert(out, 1, false)
return out
`;

/** `ARGV`: ep, key, slide (1/0), touch (1/0). Returns `{envelope|false, ...evictions}`. */
export const GET_SCRIPT = `${PRELUDE}
local m, slide, mark = ARGV[2], ARGV[3], ARGV[4]
local env = redis.call('GET', ep .. m)
if not env then
  redis.call('ZREM', exp, m)
  redis.call('ZREM', lru, m)
  table.insert(out, 1, false)
  return out
end
if mark == '1' then touch(m) end
if slide == '1' then
  local ttl = tonumber(string.match(env, '^(%d+):'))
  if ttl and ttl > 0 then
    redis.call('PEXPIRE', ep .. m, ttl + 1000)
    redis.call('ZADD', exp, now + ttl, m)
  end
end
table.insert(out, 1, env)
return out
`;

/** `ARGV`: ep, key. Returns `{1|0, ...evictions}`. */
export const DELETE_SCRIPT = `${PRELUDE}
local m = ARGV[2]
local existed = redis.call('EXISTS', ep .. m)
drop(m, nil)
table.insert(out, 1, existed)
return out
`;

/** `ARGV`: ep, what (`size` | `keys` | `clear`). */
export const LIST_SCRIPT = `${PRELUDE}
local what = ARGV[2]
if what == 'clear' then
  local n = 0
  repeat
    local batch = redis.call('ZRANGE', lru, 0, 999)
    for _, m in ipairs(batch) do drop(m, nil) end
    n = n + #batch
  until #batch == 0
  redis.call('DEL', exp, lru, clock)
  return {n}
end
local result = what == 'size' and redis.call('ZCARD', lru) or redis.call('ZRANGE', lru, 0, -1)
return {result, unpack(out)}
`;

/** How long an entry's key outlives its logical expiry, for `onEvict` (ms). */
const EXPIRY_GRACE_MS = 1000;

const JSON_SERIALIZER: RedisSerializer<never> = {
    serialize: (value) => JSON.stringify(value),
    deserialize: (raw) => JSON.parse(raw) as never,
};

/**
 * A key-value collection kept in Redis and shared by every process that opens
 * it with the same `name`, with the retention policy of `Collection`: a TTL
 * (sliding by default), a `maxSize` evicting the least recently used across
 * every process, and `onEvict`.
 *
 * Every operation is one atomic script, so two processes never see a
 * half-applied write. The API is async, and values travel as strings
 * (JSON by default).
 *
 * ```ts
 * const sessions = new RedisCollection<Session>({
 *     client: new Bun.RedisClient(process.env.REDIS_URL),
 *     name: "sessions",
 *     ttl: 15 * 60_000,
 *     maxSize: 10_000,
 * });
 * await sessions.set(userId, session);
 * const session = await sessions.get(userId); // from any process
 * ```
 */
export class RedisCollection<V = unknown> {
    readonly #redis: RedisCommandClient;
    readonly #keys: [string, string, string];
    readonly #ep: string;
    readonly #ttl: number;
    readonly #slide: boolean;
    readonly #maxSize: number;
    readonly #serializer: RedisSerializer<V>;
    readonly #onEvict?: RedisCollectionOptions<V>["onEvict"];
    readonly #stats: CollectionStats = {
        hits: 0,
        misses: 0,
        expired: 0,
        evicted: 0,
    };
    /** The collection's name. */
    public readonly name: string;

    public constructor(options: RedisCollectionOptions<V>) {
        if (
            typeof options.name !== "string" ||
            !/^[\w.:-]{1,100}$/.test(options.name)
        )
            throw new TypeError(
                "name must be 1-100 letters, digits, '_', '.', ':' or '-'.",
            );
        checkTTL(options.ttl);
        if (
            options.maxSize !== undefined &&
            !(Number.isInteger(options.maxSize) && options.maxSize > 0)
        )
            throw new RangeError("maxSize must be a positive integer.");
        this.#redis = options.client;
        this.name = options.name;
        // A hash tag keeps one collection's keys in one Redis Cluster slot.
        const base = `${options.prefix ?? "lunibee:collection:"}v1:{${options.name}}:`;
        this.#keys = [`${base}exp`, `${base}lru`, `${base}clock`];
        this.#ep = `${base}e:`;
        this.#ttl = options.ttl ?? 0;
        this.#slide = options.slide ?? true;
        this.#maxSize = options.maxSize ?? 0;
        this.#serializer =
            options.serializer ?? (JSON_SERIALIZER as RedisSerializer<V>);
        this.#onEvict = options.onEvict;
    }

    /** Hits, misses and removals seen by this instance. */
    public get stats(): CollectionStats {
        return { ...this.#stats };
    }

    async #run(script: string, ...argv: string[]): Promise<unknown[]> {
        const reply = (await this.#redis.send("EVAL", [
            script,
            "3",
            ...this.#keys,
            this.#ep,
            ...argv,
        ])) as unknown[];
        if (!Array.isArray(reply))
            throw new Error("Unexpected reply from a RedisCollection script.");
        return reply;
    }

    /** Reports what a script removed, then returns its first value. */
    #settle(reply: unknown[], skip: number): unknown {
        for (let i = skip; i + 2 < reply.length + 0; i += 3) {
            const key = String(reply[i]);
            const raw = reply[i + 1];
            const reason = reply[i + 2] as EvictionReason;
            if (reason === "expired") this.#stats.expired++;
            else this.#stats.evicted++;
            if (!this.#onEvict) continue;
            let value: V | undefined;
            try {
                value = typeof raw === "string" ? this.#decode(raw) : undefined;
            } catch {
                value = undefined;
            }
            try {
                this.#onEvict(key, value, reason);
            } catch {
                // A listener never breaks the collection.
            }
        }
        return reply[0];
    }

    #decode(envelope: string): V {
        const colon = envelope.indexOf(":");
        return this.#serializer.deserialize(envelope.slice(colon + 1));
    }

    /**
     * The value for `key`, or `undefined`. Marks it recently used and, with
     * `slide`, restarts its TTL window.
     */
    public async get(key: string | number): Promise<V | undefined> {
        const raw = this.#settle(
            await this.#run(
                GET_SCRIPT,
                String(key),
                this.#slide ? "1" : "0",
                "1",
            ),
            1,
        );
        if (typeof raw !== "string") {
            this.#stats.misses++;
            return undefined;
        }
        this.#stats.hits++;
        return this.#decode(raw);
    }

    /** The value without marking it used or restarting its window. */
    public async peek(key: string | number): Promise<V | undefined> {
        const raw = this.#settle(
            await this.#run(GET_SCRIPT, String(key), "0", "0"),
            1,
        );
        return typeof raw === "string" ? this.#decode(raw) : undefined;
    }

    /** Whether `key` is present (does not count as a use). */
    public async has(key: string | number): Promise<boolean> {
        return (await this.peek(key)) !== undefined;
    }

    /** Stores `value` with the default TTL, or `ttl` ms (`0`: never expires). */
    public async set(
        key: string | number,
        value: V,
        ttl?: number,
    ): Promise<this> {
        checkTTL(ttl, true);
        this.#settle(
            await this.#run(
                SET_SCRIPT,
                String(key),
                this.#serializer.serialize(value),
                String(Math.ceil(ttl ?? this.#ttl)),
                String(this.#maxSize),
                "set",
            ),
            1,
        );
        return this;
    }

    /** Stores `value` with no expiry. It still counts towards `maxSize`. */
    public setWithoutTTL(key: string | number, value: V): Promise<this> {
        return this.set(key, value, 0);
    }

    /**
     * Returns the value for `key`, or stores and returns what `factory`
     * gives. If two processes race, one value wins and both get it.
     */
    public async ensure(
        key: string | number,
        factory: (key: string) => V | Promise<V>,
        ttl?: number,
    ): Promise<V> {
        const existing = await this.get(key);
        if (existing !== undefined) return existing;
        checkTTL(ttl, true);
        const value = await factory(String(key));
        const raw = this.#settle(
            await this.#run(
                SET_SCRIPT,
                String(key),
                this.#serializer.serialize(value),
                String(Math.ceil(ttl ?? this.#ttl)),
                String(this.#maxSize),
                "nx",
            ),
            1,
        );
        return typeof raw === "string" ? this.#decode(raw) : value;
    }

    /** Removes `key`. Returns whether it was present. */
    public async delete(key: string | number): Promise<boolean> {
        const reply = await this.#run(DELETE_SCRIPT, String(key));
        return Number(this.#settle(reply, 1)) === 1;
    }

    /** Removes every entry. Returns how many there were. */
    public async clear(): Promise<number> {
        const reply = await this.#run(LIST_SCRIPT, "clear");
        return Number(reply[0]);
    }

    /** Live entries. */
    public async size(): Promise<number> {
        return Number(this.#settle(await this.#run(LIST_SCRIPT, "size"), 1));
    }

    /** Live keys, least recently used first. */
    public async keys(): Promise<string[]> {
        return (
            this.#settle(await this.#run(LIST_SCRIPT, "keys"), 1) as string[]
        ).map(String);
    }

    /** Live entries, least recently used first. Reading them does not count as a use. */
    public async entries(): Promise<Array<[string, V]>> {
        const keys = await this.keys();
        if (keys.length === 0) return [];
        const out: Array<[string, V]> = [];
        for (let i = 0; i < keys.length; i += 1000) {
            const batch = keys.slice(i, i + 1000);
            const raws = (await this.#redis.send(
                "MGET",
                batch.map((k) => this.#ep + k),
            )) as Array<string | null>;
            raws.forEach((raw, j) => {
                if (typeof raw === "string")
                    out.push([batch[j]!, this.#decode(raw)]);
            });
        }
        return out;
    }

    /** Live values, least recently used first. */
    public async values(): Promise<V[]> {
        return (await this.entries()).map(([, value]) => value);
    }

    /** Milliseconds left before `key` expires; `undefined` when it never expires or is absent. */
    public async ttlRemaining(
        key: string | number,
    ): Promise<number | undefined> {
        const ms = Number(
            await this.#redis.send("PTTL", [this.#ep + String(key)]),
        );
        // Less the grace second the key outlives its expiry by.
        return ms >= 0 ? Math.max(0, ms - EXPIRY_GRACE_MS) : undefined;
    }
}

function checkTTL(ttl: number | undefined, allowZero = false): void {
    if (ttl === undefined) return;
    if (!Number.isFinite(ttl) || ttl < 0 || (!allowZero && ttl === 0))
        throw new RangeError(
            allowZero
                ? "ttl must be 0 or a positive number."
                : "ttl must be a positive number.",
        );
}
