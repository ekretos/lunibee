import { describe, expect, test } from "bun:test";
import { Client, RedisCache } from "../packages/core/src/index.ts";
import { createCommandRedis } from "./helpers/fake-redis-commands.ts";

const G = "100000000000000001";
const C1 = "200000000000000001";
const C2 = "200000000000000002";
const T1 = "200000000000000009";
const R1 = "300000000000000001";
const U1 = "400000000000000001";
const U2 = "400000000000000002";

const guildCreate = {
    id: G,
    name: "guild",
    emojis: [],
    roles: [{ id: R1, name: "role" }, { name: "no id" }],
    channels: [{ id: C1, type: 0, name: "general" }],
    threads: [{ id: T1, type: 11, name: "thread", guild_id: G }],
    members: [
        { user: { id: U1, username: "one" }, roles: [R1], nick: null },
        { user: { username: "no id" }, roles: [] },
    ],
    presences: [{ user: { id: U1 } }],
};

function setup(
    options: Partial<ConstructorParameters<typeof RedisCache>[0]> = {},
) {
    const redis = createCommandRedis();
    const errors: string[] = [];
    const cache = new RedisCache({
        client: redis.client,
        onError: (op) => void errors.push(op),
        ...options,
    });
    return { redis, cache, errors };
}

describe("RedisCache", () => {
    test("mirrors a GUILD_CREATE and reads it back from any instance", async () => {
        const { redis, cache } = setup();
        cache.handle("GUILD_CREATE", guildCreate);
        await cache.flush();
        const reader = new RedisCache({ client: redis.client });
        const guild = await reader.guild(G);
        expect(guild).toEqual({ id: G, name: "guild", emojis: [] });
        expect(await reader.guildIds()).toEqual([G]);
        expect(await reader.roles(G)).toEqual([{ id: R1, name: "role" }]);
        expect(await reader.role(G, R1)).toEqual({ id: R1, name: "role" });
        expect((await reader.channels(G)).map((c) => c.id).sort()).toEqual([
            C1,
            T1,
        ]);
        expect(await reader.channel(C1)).toEqual({
            id: C1,
            type: 0,
            name: "general",
            guild_id: G,
        });
        expect(await reader.member(G, U1)).toEqual({
            roles: [R1],
            nick: null,
            user_id: U1,
            user: { id: U1, username: "one" },
        });
        expect(await reader.members(G)).toHaveLength(1);
        expect(await reader.user(U1)).toEqual({ id: U1, username: "one" });
        expect(await reader.member(G, U2)).toBeUndefined();
        expect(await reader.members("1")).toEqual([]);
        for (const key of redis.keys())
            expect(key).toStartWith("lunibee:cache:v1:");
        // One write for the guild, one for its users.
        expect(cache.diagnostics()).toEqual({
            writes: 2,
            failures: 0,
            pending: 0,
        });
    });

    test("follows updates, deletes and partial members in order", async () => {
        const { cache } = setup();
        cache.handle("GUILD_CREATE", guildCreate);
        cache.handle("GUILD_UPDATE", {
            id: G,
            name: "renamed",
            roles: [{ id: R1, name: "r2" }],
        });
        cache.handle("GUILD_EMOJIS_UPDATE", {
            guild_id: G,
            emojis: [{ id: "1" }],
        });
        cache.handle("GUILD_STICKERS_UPDATE", { guild_id: G, stickers: [] });
        cache.handle("CHANNEL_CREATE", { id: C2, type: 0, guild_id: G });
        cache.handle("CHANNEL_UPDATE", {
            id: C1,
            type: 0,
            name: "renamed",
            guild_id: G,
        });
        cache.handle("THREAD_DELETE", { id: T1, guild_id: G });
        cache.handle("GUILD_ROLE_CREATE", {
            guild_id: G,
            role: { id: "300000000000000002" },
        });
        cache.handle("GUILD_ROLE_UPDATE", {
            guild_id: G,
            role: { id: R1, name: "r3" },
        });
        cache.handle("GUILD_ROLE_DELETE", {
            guild_id: G,
            role_id: "300000000000000002",
        });
        cache.handle("GUILD_MEMBER_UPDATE", {
            guild_id: G,
            user: { id: U1, username: "one" },
            nick: "n",
        });
        cache.handle("GUILD_MEMBER_ADD", {
            guild_id: G,
            user: { id: U2, username: "two" },
            roles: [],
        });
        cache.handle("GUILD_MEMBERS_CHUNK", {
            guild_id: G,
            members: [{ user: { id: "400000000000000003" }, roles: [] }],
        });
        cache.handle("GUILD_MEMBER_REMOVE", { guild_id: G, user: { id: U2 } });
        cache.handle("USER_UPDATE", { id: U1, username: "renamed" });
        await cache.flush();

        expect(await cache.guild(G)).toMatchObject({
            name: "renamed",
            emojis: [{ id: "1" }],
            stickers: [],
        });
        expect(await cache.role(G, R1)).toEqual({ id: R1, name: "r3" });
        expect(await cache.roles(G)).toHaveLength(1);
        expect((await cache.channels(G)).map((c) => c.id).sort()).toEqual([
            C1,
            C2,
        ]);
        expect(await cache.channel(C1)).toMatchObject({ name: "renamed" });
        expect(await cache.channel(T1)).toBeUndefined();
        // The partial update kept the roles it did not carry.
        expect(await cache.member(G, U1)).toMatchObject({
            nick: "n",
            roles: [R1],
        });
        expect(await cache.member(G, U2)).toBeUndefined();
        expect(await cache.members(G)).toHaveLength(2);
        expect(await cache.user(U1)).toEqual({ id: U1, username: "renamed" });
    });

    test("an outage keeps a guild; leaving drops it and its channels", async () => {
        const { cache } = setup();
        cache.handle("GUILD_CREATE", guildCreate);
        cache.handle("GUILD_DELETE", { id: G, unavailable: true });
        await cache.flush();
        expect(await cache.guild(G)).toMatchObject({ unavailable: true });
        cache.handle("GUILD_DELETE", { id: G });
        await cache.flush();
        expect(await cache.guild(G)).toBeUndefined();
        expect(await cache.channel(C1)).toBeUndefined();
        expect(await cache.roles(G)).toEqual([]);
        expect(await cache.guildIds()).toEqual([]);
        // A new snapshot replaces the old one completely.
        cache.handle("GUILD_CREATE", {
            ...guildCreate,
            channels: [],
            threads: [],
        });
        await cache.flush();
        expect(await cache.channels(G)).toEqual([]);
    });

    test("DM channels, missing ids and unknown events are handled or ignored", async () => {
        const { cache, redis } = setup();
        cache.handle("CHANNEL_CREATE", { id: C2, type: 1 });
        cache.handle("CHANNEL_DELETE", { id: "not-an-id" });
        cache.handle("GUILD_CREATE", { id: "x" });
        cache.handle("GUILD_DELETE", { name: "no id" });
        cache.handle("GUILD_ROLE_CREATE", { guild_id: G });
        cache.handle("GUILD_ROLE_DELETE", { guild_id: G });
        cache.handle("GUILD_MEMBER_ADD", { user: { id: U1 } });
        cache.handle("GUILD_MEMBER_ADD", {
            guild_id: G,
            user: { username: "?" },
        });
        cache.handle("GUILD_MEMBER_REMOVE", { guild_id: G });
        cache.handle("GUILD_MEMBERS_CHUNK", { members: [] });
        cache.handle("GUILD_MEMBERS_CHUNK", { guild_id: G });
        cache.handle("GUILD_EMOJIS_UPDATE", { emojis: [] });
        cache.handle("GUILD_STICKERS_UPDATE", { stickers: [] });
        cache.handle("GUILD_EMOJIS_UPDATE", { guild_id: G, emojis: [] }); // unknown guild
        cache.handle("MESSAGE_CREATE", { id: "1" });
        cache.handle("GUILD_CREATE", null);
        cache.handle("CHANNEL_DELETE", { id: C2 });
        await cache.flush();
        expect(await cache.channel(C2)).toBeUndefined();
        expect(await cache.guild(G)).toBeUndefined();
        // The DM channel, and the user of the guild-less member event.
        expect(redis.ops.get("SET") ?? 0).toBe(2);
    });

    test("members: false stores no members or users from guilds", async () => {
        const { cache, redis } = setup({ members: false });
        cache.handle("GUILD_CREATE", guildCreate);
        cache.handle("GUILD_MEMBER_UPDATE", { guild_id: G, user: { id: U1 } });
        cache.handle("GUILD_MEMBER_REMOVE", { guild_id: G, user: { id: U1 } });
        await cache.flush();
        expect(await cache.members(G)).toEqual([]);
        expect(await cache.user(U1)).toBeUndefined();
        expect(redis.keys().some((k) => k.endsWith(":members"))).toBe(false);
    });

    test("ttlSeconds expires keys; invalid values are refused", async () => {
        const { cache, redis } = setup({ ttlSeconds: 60 });
        cache.handle("GUILD_CREATE", guildCreate);
        await cache.flush();
        expect(redis.ops.get("EXPIRE")).toBeGreaterThan(0);
        const now = Date.now;
        Date.now = () => now() + 61_000;
        try {
            expect(await cache.guild(G)).toBeUndefined();
            expect(await cache.roles(G)).toEqual([]);
            expect(await cache.role(G, R1)).toBeUndefined();
        } finally {
            Date.now = now;
        }
        expect(
            () => new RedisCache({ client: redis.client, ttlSeconds: 0 }),
        ).toThrow(RangeError);
        expect(
            () => new RedisCache({ client: redis.client, ttlSeconds: 1.5 }),
        ).toThrow(RangeError);
    });

    test("a large guild is written in chunks", async () => {
        const { cache, redis } = setup();
        cache.handle("GUILD_CREATE", {
            id: G,
            members: Array.from({ length: 2500 }, (_, i) => ({
                user: { id: String(500000000000000000n + BigInt(i)) },
                roles: [],
            })),
        });
        await cache.flush();
        expect(await cache.members(G)).toHaveLength(2500);
        expect(redis.ops.get("HSET")).toBeGreaterThanOrEqual(3);
    });

    test("a failed write is reported and never thrown; reads throw", async () => {
        const { cache, redis, errors } = setup();
        redis.state.fault = true;
        cache.handle("GUILD_CREATE", guildCreate);
        cache.handle("USER_UPDATE", { id: U1 });
        await cache.flush();
        expect(errors.sort()).toEqual([
            "GUILD_CREATE",
            "GUILD_CREATE",
            "USER_UPDATE",
        ]);
        expect(cache.diagnostics()).toEqual({
            writes: 0,
            failures: 3,
            pending: 0,
        });
        expect(cache.guild(G)).rejects.toThrow("ECONNREFUSED");
        // A throwing onError does not break anything either.
        const loud = new RedisCache({
            client: redis.client,
            onError: () => {
                throw new Error("sink");
            },
        });
        loud.handle("USER_UPDATE", { id: U1 });
        await loud.flush();
        expect(loud.diagnostics().failures).toBe(1);
    });

    test("attaches to a Client's raw event and to a Gateway's RAW, and detaches", async () => {
        const { cache } = setup();
        const client = new Client({ token: "a.b", intents: [] });
        const gateway = client.gateway as unknown as {
            emit(event: string, data: unknown): void;
        };
        cache.attach(client).attach(client);
        gateway.emit("RAW", {
            event: "USER_UPDATE",
            data: { id: U1, username: "a" },
        });
        gateway.emit("RAW", { data: {} });
        await cache.flush();
        expect(await cache.user(U1)).toEqual({ id: U1, username: "a" });

        const listeners = new Map<string, (p: never) => void>();
        const fakeGateway = {
            on: (e: string, l: (p: never) => void) => void listeners.set(e, l),
            off: (e: string) => void listeners.delete(e),
        };
        cache.attach(fakeGateway);
        expect(listeners.has("RAW")).toBe(true);
        listeners.get("RAW")!({
            event: "USER_UPDATE",
            data: { id: U2 },
        } as never);
        await cache.flush();
        expect(await cache.user(U2)).toEqual({ id: U2 });

        cache.detach(fakeGateway);
        expect(listeners.size).toBe(0);
        cache.detach();
        gateway.emit("RAW", {
            event: "USER_UPDATE",
            data: { id: U1, username: "b" },
        });
        await cache.flush();
        expect(await cache.user(U1)).toEqual({ id: U1, username: "a" });
        client.destroy();
    });
});
