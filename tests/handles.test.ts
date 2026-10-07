import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Client, parseDuration } from "../packages/core/src/index.ts";

afterEach(() => setSystemTime());

const GUILD = "100000000000000001";
const USER = "100000000000000002";
const CHANNEL = "100000000000000003";
const MESSAGE = "100000000000000004";
const ROLE = "100000000000000005";

type Call = { method: string; path: string; body?: unknown; reason?: string };

/** A client whose REST calls are recorded and answered by `answer`. */
function setup(
    answer: (call: Call) => unknown = () => undefined,
    options: Partial<ConstructorParameters<typeof Client>[0]> = {},
) {
    const bot = new Client({ token: "a.b", intents: 0, ...options });
    const calls: Call[] = [];
    for (const method of ["get", "post", "put", "patch", "delete"] as const)
        (bot.rest as unknown as Record<string, unknown>)[method] = async (
            path: string,
            body?: unknown,
            options?: { reason?: string },
        ) => {
            const call: Call = {
                method: method.toUpperCase(),
                path,
                body,
                // delete(path, { reason }) carries its options second; the rest third.
                reason:
                    options?.reason ??
                    (method === "delete"
                        ? (body as { reason?: string } | undefined)?.reason
                        : undefined),
            };
            calls.push(call);
            return answer(call);
        };
    return { bot, calls };
}

/** A snowflake made now, so bulk delete accepts it. */
const freshId = (offset: number) =>
    (
        ((BigInt(Date.now()) - 1_420_070_400_000n) << 22n) +
        BigInt(offset)
    ).toString();

const memberPayload = {
    user: { id: USER, username: "ann" },
    roles: [],
    joined_at: "2024-01-01T00:00:00.000Z",
    deaf: false,
    mute: false,
    guild_id: GUILD,
};
const messagePayload = {
    id: MESSAGE,
    channel_id: CHANNEL,
    author: { id: USER, username: "ann" },
    content: "hello",
};

describe("parseDuration", () => {
    test("reads numbers and unit text", () => {
        expect(parseDuration(1500)).toBe(1500);
        expect(parseDuration("90s")).toBe(90_000);
        expect(parseDuration("10m")).toBe(600_000);
        expect(parseDuration("2h")).toBe(7_200_000);
        expect(parseDuration("1d")).toBe(86_400_000);
        expect(parseDuration("1w")).toBe(604_800_000);
        expect(parseDuration("1h 30m")).toBe(5_400_000);
        expect(parseDuration("250ms")).toBe(250);
        expect(parseDuration("1.5h")).toBe(5_400_000);
    });

    test("rejects anything else", () => {
        for (const bad of ["", "ten minutes", "10", "10x", "-5m", "m10"])
            expect(() => parseDuration(bad), bad).toThrow(RangeError);
        expect(() => parseDuration(-1)).toThrow(RangeError);
        expect(() => parseDuration(Number.NaN)).toThrow(RangeError);
    });
});

