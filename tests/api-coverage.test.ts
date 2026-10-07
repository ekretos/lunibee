import { describe, expect, test } from "bun:test";
import { HttpTransport, REST } from "../packages/rest/src/index.ts";
import {
    ApplicationEmojiManager,
    ChannelManager,
    GuildManager,
    UserManager,
} from "../packages/managers/src/index.ts";
import { RoleManager } from "../packages/managers/src/role.ts";
import { Interaction } from "../packages/structures/src/interactions.ts";

const GUILD = "100000000000000001";
const CHANNEL = "100000000000000002";
const THREAD = "100000000000000003";
const USER = "100000000000000004";
const APP = "100000000000000005";
const TAG = "100000000000000006";

interface Call {
    method: string;
    path: string;
    body: unknown;
    reason: string | null;
}

function setup(answer: (call: Call) => unknown = () => ({})) {
    const calls: Call[] = [];
    const rest = new REST({
        token: "token",
        transport: new HttpTransport({
            fetch: async (url, init) => {
                const parsed = new URL(url);
                const body = init?.body;
                const reason = new Headers(init?.headers).get(
                    "X-Audit-Log-Reason",
                );
                const call: Call = {
                    method: init?.method ?? "GET",
                    path:
                        parsed.pathname.replace("/api/v10", "") + parsed.search,
                    body:
                        typeof body === "string"
                            ? JSON.parse(body)
                            : body instanceof FormData
                              ? JSON.parse(String(body.get("payload_json")))
                              : null,
                    reason: reason && decodeURIComponent(reason),
                };
                calls.push(call);
                const result = answer(call);
                if (result === null) return new Response(null, { status: 204 });
                return new Response(JSON.stringify(result), {
                    headers: { "content-type": "application/json" },
                });
            },
        }),
    });
    return { rest, calls, last: () => calls[calls.length - 1]! };
}

const member = {
    user: { id: USER, username: "u" },
    roles: [],
    joined_at: "2024-01-01T00:00:00.000Z",
};
const thread = { id: THREAD, type: 11, guild_id: GUILD, name: "t" };

describe("guilds, members and users", () => {
    test("bulk ban, member search, own nickname", async () => {
        const { rest, last } = setup((c) =>
            c.path.endsWith("bulk-ban")
                ? { banned_users: [USER], failed_users: null }
                : c.path.includes("search")
                  ? [member]
                  : member,
        );
        const guilds = new GuildManager(rest);
        const result = await guilds
            .bans(GUILD)
            .bulk([USER, "7"], { deleteMessageSeconds: 60, reason: "raid" });
        expect(result).toEqual({ banned: [USER], failed: [] });
        expect(last()).toMatchObject({
            method: "POST",
            path: `/guilds/${GUILD}/bulk-ban`,
            body: { user_ids: [USER, "7"], delete_message_seconds: 60 },
            reason: "raid",
        });
        await expect(guilds.bans(GUILD).bulk([])).rejects.toThrow(RangeError);
        await expect(
            guilds.bans(GUILD).bulk(Array.from({ length: 201 }, () => "1")),
        ).rejects.toThrow(RangeError);

        const members = guilds.members(GUILD);
        const found = await members.search("ali", 5000);
        expect(found[0]!.user.id).toBe(USER);
        expect(last().path).toBe(
            `/guilds/${GUILD}/members/search?query=ali&limit=1000`,
        );
        await expect(members.search(" ")).rejects.toThrow(TypeError);
        const me = await members.editMe({ nick: "Bee", reason: "rename" });
        expect(me.user.id).toBe(USER);
        expect(last()).toMatchObject({
            method: "PATCH",
            path: `/guilds/${GUILD}/members/@me`,
            body: { nick: "Bee" },
            reason: "rename",
        });
    });

    test("welcome screen, onboarding, voice state, integrations", async () => {
        const { rest, calls, last } = setup((c) =>
            c.method === "DELETE" || c.path.includes("voice-states")
                ? null
                : { description: "hi", welcome_channels: [], guild_id: GUILD },
        );
        const guilds = new GuildManager(rest);
        await guilds.fetchWelcomeScreen(GUILD);
        await guilds.editWelcomeScreen(GUILD, {
            enabled: true,
            welcomeChannels: [],
            reason: "r",
        });
        expect(last()).toMatchObject({
            method: "PATCH",
            path: `/guilds/${GUILD}/welcome-screen`,
            body: { enabled: true, welcome_channels: [] },
            reason: "r",
        });
        await guilds.fetchOnboarding(GUILD);
        await guilds.editOnboarding(GUILD, {
            defaultChannelIds: [CHANNEL],
            enabled: true,
            reason: "r",
        });
        expect(last()).toMatchObject({
            method: "PUT",
            path: `/guilds/${GUILD}/onboarding`,
            body: { default_channel_ids: [CHANNEL], enabled: true },
        });
        await guilds.editVoiceState(GUILD, "@me", {
            channelId: CHANNEL,
            suppress: false,
        });
        expect(last()).toMatchObject({
            method: "PATCH",
            path: `/guilds/${GUILD}/voice-states/@me`,
            body: { channel_id: CHANNEL, suppress: false },
        });
        await guilds.removeIntegration(GUILD, "9", "gone");
        expect(last()).toMatchObject({
            method: "DELETE",
            path: `/guilds/${GUILD}/integrations/9`,
            reason: "gone",
        });
        expect(calls).toHaveLength(6);
    });

    test("the guilds the bot is in", async () => {
        const { rest, last } = setup(() => [{ id: GUILD, name: "g" }]);
        const users = new UserManager(rest);
        await users.fetchGuilds({ limit: 500, after: "5", withCounts: true });
        expect(last().path).toBe(
            "/users/@me/guilds?limit=200&after=5&with_counts=true",
        );
        await users.fetchGuilds();
        expect(last().path).toBe("/users/@me/guilds");
        await users.fetchGuilds({ before: "9" });
        expect(last().path).toBe("/users/@me/guilds?before=9");
    });
});

