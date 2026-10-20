import { describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";

const G = "100000000000000001";
const U = "400000000000000001";
const C = "300000000000000001";
const M = "500000000000000001";
const R1 = "200000000000000001";
const R2 = "200000000000000002";
const JOINED = "2020-01-01T00:00:00Z";

type Rest = Record<"get" | "patch" | "post", (...args: unknown[]) => unknown>;

function setup(options: Record<string, unknown> = {}) {
    const client = new Client({
        token: "a.b",
        intents: ["Guilds"],
        ...options,
    } as ConstructorParameters<typeof Client>[0]);
    const ws = client.ws as unknown as { emit(e: string, d: unknown): void };
    ws.emit("GUILD_CREATE", {
        id: G,
        name: "g",
        roles: [],
        channels: [{ id: C, type: 0, name: "c" }],
        members: [
            { user: { id: U, username: "u" }, roles: [R1], joined_at: JOINED },
        ],
    });
    return { client, ws, rest: client.rest as unknown as Rest };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

const message = (author = "u") => ({
    id: M,
    channel_id: C,
    guild_id: G,
    content: "hi",
    author: { id: U, username: author },
    timestamp: JOINED,
});

describe("a REST fetch in flight cannot undo a Gateway update (C1)", () => {
    test("member roles from GUILD_MEMBER_UPDATE survive a stale fetch", async () => {
        const { client, ws, rest } = setup();
        const reply = deferred<unknown>();
        rest.get = () => reply.promise;
        const held = client.guilds.members(G).get(U)!;
        const pending = client.guilds.members(G).fetch(U);
        ws.emit("GUILD_MEMBER_UPDATE", {
            guild_id: G,
            user: { id: U, username: "u" },
            roles: [R2],
            joined_at: JOINED,
        });
        reply.resolve({
            user: { id: U, username: "u" },
            roles: [R1],
            joined_at: JOINED,
        });
        await pending;
        expect(client.guilds.members(G).get(U)).toBe(held);
        expect(held.roleIds).toEqual([R2]);
        client.destroy();
    });

    test("guild, channel and user updates survive stale fetches", async () => {
        const { client, ws, rest } = setup();
        const guild = deferred<unknown>();
        const channel = deferred<unknown>();
        const user = deferred<unknown>();
        rest.get = (path) =>
            String(path).startsWith("/guilds")
                ? guild.promise
                : String(path).startsWith("/channels")
                  ? channel.promise
                  : user.promise;
        const pending = [
            client.guilds.fetch(G),
            client.channels.fetch(C),
            client.users.fetch(U),
        ];
        ws.emit("GUILD_UPDATE", { id: G, name: "new" });
        ws.emit("CHANNEL_UPDATE", { id: C, type: 0, name: "new", guild_id: G });
        ws.emit("MESSAGE_CREATE", message("newname"));
        guild.resolve({ id: G, name: "g" });
        channel.resolve({ id: C, type: 0, name: "c", guild_id: G });
        user.resolve({ id: U, username: "u" });
        await Promise.all(pending);
        expect(client.guilds.get(G)!.name).toBe("new");
        expect((client.channels.get(C) as { name?: string }).name).toBe("new");
        expect(client.users.get(U)!.username).toBe("newname");
        client.destroy();
    });
});

describe("message fetch races (C2)", () => {
    test("MESSAGE_DELETE during a fetch does not bring the message back", async () => {
        const { client, ws, rest } = setup({ messageCache: { maxSize: 10 } });
        const reply = deferred<unknown>();
        rest.get = () => reply.promise;
        const pending = client.channels.messages(C).fetch(M);
        ws.emit("MESSAGE_DELETE", { id: M, channel_id: C, guild_id: G });
        reply.resolve(message());
        const fetched = await pending;
        expect(fetched.id).toBe(M);
        expect(client.channels.messages(C).cache.has(M)).toBe(false);
        client.destroy();
    });

    test("MESSAGE_UPDATE during a fetch keeps the newer content", async () => {
        const { client, ws, rest } = setup({ messageCache: { maxSize: 10 } });
        ws.emit("MESSAGE_CREATE", message());
        const reply = deferred<unknown>();
        rest.get = () => reply.promise;
        const pending = client.channels.messages(C).fetch(M);
        ws.emit("MESSAGE_UPDATE", { ...message(), content: "edited" });
        reply.resolve(message());
        expect((await pending).content).toBe("edited");
        expect(client.channels.messages(C).cache.peek(M)!.content).toBe(
            "edited",
        );
        client.destroy();
    });

    test("concurrent fetches share one request; a failed one can be retried", async () => {
        const { client, rest } = setup({ messageCache: { maxSize: 10 } });
        let calls = 0;
        rest.get = async () => {
            calls++;
            if (calls === 1) throw new Error("boom");
            return message();
        };
        const messages = client.channels.messages(C);
        const [a, b] = [messages.fetch(M), messages.fetch(M)];
        await expect(a).rejects.toThrow("boom");
        await expect(b).rejects.toThrow("boom");
        expect(calls).toBe(1);
        expect((await messages.fetch(M)).id).toBe(M);
        expect(messages.cache.has(M)).toBe(true);
        client.destroy();
    });

    test("set() without a message cache stores nothing", () => {
        const { client, ws } = setup();
        ws.emit("MESSAGE_CREATE", message());
        const messages = client.channels.messages(C);
        messages.set(M, messages.upsert(message()));
        expect(messages.cache.size).toBe(0);
        client.destroy();
    });
});

describe("cache.maxUsers (C3)", () => {
    test("bounds client.users with LRU eviction", () => {
        const { client, ws } = setup({ cache: { maxUsers: 10 } });
        for (let i = 0; i < 50; i++)
            ws.emit("MESSAGE_CREATE", {
                ...message(),
                id: String(600000000000000000n + BigInt(i)),
                author: {
                    id: String(700000000000000000n + BigInt(i)),
                    username: "x",
                },
            });
        expect(client.users.size).toBe(10);
        expect(client.users.has("700000000000000049")).toBe(true);
        expect(client.users.has("700000000000000000")).toBe(false);
        client.destroy();
    });

    test("is unbounded by default", () => {
        const { client, ws } = setup();
        for (let i = 0; i < 50; i++)
            ws.emit("GUILD_MEMBER_ADD", {
                guild_id: G,
                user: {
                    id: String(700000000000000000n + BigInt(i)),
                    username: "x",
                },
                roles: [],
                joined_at: JOINED,
            });
        expect(client.users.size).toBe(51);
        client.destroy();
    });
});

describe("REST edits keep the cached instance (C4)", () => {
    test("members.edit(), editMe() and search() merge in place", async () => {
        const { client, rest } = setup();
        const members = client.guilds.members(G);
        const held = members.get(U)!;
        const data = (nick: string) => ({
            user: { id: U, username: "u" },
            nick,
            roles: [R1],
            joined_at: JOINED,
        });
        rest.patch = async () => data("edited");
        expect(await members.edit(U, { nick: "edited" })).toBe(held);
        expect(held.nickname).toBe("edited");
        rest.patch = async () => data("me");
        expect(await members.editMe({ nick: "me" })).toBe(held);
        rest.get = async () => [data("found")];
        expect((await members.search("u"))[0]).toBe(held);
        expect(held.nickname).toBe("found");
        expect(members.get(U)).toBe(held);
        client.destroy();
    });

    test("roles.edit(), fetchAll() and setPositions() merge in place", async () => {
        const { client, ws, rest } = setup();
        ws.emit("GUILD_ROLE_CREATE", {
            guild_id: G,
            role: { id: R1, name: "a", permissions: "0" },
        });
        const roles = client.guilds.roles(G);
        const held = roles.get(R1)!;
        rest.patch = async () => ({ id: R1, name: "b", permissions: "0" });
        expect(await roles.edit(R1, { name: "b" })).toBe(held);
        expect(held.name).toBe("b");
        rest.get = async () => [{ id: R1, name: "c", permissions: "0" }];
        expect((await roles.fetchAll())[0]).toBe(held);
        rest.patch = async () => [
            { id: R1, name: "d", permissions: "0", position: 2 },
        ];
        expect((await roles.setPositions([{ id: R1, position: 2 }]))[0]).toBe(
            held,
        );
        expect(held.name).toBe("d");
        expect(roles.get(R1)).toBe(held);
        client.destroy();
    });
});

describe("events for a guild the bot has left (C5)", () => {
    test("do not recreate per-guild state", () => {
        const { client, ws } = setup();
        ws.emit("GUILD_DELETE", { id: G });
        ws.emit("GUILD_MEMBER_UPDATE", {
            guild_id: G,
            user: { id: U, username: "u" },
            roles: [],
            joined_at: JOINED,
        });
        ws.emit("GUILD_MEMBER_REMOVE", {
            guild_id: G,
            user: { id: U, username: "u" },
        });
        ws.emit("GUILD_BAN_ADD", {
            guild_id: G,
            user: { id: U, username: "u" },
        });
        ws.emit("GUILD_BAN_REMOVE", {
            guild_id: G,
            user: { id: U, username: "u" },
        });
        expect(client.guilds.members(G).size).toBe(0);
        expect(client.guilds.bans(G).size).toBe(0);
        client.destroy();
    });

    test("bans and removals still apply to a cached guild", () => {
        const { client, ws } = setup();
        ws.emit("GUILD_BAN_ADD", {
            guild_id: G,
            user: { id: U, username: "u" },
        });
        expect(client.guilds.bans(G).has(U)).toBe(true);
        expect(client.guilds.members(G).has(U)).toBe(false);
        ws.emit("GUILD_BAN_REMOVE", {
            guild_id: G,
            user: { id: U, username: "u" },
        });
        expect(client.guilds.bans(G).has(U)).toBe(false);
        client.destroy();
    });

    test("without the Guilds intent, members of uncached guilds are still kept", () => {
        const client = new Client({ token: "a.b", intents: ["GuildMembers"] });
        const ws = client.ws as unknown as {
            emit(e: string, d: unknown): void;
        };
        ws.emit("GUILD_MEMBER_ADD", {
            guild_id: G,
            user: { id: U, username: "u" },
            roles: [],
            joined_at: JOINED,
        });
        expect(client.guilds.members(G).has(U)).toBe(true);
        ws.emit("GUILD_MEMBER_REMOVE", {
            guild_id: G,
            user: { id: U, username: "u" },
        });
        expect(client.guilds.members(G).has(U)).toBe(false);
        client.destroy();
    });
});