describe("handles: peek, get and fetch", () => {
    test("a member is read from the cache first and fetched when missing", async () => {
        const { bot, calls } = setup(() => memberPayload);
        const handle = bot.member(GUILD, USER);
        expect(handle.peek()).toBeUndefined();
        expect(calls).toHaveLength(0);
        const first = await handle.get();
        expect(first.user.id).toBe(USER);
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            `GET /guilds/${GUILD}/members/${USER}`,
        ]);
        expect(handle.peek()).toBe(first);
        expect(await bot.member(GUILD, USER).get()).toBe(first);
        expect(calls).toHaveLength(1);
        const refreshed = await handle.fetch();
        expect(calls).toHaveLength(2);
        expect(handle.peek()).toBe(refreshed);
    });

    test("get() and fetch() issued together share one request", async () => {
        const { bot, calls } = setup(() => memberPayload);
        const handle = bot.member(GUILD, USER);
        const [a, b] = await Promise.all([handle.get(), handle.fetch()]);
        expect(a).toBe(b);
        expect(calls).toHaveLength(1);
    });

    test("channels, roles, users and messages follow the same rule", async () => {
        const { bot, calls } = setup((call) => {
            if (call.path === `/channels/${CHANNEL}`)
                return {
                    id: CHANNEL,
                    type: 0,
                    guild_id: GUILD,
                    name: "general",
                };
            if (call.path === `/guilds/${GUILD}/roles/${ROLE}`)
                return { id: ROLE, name: "mod" };
            if (call.path === `/users/${USER}`)
                return { id: USER, username: "ann" };
            if (call.path === `/channels/${CHANNEL}/messages/${MESSAGE}`)
                return messagePayload;
            return undefined;
        });
        const channel = bot.channel(CHANNEL);
        const role = bot.role(GUILD, ROLE);
        const person = bot.person(USER);
        const message = bot.message(CHANNEL, MESSAGE);
        for (const handle of [channel, role, person, message])
            expect(handle.peek()).toBeUndefined();
        expect((await channel.get()).id).toBe(CHANNEL);
        expect((await role.get()).name).toBe("mod");
        expect((await person.get()).username).toBe("ann");
        expect((await message.get()).content).toBe("hello");
        expect(calls).toHaveLength(4);
        for (const handle of [channel, role, person])
            expect(handle.peek()).toBeDefined();
        await channel.get();
        await role.get();
        await person.get();
        expect(calls).toHaveLength(4);
    });

    test("a handle for something that is not cached does not fail until used", async () => {
        const { bot } = setup(() => {
            throw new Error("Unknown Guild");
        });
        const guild = bot.guild(GUILD);
        expect(guild.peek()).toBeUndefined();
        await expect(guild.get()).rejects.toThrow("Unknown Guild");
        expect(guild.peek()).toBeUndefined();
    });
});

describe("handles: collections", () => {
    test("members and roles are the live caches; channels are this guild's", async () => {
        const { bot } = setup((call) =>
            call.path.includes("/members/") ? memberPayload : undefined,
        );
        const guild = bot.guild(GUILD);
        expect(guild.members.size).toBe(0);
        await bot.member(GUILD, USER).get();
        expect(guild.members.has(USER)).toBe(true);
        expect(guild.members).toBe(bot.guilds.members(GUILD).cache);
        expect(guild.roles).toBe(bot.guilds.roles(GUILD).cache);

        bot.channels.upsert({
            id: CHANNEL,
            type: 0,
            guild_id: GUILD,
            name: "a",
        });
        bot.channels.upsert({
            id: "100000000000000099",
            type: 0,
            guild_id: "100000000000000098",
            name: "elsewhere",
        });
        expect([...guild.channels.keys()]).toEqual([CHANNEL]);
    });
});