describe("threads and forums", () => {
    test("standalone threads and forum posts", async () => {
        const { rest, last } = setup(() => thread);
        const channels = new ChannelManager(rest);
        const threads = channels.threads(CHANNEL);
        await threads.create({ name: "chat", invitable: false, reason: "r" });
        expect(last()).toMatchObject({
            method: "POST",
            path: `/channels/${CHANNEL}/threads`,
            body: { name: "chat", type: 12, invitable: false },
            reason: "r",
        });
        await threads.create({
            name: "open",
            type: 11,
            autoArchiveDuration: 60,
        });
        expect(last().body).toMatchObject({
            type: 11,
            auto_archive_duration: 60,
        });

        await threads.createForumPost({
            name: "post",
            message: {
                content: "first",
                files: [{ name: "a.txt", data: "x" }],
            },
            appliedTags: [TAG],
            rateLimitPerUser: 5,
        });
        expect(last()).toMatchObject({
            method: "POST",
            path: `/channels/${CHANNEL}/threads`,
            body: {
                name: "post",
                applied_tags: [TAG],
                rate_limit_per_user: 5,
                message: { content: "first" },
            },
        });
        await threads.createForumPost({
            name: "plain",
            message: { content: "x" },
        });
        expect(last().body).toMatchObject({ message: { content: "x" } });
    });

    test("archived threads in every scope", async () => {
        const { rest, last } = setup(() => ({
            threads: [thread],
            members: [{ id: THREAD, join_timestamp: "t", flags: 0 }],
            has_more: true,
        }));
        const threads = new ChannelManager(rest).threads(CHANNEL);
        const page = await threads.fetchArchived("public", {
            limit: 500,
            before: "x",
        });
        expect(page.threads).toHaveLength(1);
        expect(page.hasMore).toBe(true);
        expect(last().path).toBe(
            `/channels/${CHANNEL}/threads/archived/public?before=x&limit=100`,
        );
        await threads.fetchArchived("private");
        expect(last().path).toBe(
            `/channels/${CHANNEL}/threads/archived/private`,
        );
        await threads.fetchArchived("joined-private");
        expect(last().path).toBe(
            `/channels/${CHANNEL}/users/@me/threads/archived/private`,
        );
    });

    test("thread members", async () => {
        const { rest, last } = setup((c) => (c.method === "GET" ? [] : null));
        const threads = new ChannelManager(rest).threads(CHANNEL);
        await threads.join(THREAD);
        expect(last()).toMatchObject({
            method: "PUT",
            path: `/channels/${THREAD}/thread-members/@me`,
        });
        await threads.leave(THREAD);
        expect(last().method).toBe("DELETE");
        await threads.addMember(THREAD, USER);
        expect(last().path).toBe(`/channels/${THREAD}/thread-members/${USER}`);
        await threads.removeMember(THREAD, USER);
        expect(last().method).toBe("DELETE");
        await threads.fetchMember(THREAD, USER, { withMember: true });
        expect(last().path).toBe(
            `/channels/${THREAD}/thread-members/${USER}?with_member=true`,
        );
        await threads.fetchMember(THREAD, USER);
        expect(last().path).toBe(`/channels/${THREAD}/thread-members/${USER}`);
        await threads.fetchMembers(THREAD, {
            withMember: true,
            after: "5",
            limit: 0,
        });
        expect(last().path).toBe(
            `/channels/${THREAD}/thread-members?with_member=true&after=5&limit=1`,
        );
        await threads.fetchMembers(THREAD);
        expect(last().path).toBe(`/channels/${THREAD}/thread-members`);
    });

    test("forum tags are read fresh and written whole", async () => {
        let tags = [{ id: TAG, name: "bug", moderated: false }];
        const { rest, last } = setup((c) => {
            if (c.method === "PATCH") {
                const next = (c.body as { available_tags: typeof tags })
                    .available_tags;
                tags = next.map((tag, i) => ({
                    ...tag,
                    id: tag.id ?? `9${i}`,
                }));
            }
            return { id: CHANNEL, type: 15, available_tags: tags };
        });
        const channels = new ChannelManager(rest);
        const created = await channels.createForumTag(
            CHANNEL,
            { name: "idea" },
            "add",
        );
        expect(created.map((t) => t.name)).toEqual(["bug", "idea"]);
        expect(last()).toMatchObject({ method: "PATCH", reason: "add" });
        const edited = await channels.editForumTag(CHANNEL, TAG, {
            moderated: true,
        });
        expect(edited[0]).toMatchObject({ name: "bug", moderated: true });
        const removed = await channels.removeForumTag(CHANNEL, TAG);
        expect(removed.map((t) => t.name)).toEqual(["idea"]);
        await expect(channels.editForumTag(CHANNEL, "1", {})).rejects.toThrow(
            /no tag/,
        );
        await expect(channels.removeForumTag(CHANNEL, "1")).rejects.toThrow(
            /no tag/,
        );
    });

    test("pins one page at a time, and typing", async () => {
        const { rest, last } = setup((c) =>
            c.method === "POST"
                ? null
                : {
                      items: [
                          {
                              pinned_at: "2024-01-01T00:00:00Z",
                              message: {
                                  id: "100000000000000009",
                                  channel_id: CHANNEL,
                                  author: { id: USER, username: "u" },
                                  content: "pinned",
                                  timestamp: "2024-01-01T00:00:00Z",
                              },
                          },
                      ],
                      has_more: false,
                  },
        );
        const channels = new ChannelManager(rest);
        const page = await channels.fetchPins(CHANNEL, {
            before: "2024",
            limit: 99,
        });
        expect(page.messages[0]!.content).toBe("pinned");
        expect(page.hasMore).toBe(false);
        expect(last().path).toBe(
            `/channels/${CHANNEL}/messages/pins?before=2024&limit=50`,
        );
        await channels.fetchPins(CHANNEL);
        expect(last().path).toBe(`/channels/${CHANNEL}/messages/pins`);
        await channels.triggerTyping(CHANNEL);
        expect(last()).toMatchObject({
            method: "POST",
            path: `/channels/${CHANNEL}/typing`,
        });
    });
});

