/**
 * A shared cache in Redis, beside the in-memory one.
 *
 * The in-memory cache of each process holds the guilds its shards receive.
 * `RedisCache` mirrors the same Gateway events into Redis as raw Discord
 * payloads, so any process — another cluster, a dashboard, a worker without
 * a Gateway — can read any guild. It never replaces the synchronous cache.
 */

import type { RedisCommandClient } from "@lunibee/collection";

export type { RedisCommandClient };

/** What `attach()` listens to: a `Client` (its `raw` event) or a `Gateway` (`RAW`). */
export interface RawDispatchSource {
    // Loose on purpose: Client and Gateway type their events differently.
    // biome-ignore lint/suspicious/noExplicitAny: structural emitter shape
    on(event: any, listener: any): unknown;
    // biome-ignore lint/suspicious/noExplicitAny: structural emitter shape
    off(event: any, listener: any): unknown;
}

/** Options for {@link RedisCache}. */
export interface RedisCacheOptions {
    /** The Redis client. `Bun.RedisClient` works as it is; for ioredis pass `{ send: (c, a) => redis.call(c, ...a) }`. */
    client: RedisCommandClient;
    /** Key prefix. Default `"lunibee:cache:"`; keys are versioned under it (`…v1:…`). */
    prefix?: string;
    /** Store members and their users. Default `true`. */
    members?: boolean;
    /** Expire every key this many seconds after its last write. Default: never. */
    ttlSeconds?: number;
    /** Called when a write fails. Writes never throw into the Gateway. */
    onError?: (operation: string, error: unknown) => void;
}

/** Health of a {@link RedisCache}. */
export interface RedisCacheDiagnostics {
    /** Events written. */
    writes: number;
    /** Writes that failed. */
    failures: number;
    /** Events waiting to be written. */
    pending: number;
}

type Payload = Record<string, unknown>;

/** Guild fields kept in their own hashes, not in the guild document. */
const GUILD_LISTS = [
    "members",
    "channels",
    "threads",
    "roles",
    "presences",
    "voice_states",
    "stage_instances",
    "guild_scheduled_events",
    "soundboard_sounds",
];
/** Fields per HSET, so a 100,000-member guild is not one giant command. */
const CHUNK = 1000;

const id = (value: unknown): string | undefined =>
    typeof value === "string" && /^\d{1,20}$/.test(value) ? value : undefined;

/**
 * A Redis mirror of guilds, channels, roles, members and users.
 *
 * ```ts
 * const shared = new RedisCache({ client: new Bun.RedisClient(process.env.REDIS_URL) });
 * shared.attach(client);                  // or each shard's Gateway
 * const guild = await shared.guild(id);   // from any process
 * ```
 *
 * Writes for one guild are applied in Gateway order; a failed write is
 * reported through `onError` and never reaches the Gateway. Reads throw on a
 * Redis error. Values are raw Discord payloads (`APIGuild`-shaped JSON).
 */
export class RedisCache {
    readonly #redis: RedisCommandClient;
    readonly #prefix: string;
    readonly #members: boolean;
    readonly #ttl?: number;
    readonly #onError?: RedisCacheOptions["onError"];
    /** Per-guild write chains, so one guild's events land in order. */
    readonly #chains = new Map<string, Promise<void>>();
    readonly #attached = new Map<
        RawDispatchSource,
        { event: string; listener: (payload: never) => void }
    >();
    #writes = 0;
    #failures = 0;
    #pending = 0;

    public constructor(options: RedisCacheOptions) {
        this.#redis = options.client;
        this.#prefix = `${options.prefix ?? "lunibee:cache:"}v1:`;
        this.#members = options.members ?? true;
        if (
            options.ttlSeconds !== undefined &&
            !(Number.isInteger(options.ttlSeconds) && options.ttlSeconds > 0)
        )
            throw new RangeError("ttlSeconds must be a positive integer.");
        this.#ttl = options.ttlSeconds;
        this.#onError = options.onError;
    }

    // ── Wiring ────────────────────────────────────────────────────────────────

