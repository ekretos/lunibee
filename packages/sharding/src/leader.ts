/**
 * Leadership between several coordinators, so a standby `ClusterManager` can
 * take over when the active one dies. Only the holder of the lock runs
 * clusters; see `ClusterManagerOptions.leader`.
 */
export interface LeaderLock {
    /**
     * Takes the lock for `ttlMs`, or extends it when this process already
     * holds it. Resolves `true` while this process is the leader, `false` when
     * another one holds it. A rejection counts as "unknown".
     */
    acquire(ttlMs: number): Promise<boolean>;
    /** Gives the lock up if this process holds it. */
    release(): Promise<void>;
}

/** The part of a Redis client the lock uses. `Bun.RedisClient` works as it is; for ioredis pass `{ send: (c, a) => redis.call(c, ...a) }`. */
export interface LeaderRedisClient {
    send(command: string, args: string[]): Promise<unknown>;
}

/** Options for {@link RedisLeaderLock}. */
export interface RedisLeaderLockOptions {
    client: LeaderRedisClient;
    /** The key every coordinator of one deployment shares. Default `lunibee:cluster:leader`. */
    key?: string;
    /** This coordinator's identity in the key. Default: a random UUID. Must differ between coordinators. */
    token?: string;
}

// Take the key if it is free, extend it if it is ours: one atomic step, so
// two coordinators can never both see themselves as the holder.
const ACQUIRE = `local v = redis.call('GET', KEYS[1])
if v == ARGV[1] then redis.call('PEXPIRE', KEYS[1], ARGV[2]) return 1 end
if not v then redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) return 1 end
return 0`;
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

/** A {@link LeaderLock} on one Redis key, with an expiry so a dead leader's lock lapses on its own. */
export class RedisLeaderLock implements LeaderLock {
    readonly #client: LeaderRedisClient;
    readonly #key: string;
    readonly #token: string;

    public constructor(options: RedisLeaderLockOptions) {
        if (typeof options?.client?.send !== "function")
            throw new TypeError("RedisLeaderLock needs a client with send().");
        this.#client = options.client;
        this.#key = options.key ?? "lunibee:cluster:leader";
        this.#token = options.token ?? crypto.randomUUID();
        if (!this.#key || !this.#token)
            throw new TypeError("key and token must not be empty.");
    }

    public async acquire(ttlMs: number): Promise<boolean> {
        if (!Number.isInteger(ttlMs) || ttlMs < 1)
            throw new RangeError("ttlMs must be a positive integer.");
        const reply = await this.#client.send("EVAL", [
            ACQUIRE,
            "1",
            this.#key,
            this.#token,
            String(ttlMs),
        ]);
        return Number(reply) === 1;
    }

    public async release(): Promise<void> {
        await this.#client.send("EVAL", [RELEASE, "1", this.#key, this.#token]);
    }
}