describe("roles, application emojis and entitlements", () => {
    test("role icon and gradient colours", async () => {
        const { rest, last } = setup(() => ({
            id: CHANNEL,
            name: "r",
            color: 255,
            colors: {
                primary_color: 255,
                secondary_color: 65280,
                tertiary_color: null,
            },
            position: 1,
            permissions: "0",
        }));
        const roles = new RoleManager(GUILD, rest);
        const role = await roles.create({
            name: "r",
            colors: { primary: 255, secondary: 65280 },
            unicodeEmoji: "🐝",
            icon: null,
        });
        expect(last().body).toMatchObject({
            colors: {
                primary_color: 255,
                secondary_color: 65280,
                tertiary_color: null,
            },
            unicode_emoji: "🐝",
            icon: null,
        });
        expect(role.colors).toEqual({
            primary: 255,
            secondary: 65280,
            tertiary: null,
        });
        await roles.edit(CHANNEL, { name: "plain" });
        expect(last().body).not.toHaveProperty("colors");
    });

    test("application emojis", async () => {
        const emoji = { id: TAG, name: "bee" };
        const { rest, last } = setup((c) =>
            c.method === "DELETE"
                ? null
                : c.path.endsWith("/emojis")
                  ? c.method === "GET"
                      ? { items: [emoji] }
                      : emoji
                  : emoji,
        );
        const emojis = new ApplicationEmojiManager(rest, APP);
        expect(await emojis.fetchAll()).toEqual([emoji]);
        expect(emojis.get(TAG)).toEqual(emoji);
        await emojis.create({
            name: "bee",
            image: "data:image/png;base64,AA==",
        });
        expect(last()).toMatchObject({
            method: "POST",
            path: `/applications/${APP}/emojis`,
        });
        await emojis.edit(TAG, { name: "bumble" });
        expect(last().method).toBe("PATCH");
        await emojis.fetch(TAG);
        await emojis.remove(TAG);
        expect(emojis.has(TAG)).toBe(false);
    });

    test("an interaction carries its entitlements", () => {
        const client = {} as never;
        const future = new Date(Date.now() + 60_000).toISOString();
        const past = new Date(Date.now() - 60_000).toISOString();
        const entitlement = (sku: string, extra: object = {}) => ({
            id: "1",
            sku_id: sku,
            application_id: APP,
            type: 8,
            deleted: false,
            ...extra,
        });
        const interaction = new Interaction(client, {
            id: "1",
            application_id: APP,
            type: 2,
            token: "t",
            entitlements: [
                entitlement("10"),
                entitlement("11", { ends_at: past }),
                entitlement("12", { ends_at: future }),
                entitlement("13", { deleted: true }),
            ],
        });
        expect(interaction.entitlements).toHaveLength(4);
        expect(interaction.hasEntitlement("10")).toBe(true);
        expect(interaction.hasEntitlement("11")).toBe(false);
        expect(interaction.hasEntitlement("12")).toBe(true);
        expect(interaction.hasEntitlement("13")).toBe(false);
        expect(interaction.hasEntitlement("99")).toBe(false);
        const bare = new Interaction(client, {
            id: "2",
            application_id: APP,
            type: 2,
            token: "t",
        });
        expect(bare.entitlements).toEqual([]);
    });
});
