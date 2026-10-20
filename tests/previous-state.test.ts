import { describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import type { Channel, Emoji, Role } from "../packages/structures/src/index.ts";

const GUILD = "500";
const user = { id: "400", username: "User" };

function setup() {
    const client = new Client({ token: "a.b", intents: [513] });
    const gw = client.ws;
    gw.emit("GUILD_CREATE", {
        id: GUILD,
        name: "Old",
        roles: [{ id: "600", name: "Mod", permissions: "8", position: 1 }],
        emojis: [{ id: "700", name: "old" }],
        members: [{ user, roles: ["600"], nick: "before" }],
        channels: [{ id: "900", type: 0, name: "general" }],
        threads: [{ id: "901", type: 11, name: "thread", parent_id: "900" }],
    });
    return { client, gw };
}

describe("update events pass the previous state", () => {
    test("role, guild, member", () => {
        const { client, gw } = setup();
        const seen: unknown[] = [];
        client.on("guildRoleUpdate", (_e, previous) => seen.push(previous));
        client.on("guildUpdate", (_e, previous) => seen.push(previous));
        client.on("guildMemberUpdate", (_e, previous) => seen.push(previous));

        gw.emit("GUILD_ROLE_UPDATE", {
            guild_id: GUILD,
            role: { id: "600", name: "Admin", permissions: "8", position: 1 },
        });
        gw.emit("GUILD_UPDATE", { id: GUILD, name: "New" });
        gw.emit("GUILD_MEMBER_UPDATE", {
            guild_id: GUILD,
            user,
            roles: [],
            nick: "after",
        });

        const [role, guild, member] = seen as [
            Role,
            { name: string },
            { nickname: string; roleIds: string[]; permissions: unknown },
        ];
        expect(role.name).toBe("Mod");
        expect(client.guilds.roles(GUILD).get("600")?.name).toBe("Admin");
        expect(guild.name).toBe("Old");
        expect(client.guilds.get(GUILD)?.name).toBe("New");
        expect(member.nickname).toBe("before");
        expect(member.roleIds).toEqual(["600"]);
        // The copy keeps working methods (private client context intact).
        expect(() => member.permissions).not.toThrow();
    });

    test("channel and thread keep their class and context", () => {
        const { client, gw } = setup();
        const seen: (Channel | null)[] = [];
        client.on("channelUpdate", (_c, previous) => seen.push(previous));
        client.on("threadUpdate", (_c, previous) => seen.push(previous));
        const cached = client.channels.get("900")!;

        gw.emit("CHANNEL_UPDATE", {
            id: "900",
            type: 0,
            guild_id: GUILD,
            name: "renamed",
        });
        gw.emit("THREAD_UPDATE", {
            id: "901",
            type: 11,
            guild_id: GUILD,
            name: "renamed-thread",
        });

        expect(seen[0]?.name).toBe("general");
        expect(seen[0]).not.toBe(cached);
        expect(seen[0]?.constructor).toBe(cached.constructor);
        expect(cached.name).toBe("renamed");
        expect(seen[1]?.name).toBe("thread");
        // send() reaches the context rather than throwing on a missing private field.
        const rest = client.rest as unknown as Record<string, unknown>;
        let posted = "";
        rest.post = async (path: string) => {
            posted = path;
            return { id: "1", channel_id: "900", author: user, content: "" };
        };
        return (seen[0] as unknown as { send(o: string): Promise<unknown> })
            .send("hi")
            .then(() => expect(posted).toContain("/channels/900/messages"));
    });

    test("emoji and sticker lists", () => {
        const { client, gw } = setup();
        let emojis: Emoji[] | null = null;
        let stickers: unknown[] = [];
        client.on("guildEmojisUpdate", (_e, previous) => (emojis = previous));
        client.on(
            "guildStickersUpdate",
            (_e, previous) => (stickers = previous),
        );
        gw.emit("GUILD_STICKERS_UPDATE", {
            guild_id: GUILD,
            stickers: [{ id: "800", name: "sticky", type: 2, format_type: 1 }],
        });
        stickers = [];
        gw.emit("GUILD_EMOJIS_UPDATE", {
            guild_id: GUILD,
            emojis: [{ id: "700", name: "renamed" }],
        });
        gw.emit("GUILD_STICKERS_UPDATE", { guild_id: GUILD, stickers: [] });
        expect(emojis!.map((e) => e.name)).toEqual(["old"]);
        expect(client.guilds.emojis(GUILD).get("700")?.name).toBe("renamed");
        expect(stickers).toHaveLength(1);
    });

    test("previous is null when nothing was cached", () => {
        const { client, gw } = setup();
        const seen: unknown[] = [];
        client.on("guildRoleUpdate", (_e, p) => seen.push(p));
        client.on("channelUpdate", (_c, p) => seen.push(p));
        client.on("guildMemberUpdate", (_m, p) => seen.push(p));
        client.on("guildUpdate", (_g, p) => seen.push(p));
        gw.emit("GUILD_ROLE_UPDATE", {
            guild_id: GUILD,
            role: { id: "601", name: "New", permissions: "0", position: 2 },
        });
        gw.emit("CHANNEL_UPDATE", { id: "902", type: 0, guild_id: GUILD });
        gw.emit("GUILD_MEMBER_UPDATE", {
            guild_id: GUILD,
            user: { id: "401", username: "Other" },
            roles: [],
        });
        gw.emit("GUILD_UPDATE", { id: "501", name: "Unknown" });
        expect(seen).toEqual([null, null, null, null]);
    });
});

describe("delete events pass the removed structure", () => {
    test("cached role, channel and thread", () => {
        const { client, gw } = setup();
        const seen: unknown[] = [];
        client.on("guildRoleDelete", (_e, removed) => seen.push(removed));
        client.on("channelDelete", (_e, removed) => seen.push(removed));
        client.on("threadDelete", (_e, removed) => seen.push(removed));
        gw.emit("GUILD_ROLE_DELETE", { guild_id: GUILD, role_id: "600" });
        gw.emit("THREAD_DELETE", {
            id: "901",
            type: 11,
            guild_id: GUILD,
            parent_id: "900",
        });
        gw.emit("CHANNEL_DELETE", { id: "900", type: 0, guild_id: GUILD });
        expect((seen[0] as Role).name).toBe("Mod");
        expect((seen[1] as Channel).name).toBe("thread");
        expect((seen[2] as Channel).name).toBe("general");
        expect(client.channels.get("900")).toBeUndefined();
    });

    test("uncached deletes pass null", () => {
        const { client, gw } = setup();
        const seen: unknown[] = [];
        client.on("guildRoleDelete", (_e, removed) => seen.push(removed));
        client.on("channelDelete", (_e, removed) => seen.push(removed));
        client.on("threadDelete", (_e, removed) => seen.push(removed));
        gw.emit("GUILD_ROLE_DELETE", { guild_id: GUILD, role_id: "999" });
        gw.emit("CHANNEL_DELETE", { id: "998", type: 0, guild_id: GUILD });
        gw.emit("THREAD_DELETE", { id: "997", type: 11, guild_id: GUILD });
        expect(seen).toEqual([null, null, null]);
    });

    test("emoji list is null without the emoji cache", () => {
        const client = new Client({
            token: "a.b",
            intents: [513],
            cache: { emojis: false },
        });
        let previous: Emoji[] | null | undefined;
        client.on("guildEmojisUpdate", (_e, p) => (previous = p));
        client.ws.emit("GUILD_EMOJIS_UPDATE", { guild_id: GUILD, emojis: [] });
        expect(previous).toBeNull();
    });
});

describe("partial payloads", () => {
    test("a message without a member keeps the cached timeout (F-D1)", () => {
        const { client, gw } = setup();
        const until = new Date(Date.now() + 3_600_000).toISOString();
        gw.emit("GUILD_MEMBER_UPDATE", {
            guild_id: GUILD,
            user,
            roles: [],
            communication_disabled_until: until,
        });
        const member = client.guilds.members(GUILD).get("400")!;
        expect(member.timedOutUntil?.toISOString()).toBe(until);
        gw.emit("GUILD_MEMBER_UPDATE", { guild_id: GUILD, user, roles: [] });
        expect(
            client.guilds
                .members(GUILD)
                .get("400")!
                .timedOutUntil?.toISOString(),
        ).toBe(until);
        gw.emit("GUILD_MEMBER_UPDATE", {
            guild_id: GUILD,
            user,
            roles: [],
            communication_disabled_until: null,
        });
        expect(
            client.guilds.members(GUILD).get("400")!.timedOutUntil,
        ).toBeNull();
    });

    test("a MESSAGE_UPDATE without an author does not throw (F-D6)", () => {
        const { client, gw } = setup();
        const seen: unknown[] = [];
        client.on("messageUpdate", (m) => seen.push(m));
        expect(() =>
            gw.emit("MESSAGE_UPDATE", {
                id: "1",
                channel_id: "900",
                embeds: [],
            }),
        ).not.toThrow();
        expect(seen).toEqual([]);
    });
});

describe("destroy (F-D4)", () => {
    test("stops collectors and empties the caches", () => {
        const { client } = setup();
        const collector = client.createCollector("guildMemberUpdate", {
            time: 60_000,
        });
        expect(client.guilds.size).toBe(1);
        client.destroy();
        expect(collector.ended).toBe(true);
        expect(collector.endReason).toBe("destroyed");
        expect(client.guilds.size).toBe(0);
    });
});

describe("cache.maxMembers (F-D3)", () => {
    test("bounds the members kept per guild", () => {
        const client = new Client({
            token: "a.b",
            intents: [513],
            cache: { maxMembers: 2 },
        });
        // With the Guilds intent, members are kept only for cached guilds.
        client.ws.emit("GUILD_CREATE", { id: GUILD, name: "g" });
        for (const id of ["1", "2", "3"])
            client.ws.emit("GUILD_MEMBER_ADD", {
                guild_id: GUILD,
                user: { id, username: id },
                roles: [],
            });
        expect(client.guilds.members(GUILD).cache.size).toBe(2);
        expect(client.guilds.members(GUILD).get("1")).toBeUndefined();
    });
});