    /**
     * Mirrors the dispatches of a `Client` (its `raw` event) or of one
     * `Gateway` (`RAW`). Attach each shard's Gateway, or the client once.
     */
    public attach(source: RawDispatchSource): this {
        if (this.#attached.has(source)) return this;
        const event = "gateway" in (source as object) ? "raw" : "RAW";
        const listener = (payload: never): void => {
            const { event: name, data } = payload as {
                event?: string;
                data?: unknown;
            };
            if (typeof name === "string") this.handle(name, data);
        };
        source.on(event, listener);
        this.#attached.set(source, { event, listener });
        return this;
    }

    /** Stops mirroring `source` (or every source). */
    public detach(source?: RawDispatchSource): this {
        for (const [s, { event, listener }] of this.#attached)
            if (!source || s === source) {
                s.off(event, listener);
                this.#attached.delete(s);
            }
        return this;
    }

    /** Resolves when every write queued so far has been applied (or failed). */
    public async flush(): Promise<void> {
        while (this.#chains.size > 0)
            await Promise.all([...this.#chains.values()]);
    }

    public diagnostics(): RedisCacheDiagnostics {
        return {
            writes: this.#writes,
            failures: this.#failures,
            pending: this.#pending,
        };
    }

    /**
     * Applies one Gateway dispatch. `attach()` calls it; call it yourself to
     * feed events from elsewhere (an IPC relay, a replay).
     */
    public handle(event: string, data: unknown): void {
        if (!data || typeof data !== "object") return;
        const d = data as Payload;
        // Users are shared by every guild: their writes go on one chain, in
        // Gateway order, so a member event of one guild cannot overwrite a
        // newer user written from another.
        const users = this.#usersOf(event, d);
        if (users.length)
            this.#enqueue("users", event, async () => {
                for (const user of users)
                    await this.#setJSON(
                        this.#k("user", user.id as string),
                        user,
                    );
            });
        const write = this.#writer(event, d);
        if (!write) return;
        const guild = id(d.guild_id) ?? id(d.id) ?? "-";
        // USER_UPDATE and the like have no guild; they share one chain.
        const key = event.startsWith("GUILD_") || d.guild_id ? guild : "-";
        this.#enqueue(key, event, write);
    }

    #usersOf(event: string, d: Payload): Payload[] {
        const list: unknown[] =
            event === "USER_UPDATE"
                ? [d]
                : !this.#members
                  ? []
                  : event === "GUILD_CREATE" || event === "GUILD_MEMBERS_CHUNK"
                    ? ((d.members as Payload[] | undefined) ?? []).map(
                          (m) => m?.user,
                      )
                    : event === "GUILD_MEMBER_ADD" ||
                        event === "GUILD_MEMBER_UPDATE"
                      ? [d.user]
                      : [];
        return list.filter(
            (u): u is Payload =>
                !!u && typeof u === "object" && !!id((u as Payload).id),
        );
    }

    #enqueue(key: string, event: string, write: () => Promise<void>): void {
        this.#pending++;
        const previous = this.#chains.get(key) ?? Promise.resolve();
        const next = previous.then(async () => {
            try {
                await write();
                this.#writes++;
            } catch (error) {
                this.#failures++;
                try {
                    this.#onError?.(event, error);
                } catch {
                    // Diagnostics never break the Gateway.
                }
            } finally {
                this.#pending--;
            }
        });
        this.#chains.set(key, next);
        void next.then(() => {
            if (this.#chains.get(key) === next) this.#chains.delete(key);
        });
    }

    // ── Keys and commands ─────────────────────────────────────────────────────

    #k(...parts: string[]): string {
        return this.#prefix + parts.join(":");
    }