describe("handles: actions", () => {
    test("member actions send the right requests and reasons", async () => {
        const { bot, calls } = setup(() => memberPayload);
        const member = bot.guild(GUILD).member(USER);
        await member.kick("spam");
        await member.ban({ reason: "bad", deleteMessageSeconds: 60 });
        await member.unban("sorry");
        await member.addRole(ROLE, "promoted");
        await member.removeRole(ROLE, "demoted");
        await member.edit({ nick: "Ann", reason: "rename" });
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            `DELETE /guilds/${GUILD}/members/${USER}`,
            `PUT /guilds/${GUILD}/bans/${USER}`,
            `DELETE /guilds/${GUILD}/bans/${USER}`,
            `PUT /guilds/${GUILD}/members/${USER}/roles/${ROLE}`,
            `DELETE /guilds/${GUILD}/members/${USER}/roles/${ROLE}`,
            `PATCH /guilds/${GUILD}/members/${USER}`,
        ]);
        expect(calls.map((c) => c.reason)).toEqual([
            "spam",
            "bad",
            "sorry",
            "promoted",
            "demoted",
            "rename",
        ]);
        expect(calls[5]!.body).toEqual({ nick: "Ann" });
    });

    test("timeout accepts text durations and null", async () => {
        setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
        const { bot, calls } = setup(() => memberPayload);
        const member = bot.member(GUILD, USER);
        await member.timeout("10m", "calm down");
        await member.timeout(90_000);
        await member.timeout(null);
        expect(
            calls.map(
                (c) =>
                    (c.body as Record<string, unknown>)
                        .communication_disabled_until,
            ),
        ).toEqual([
            "2025-01-01T00:10:00.000Z",
            "2025-01-01T00:01:30.000Z",
            null,
        ]);
        expect(calls[0]!.reason).toBe("calm down");
        await expect(member.timeout("soon")).rejects.toThrow(RangeError);
        expect(calls).toHaveLength(3);
    });

    test("channel and message actions", async () => {
        const { bot, calls } = setup((call) =>
            call.method === "POST" || call.method === "PATCH"
                ? messagePayload
                : undefined,
        );
        const channel = bot.channel(CHANNEL);
        expect((await channel.send("hi")).id).toBe(MESSAGE);
        await channel.send({ content: "embed", embeds: [{ title: "t" }] });
        await channel.message(MESSAGE).reply("re");
        await channel.message(MESSAGE).edit("edited");
        await channel.message(MESSAGE).react("👍");
        await channel.message(MESSAGE).pin("keep");
        await channel.message(MESSAGE).unpin();
        await channel.message(MESSAGE).delete("bye");
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            `POST /channels/${CHANNEL}/messages`,
            `POST /channels/${CHANNEL}/messages`,
            `POST /channels/${CHANNEL}/messages`,
            `PATCH /channels/${CHANNEL}/messages/${MESSAGE}`,
            `PUT /channels/${CHANNEL}/messages/${MESSAGE}/reactions/%F0%9F%91%8D/@me`,
            `PUT /channels/${CHANNEL}/messages/pins/${MESSAGE}`,
            `DELETE /channels/${CHANNEL}/messages/pins/${MESSAGE}`,
            `DELETE /channels/${CHANNEL}/messages/${MESSAGE}`,
        ]);
        expect(calls[0]!.body).toEqual({ content: "hi" });
        expect(calls[2]!.body).toMatchObject({
            content: "re",
            message_reference: { message_id: MESSAGE, channel_id: CHANNEL },
        });
        expect(calls[3]!.body).toEqual({ content: "edited" });
        expect(calls[7]!.reason).toBe("bye");
    });

    test("role, guild and direct-message actions", async () => {
        const { bot, calls } = setup((call) => {
            if (call.path === "/users/@me/channels")
                return {
                    id: CHANNEL,
                    type: 1,
                    recipients: [{ id: USER, username: "ann" }],
                };
            if (call.method === "POST") return messagePayload;
            if (call.path === `/guilds/${GUILD}/roles/${ROLE}`)
                return { id: ROLE, name: "renamed" };
            return { id: GUILD, name: "g" };
        });
        const role = bot.role(GUILD, ROLE);
        expect((await role.edit({ name: "renamed", reason: "r" })).name).toBe(
            "renamed",
        );
        await role.delete("old");
        await bot.guild(GUILD).ban(USER, { reason: "x" });
        await bot.guild(GUILD).unban(USER);
        await bot.guild(GUILD).leave();
        await bot.person(USER).send("hello there");
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            `PATCH /guilds/${GUILD}/roles/${ROLE}`,
            `DELETE /guilds/${GUILD}/roles/${ROLE}`,
            `PUT /guilds/${GUILD}/bans/${USER}`,
            `DELETE /guilds/${GUILD}/bans/${USER}`,
            `DELETE /users/@me/guilds/${GUILD}`,
            "POST /users/@me/channels",
            `POST /channels/${CHANNEL}/messages`,
        ]);
        expect(calls[6]!.body).toEqual({ content: "hello there" });
    });
});