    async #cmd(command: string, ...args: string[]): Promise<unknown> {
        return this.#redis.send(command, args);
    }

    async #setJSON(key: string, value: unknown): Promise<void> {
        const args = [key, JSON.stringify(value)];
        if (this.#ttl) args.push("EX", String(this.#ttl));
        await this.#redis.send("SET", args);
    }

    async #touch(key: string): Promise<void> {
        if (this.#ttl) await this.#cmd("EXPIRE", key, String(this.#ttl));
    }

    async #hset(key: string, entries: Array<[string, unknown]>): Promise<void> {
        for (let i = 0; i < entries.length; i += CHUNK) {
            const args: string[] = [key];
            for (const [field, value] of entries.slice(i, i + CHUNK))
                args.push(field, JSON.stringify(value));
            await this.#redis.send("HSET", args);
        }
        if (entries.length) await this.#touch(key);
    }

    async #channel(channel: Payload, guildId?: string): Promise<void> {
        const channelId = id(channel.id);
        if (!channelId) return;
        const value = guildId ? { ...channel, guild_id: guildId } : channel;
        await this.#setJSON(this.#k("channel", channelId), value);
        if (guildId)
            await this.#hset(this.#k("guild", guildId, "channels"), [
                [channelId, value],
            ]);
    }

    async #member(guildId: string, member: Payload): Promise<void> {
        if (!this.#members) return;
        const userId = id((member.user as Payload | undefined)?.id);
        if (!userId) return;
        const { user: _user, ...rest } = member;
        await this.#hset(this.#k("guild", guildId, "members"), [
            [userId, { ...rest, user_id: userId }],
        ]);
    }

    async #dropGuild(guildId: string): Promise<void> {
        const channels = (await this.#cmd(
            "HKEYS",
            this.#k("guild", guildId, "channels"),
        )) as string[] | null;
        const keys = [
            this.#k("guild", guildId),
            this.#k("guild", guildId, "channels"),
            this.#k("guild", guildId, "roles"),
            this.#k("guild", guildId, "members"),
            ...(channels ?? []).map((c) => this.#k("channel", c)),
        ];
        await this.#redis.send("DEL", keys);
        await this.#cmd("SREM", this.#k("guilds"), guildId);
    }

    async #patchGuild(guildId: string, patch: Payload): Promise<void> {
        const current = await this.guild(guildId);
        if (!current) return;
        await this.#setJSON(this.#k("guild", guildId), {
            ...current,
            ...patch,
        });
    }

    // ── Event handlers ────────────────────────────────────────────────────────

    #writer(event: string, d: Payload): (() => Promise<void>) | undefined {
        const guildId = id(d.guild_id);
        switch (event) {
            case "GUILD_CREATE":
            case "GUILD_UPDATE":
                return async () => {
                    const gid = id(d.id);
                    if (!gid) return;
                    const doc: Payload = {};
                    for (const [k, v] of Object.entries(d))
                        if (!GUILD_LISTS.includes(k)) doc[k] = v;
                    if (event === "GUILD_CREATE") {
                        // A fresh snapshot replaces whatever was stored.
                        await this.#dropGuild(gid);
                        await this.#hset(
                            this.#k("guild", gid, "roles"),
                            ((d.roles as Payload[]) ?? [])
                                .filter((r) => id(r.id))
                                .map((r) => [r.id as string, r]),
                        );
                        for (const c of [
                            ...((d.channels as Payload[]) ?? []),
                            ...((d.threads as Payload[]) ?? []),
                        ])
                            await this.#channel(c, gid);
                        if (this.#members) {
                            const members = (
                                (d.members as Payload[]) ?? []
                            ).filter((m) =>
                                id((m.user as Payload | undefined)?.id),
                            );
                            await this.#hset(
                                this.#k("guild", gid, "members"),
                                members.map((m) => {
                                    const { user, ...rest } = m;
                                    const uid = (user as Payload).id as string;
                                    return [uid, { ...rest, user_id: uid }];
                                }),
                            );
                        }
                        await this.#setJSON(this.#k("guild", gid), doc);
                    } else {
                        if (Array.isArray(d.roles))
                            await this.#hset(
                                this.#k("guild", gid, "roles"),
                                (d.roles as Payload[])
                                    .filter((r) => id(r.id))
                                    .map((r) => [r.id as string, r]),
                            );
                        const current = await this.guild(gid);
                        await this.#setJSON(this.#k("guild", gid), {
                            ...current,
                            ...doc,
                        });
                    }
                    await this.#cmd("SADD", this.#k("guilds"), gid);
                };
            case "GUILD_DELETE":
                return async () => {
                    const gid = id(d.id);
                    if (!gid) return;
                    // An outage keeps the data; leaving or a kick drops it.
                    if (d.unavailable === true)
                        await this.#patchGuild(gid, { unavailable: true });
                    else await this.#dropGuild(gid);
                };
            case "CHANNEL_CREATE":
            case "CHANNEL_UPDATE":
            case "THREAD_CREATE":
            case "THREAD_UPDATE":
                return () => this.#channel(d, guildId);
            case "CHANNEL_DELETE":
            case "THREAD_DELETE":
                return async () => {
                    const channelId = id(d.id);
                    if (!channelId) return;
                    await this.#cmd("DEL", this.#k("channel", channelId));
                    if (guildId)
                        await this.#cmd(
                            "HDEL",
                            this.#k("guild", guildId, "channels"),
                            channelId,
                        );
                };
            case "GUILD_ROLE_CREATE":
            case "GUILD_ROLE_UPDATE":
                return async () => {
                    const role = d.role as Payload | undefined;
                    if (!guildId || !role || !id(role.id)) return;
                    await this.#hset(this.#k("guild", guildId, "roles"), [
                        [role.id as string, role],
                    ]);
                };
            case "GUILD_ROLE_DELETE":
                return async () => {
                    const roleId = id(d.role_id);
                    if (!guildId || !roleId) return;
                    await this.#cmd(
                        "HDEL",
                        this.#k("guild", guildId, "roles"),
                        roleId,
                    );
                };
            case "GUILD_MEMBER_ADD":
            case "GUILD_MEMBER_UPDATE":
                return async () => {
                    if (!guildId) return;
                    if (event === "GUILD_MEMBER_UPDATE" && this.#members) {
                        // An update carries a partial member: merge it.
                        const userId = id((d.user as Payload | undefined)?.id);
                        const current = userId
                            ? await this.#hget<Payload>(
                                  this.#k("guild", guildId, "members"),
                                  userId,
                              )
                            : undefined;
                        await this.#member(guildId, { ...current, ...d });
                    } else await this.#member(guildId, d);
                };
            case "GUILD_MEMBER_REMOVE":
                return async () => {
                    const userId = id((d.user as Payload | undefined)?.id);
                    if (!guildId || !userId || !this.#members) return;
                    await this.#cmd(
                        "HDEL",
                        this.#k("guild", guildId, "members"),
                        userId,
                    );
                };
            case "GUILD_MEMBERS_CHUNK":
                return async () => {
                    if (!guildId) return;
                    for (const m of (d.members as Payload[]) ?? [])
                        await this.#member(guildId, m);
                };
            case "GUILD_EMOJIS_UPDATE":
                return async () => {
                    if (guildId)
                        await this.#patchGuild(guildId, { emojis: d.emojis });
                };
            case "GUILD_STICKERS_UPDATE":
                return async () => {
                    if (guildId)
                        await this.#patchGuild(guildId, {
                            stickers: d.stickers,
                        });
                };
            default:
                return undefined;
        }
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    async #get<T>(key: string): Promise<T | undefined> {
        const raw = (await this.#cmd("GET", key)) as string | null;
        return raw ? (JSON.parse(raw) as T) : undefined;
    }

    async #hget<T>(key: string, field: string): Promise<T | undefined> {
        const raw = (await this.#cmd("HGET", key, field)) as string | null;
        return raw ? (JSON.parse(raw) as T) : undefined;
    }

    async #hvals<T>(key: string): Promise<T[]> {
        const raw = ((await this.#cmd("HVALS", key)) as string[] | null) ?? [];
        return raw.map((v) => JSON.parse(v) as T);
    }

    /** The guild document (without its channels, roles and members). */
    public guild<T extends object = Payload>(
        guildId: string,
    ): Promise<T | undefined> {
        return this.#get<T>(this.#k("guild", guildId));
    }

    /** Ids of every guild in the cache. */
    public async guildIds(): Promise<string[]> {
        return (
            ((await this.#cmd("SMEMBERS", this.#k("guilds"))) as
                string[] | null) ?? []
        );
    }

    /** A channel or thread, with its `guild_id`. */
    public channel<T extends object = Payload>(
        channelId: string,
    ): Promise<T | undefined> {
        return this.#get<T>(this.#k("channel", channelId));
    }

    /** Every channel and thread of a guild. */
    public channels<T extends object = Payload>(guildId: string): Promise<T[]> {
        return this.#hvals<T>(this.#k("guild", guildId, "channels"));
    }

    public role<T extends object = Payload>(
        guildId: string,
        roleId: string,
    ): Promise<T | undefined> {
        return this.#hget<T>(this.#k("guild", guildId, "roles"), roleId);
    }

    public roles<T extends object = Payload>(guildId: string): Promise<T[]> {
        return this.#hvals<T>(this.#k("guild", guildId, "roles"));
    }

    public user<T extends object = Payload>(
        userId: string,
    ): Promise<T | undefined> {
        return this.#get<T>(this.#k("user", userId));
    }

    /** A member, with its `user` attached. */
    public async member<T extends object = Payload>(
        guildId: string,
        userId: string,
    ): Promise<T | undefined> {
        const member = await this.#hget<Payload>(
            this.#k("guild", guildId, "members"),
            userId,
        );
        if (!member) return undefined;
        return { ...member, user: await this.user(userId) } as T;
    }

    /** Every cached member of a guild, with users. Large guilds: mind the size. */
    public async members<T extends object = Payload>(
        guildId: string,
    ): Promise<T[]> {
        const members = await this.#hvals<Payload>(
            this.#k("guild", guildId, "members"),
        );
        if (members.length === 0) return [];
        const users = (await this.#redis.send(
            "MGET",
            members.map((m) => this.#k("user", String(m.user_id))),
        )) as Array<string | null>;
        return members.map((m, i) => ({
            ...m,
            user: users[i] ? JSON.parse(users[i]!) : undefined,
        })) as T[];
    }
}