describe("handles: the remaining reads and actions", () => {
    test("fetch() always asks Discord and updates the cache", async () => {
        const { bot, calls } = setup((call) => {
            if (call.path === `/channels/${CHANNEL}`)
                return {
                    id: CHANNEL,
                    type: 0,
                    guild_id: GUILD,
                    name: "general",
                };
            if (call.path === `/guilds/${GUILD}/roles/${ROLE}`)
                return { id: ROLE, name: "mod" };
            if (call.path === `/users/${USER}`)
                return { id: USER, username: "ann" };
            if (call.path === `/guilds/${GUILD}`)
                return { id: GUILD, name: "g" };
            return messagePayload;
        });
        expect((await bot.guild(GUILD).fetch()).name).toBe("g");
        expect(bot.guild(GUILD).peek()?.name).toBe("g");
        expect((await bot.guild(GUILD).get()).name).toBe("g");
        expect((await bot.channel(CHANNEL).fetch()).id).toBe(CHANNEL);
        expect((await bot.role(GUILD, ROLE).fetch()).name).toBe("mod");
        expect((await bot.person(USER).fetch()).username).toBe("ann");
        expect((await bot.message(CHANNEL, MESSAGE).fetch()).id).toBe(MESSAGE);
        expect(calls).toHaveLength(5);
    });

    test("handles lead to each other", () => {
        const { bot } = setup();
        const member = bot.guild(GUILD).member(USER);
        expect(member.guild().id).toBe(GUILD);
        expect(member.user().id).toBe(USER);
        expect(bot.guild(GUILD).role(ROLE).roleId).toBe(ROLE);
        expect(bot.guild(GUILD).channel(CHANNEL).id).toBe(CHANNEL);
        expect(bot.message(CHANNEL, MESSAGE).channel().id).toBe(CHANNEL);
        expect(bot.message(CHANNEL, MESSAGE).peek()).toBeUndefined();
    });

    test("channel reads, edits, deletes and bulk deletes", async () => {
        const { bot, calls } = setup((call) => {
            if (call.method === "GET") return [messagePayload];
            if (call.method === "PATCH")
                return {
                    id: CHANNEL,
                    type: 0,
                    guild_id: GUILD,
                    name: "renamed",
                };
            return undefined;
        });
        const channel = bot.channel(CHANNEL);
        expect((await channel.messages({ limit: 5 }))[0]!.id).toBe(MESSAGE);
        expect((await channel.edit({ name: "renamed" })).name).toBe("renamed");
        await channel.bulkDelete([freshId(1), freshId(2)], "cleanup");
        await channel.delete("gone");
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            `GET /channels/${CHANNEL}/messages?limit=5`,
            `PATCH /channels/${CHANNEL}`,
            `POST /channels/${CHANNEL}/messages/bulk-delete`,
            `DELETE /channels/${CHANNEL}`,
        ]);
        expect(calls[2]!.reason).toBe("cleanup");
    });

    test("a cached message is found by peek() and crosspost and guild edit work", async () => {
        const { bot, calls } = setup(
            (call) =>
                call.path.endsWith("/crosspost")
                    ? messagePayload
                    : { id: GUILD, name: "renamed" },
            { messageCache: { maxSize: 10 } },
        );
        bot.channels.upsert({
            id: CHANNEL,
            type: 0,
            guild_id: GUILD,
            name: "a",
        });
        const cache = bot.channels.messages(CHANNEL);
        cache.upsert(messagePayload);
        expect(bot.message(CHANNEL, MESSAGE).peek()?.content).toBe("hello");
        expect(bot.message(CHANNEL, MESSAGE).peek()).toBe(
            cache.cache.peek(MESSAGE),
        );
        expect((await bot.message(CHANNEL, MESSAGE).get()).content).toBe(
            "hello",
        );
        await bot.message(CHANNEL, MESSAGE).crosspost();
        expect((await bot.guild(GUILD).edit({ name: "renamed" })).name).toBe(
            "renamed",
        );
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            `POST /channels/${CHANNEL}/messages/${MESSAGE}/crosspost`,
            `PATCH /guilds/${GUILD}`,
        ]);
    });
});
