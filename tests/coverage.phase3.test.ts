import { describe, expect, test } from "bun:test";
import * as fmt from "../packages/formatters/src/index.ts";
import { Collection } from "../packages/collection/src/index.ts";
import { HttpTransport } from "../packages/rest/src/index.ts";

describe("formatters", () => {
    test("markdown wrappers", () => {
        expect(fmt.bold("a")).toBe("**a**");
        expect(fmt.italic("a")).toBe("_a_");
        expect(fmt.underline("a")).toBe("__a__");
        expect(fmt.strikethrough("a")).toBe("~~a~~");
        expect(fmt.spoiler("a")).toBe("||a||");
        expect(fmt.masked("a")).toBe("||a||");
        expect(fmt.inlineCode("a")).toBe("`a`");
        expect(fmt.codeBlock("x")).toBe("```\nx\n```");
        expect(fmt.codeBlock("x", "ts")).toBe("```ts\nx\n```");
        expect(fmt.link("l", "https://a")).toBe("[l](https://a)");
        expect(fmt.link("l", "https://a", "t")).toBe('[l](https://a "t")');
        expect(fmt.blockQuote("a\nb")).toBe("> a\n> b");
        expect(fmt.heading("h")).toBe("# h");
        expect(fmt.heading("h", 3)).toBe("### h");
        expect(fmt.subtext("s")).toBe("-# s");
        expect(fmt.orderedList("a", "b")).toBe("1. a\n2. b");
        expect(fmt.bulletList("a", "b")).toBe("- a\n- b");
        expect(fmt.escapeMarkdown("*_`~|>\\")).toBe("\\*\\_\\`\\~\\|\\>\\\\");
    });

    test("mentions and timestamps validate input", () => {
        expect(fmt.userMention("1")).toBe("<@1>");
        expect(fmt.channelMention("2")).toBe("<#2>");
        expect(fmt.roleMention("3")).toBe("<@&3>");
        expect(() => fmt.userMention("")).toThrow(TypeError);
        expect(() => fmt.userMention("12a")).toThrow(TypeError);
        expect(() => fmt.userMention("1".repeat(21))).toThrow(TypeError);
        expect(fmt.timestamp(1.9)).toBe("<t:1>");
        expect(fmt.timestamp(5, "R")).toBe("<t:5:R>");
        expect(() => fmt.timestamp(Number.NaN)).toThrow(TypeError);
        expect(() => fmt.timestamp(1, "x")).toThrow(RangeError);
    });
});

describe("Collection utilities", () => {
    const make = () =>
        new Collection<string, number>([
            ["a", 3],
            ["b", 1],
            ["c", 2],
        ]);

    test("difference, partition, tap, flatMap, reduce", () => {
        const other = new Collection<string, number>([["a", 0]]);
        expect([...make().difference(other).keys()]).toEqual(["b", "c"]);
        const [odd, even] = make().partition((v) => v % 2 === 1);
        expect([...odd.keys()]).toEqual(["a", "b"]);
        expect([...even.keys()]).toEqual(["c"]);
        let seen = 0;
        const c = make();
        expect(c.tap((x) => (seen = x.size))).toBe(c);
        expect(seen).toBe(3);
        expect(make().flatMap((v, k) => [k, String(v)])).toEqual([
            "a",
            "3",
            "b",
            "1",
            "c",
            "2",
        ]);
        expect(make().reduce((acc, v) => acc + v, 0)).toBe(6);
    });

    test("sorted is stable and non-mutating", () => {
        const c = new Collection<string, number>([
            ["x", 1],
            ["y", 0],
            ["z", 1],
        ]);
        expect([...c.sorted((a, b) => a - b).keys()]).toEqual(["y", "x", "z"]);
        expect([...c.sorted().keys()]).toEqual(["x", "y", "z"]);
        expect([...c.keys()]).toEqual(["x", "y", "z"]);
    });

    test("random, at, keyAt, toJSON", () => {
        const empty = new Collection<string, number>();
        expect(empty.random()).toBeUndefined();
        expect(empty.randomKey()).toBeUndefined();
        expect([3, 1, 2]).toContain(make().random()!);
        expect(["a", "b", "c"]).toContain(make().randomKey()!);
        expect(make().at(0)).toBe(3);
        expect(make().at(-1)).toBe(2);
        expect(make().keyAt(1)).toBe("b");
        expect(make().keyAt(-3)).toBe("a");
        expect(make().toJSON()).toEqual([
            ["a", 3],
            ["b", 1],
            ["c", 2],
        ]);
    });
});

describe("HttpTransport options", () => {
    test("normalises base URL and clamps timeout", () => {
        const t = new HttpTransport({ baseURL: "https://x/api/", timeout: 0 });
        expect(t.baseURL).toBe("https://x/api");
        expect(t.timeout).toBe(1);
        const d = new HttpTransport();
        expect(d.baseURL).toBe("https://discord.com/api/v10");
        expect(d.timeout).toBe(15_000);
    });
});

import {
    Message,
    GuildMember,
    Role,
    Invite,
    Webhook,
    WebhookType,
    Emoji,
    AutoModerationRule,
    GuildWelcomeScreen,
    GuildOnboarding,
} from "../packages/structures/src/index.ts";

describe("Message getters", () => {
    const raw = {
        id: "175928847299117063",
        channel_id: "1",
        content: "hi",
        author: { id: "2", username: "u" },
        timestamp: "2026-01-01T00:00:00.000Z",
    };

    test("flag and content getters, toJSON", async () => {
        const edits: unknown[] = [];
        const ctx = {
            editMessage: async (_c: string, _m: string, opts: unknown) => {
                edits.push(opts);
                return new Message(raw as never);
            },
        };
        const m = new Message(
            {
                ...raw,
                flags: 2 | 64,
                type: 7,
                pinned: true,
                attachments: [{ id: "a" }],
                embeds: [{ title: "e" }],
                components: [{ type: 1 }],
                mentions: [{ id: "3", username: "m" }],
                referenced_message: null,
            } as never,
            ctx as never,
        );
        expect(m.isEphemeral).toBe(true);
        expect(m.isCrosspost).toBe(true);
        expect(m.isPinned).toBe(true);
        expect(m.isSystemMessage).toBe(true);
        expect(m.hasAttachments && m.hasEmbeds && m.hasComponents).toBe(true);
        expect(m.embedsSuppressed).toBe(false);
        expect(m.createdTimestamp).toBe(Date.parse(raw.timestamp));
        expect(m.createdAt.toISOString()).toBe(raw.timestamp);
        await m.suppressEmbeds();
        expect(edits).toEqual([{ flags: 2 | 64 | 4 }]);
        const json = m.toJSON();
        expect(json.mentions).toEqual(["3"]);
        expect(json.referencedMessage).toBeNull();
        expect(json.timestamp).toBe(raw.timestamp);

        const plain = new Message(raw as never);
        expect(plain.isSystemMessage).toBe(false);
        expect(plain.hasAttachments || plain.hasEmbeds).toBe(false);
        expect(() => plain.edit({ content: "x" })).toThrow();
        expect(() => plain.pin()).toThrow();
        expect(() => plain.unpin()).toThrow();
    });
});

describe("resource structures", () => {
    test("GuildMember avatar fallbacks and timeout", () => {
        const base = {
            user: { id: "200", username: "u", avatar: "uhash" },
            guild_id: "300",
            roles: [],
        };
        const withAvatar = new GuildMember({ ...base, avatar: "a_m" } as never);
        expect(withAvatar.avatarURL()).toBe(
            "https://cdn.discordapp.com/guilds/300/users/200/avatars/a_m.gif",
        );
        const userOnly = new GuildMember(base as never);
        expect(userOnly.avatarURL()).toContain("/avatars/200/uhash.png");
        const none = new GuildMember({
            ...base,
            user: { id: "200", username: "u" },
            communication_disabled_until: new Date(
                Date.now() + 60_000,
            ).toISOString(),
        } as never);
        expect(none.avatarURL()).toBeNull();
        expect(none.displayAvatarURL()).toContain("embed/avatars/");
        expect(none.isTimedOut).toBe(true);
        expect(userOnly.isTimedOut).toBe(false);
    });

    test("Role colour, icon and everyone check", () => {
        const role = new Role({
            id: "5",
            name: "r",
            color: 0xab,
            icon: "ih",
        } as never);
        expect(role.colorHex).toBe("#0000AB");
        expect(role.iconURL({ size: 64 })).toBe(
            "https://cdn.discordapp.com/role-icons/5/ih.png?size=64",
        );
        expect(role.isEveryone("5")).toBe(true);
        expect(new Role({ id: "6", name: "n" } as never).iconURL()).toBeNull();
    });

    test("Invite", () => {
        const invite = new Invite({
            code: "abc",
            guild: { id: "1" },
            channel: { id: "2" },
            inviter: { id: "3", username: "i" },
            uses: 4,
            max_uses: 5,
            max_age: 60,
            temporary: true,
            created_at: "2026-01-01T00:00:00Z",
            expires_at: "2026-01-02T00:00:00Z",
        });
        expect(`${invite}`).toBe("https://discord.gg/abc");
        expect(invite.inviter?.id).toBe("3");
        expect([invite.guildId, invite.channelId, invite.uses]).toEqual([
            "1",
            "2",
            4,
        ]);
        expect(invite.expiresAt?.toISOString()).toBe(
            "2026-01-02T00:00:00.000Z",
        );
        const bare = new Invite({ code: "x" });
        expect([
            bare.guildId,
            bare.inviter,
            bare.createdAt,
            bare.maxUses,
        ]).toEqual([null, null, null, 0]);
        expect(() => new Invite({ code: "" })).toThrow(TypeError);
    });

    test("Webhook", () => {
        const hook = new Webhook({ id: "9", token: "t", avatar: "h" });
        expect(hook.type).toBe(WebhookType.Incoming);
        expect(`${hook}`).toBe("https://discord.com/api/webhooks/9/t");
        expect(hook.avatarURL()).toContain("/avatars/9/h.png");
        const noToken = new Webhook({ id: "8", type: WebhookType.Application });
        expect(noToken.url).toBeNull();
        expect(`${noToken}`).toBe("8");
        expect(noToken.avatarURL()).toBeNull();
    });

    test("Emoji", () => {
        const custom = new Emoji({
            id: "7",
            name: "e",
            animated: true,
            user: { id: "1", username: "u" } as never,
        });
        expect(custom.url()).toBe("https://cdn.discordapp.com/emojis/7.gif");
        expect(custom.url({ extension: "webp", size: 32 })).toBe(
            "https://cdn.discordapp.com/emojis/7.webp?size=32",
        );
        expect(`${custom}`).toBe("<a:e:7>");
        expect(custom.user?.id).toBe("1");
        expect(custom.available).toBe(true);
        const unicode = new Emoji({ id: null, name: "🐝" });
        expect(unicode.url()).toBeNull();
        expect(`${unicode}`).toBe("🐝");
        expect(`${new Emoji({ id: "6", name: "s" })}`).toBe("<:s:6>");
    });

    test("AutoModerationRule, welcome screen, onboarding", () => {
        const rule = new AutoModerationRule({
            id: "1",
            guild_id: "2",
            name: "r",
            creator_id: "3",
            event_type: 1,
            trigger_type: 1,
            trigger_metadata: {},
            actions: [],
            enabled: true,
            exempt_roles: [],
            exempt_channels: [],
        } as never);
        expect(rule.toJSON()).toMatchObject({
            id: "1",
            guildId: "2",
            enabled: true,
        });
        expect(
            () => new AutoModerationRule({ id: "1", guild_id: "x" } as never),
        ).toThrow(TypeError);

        const screen = new GuildWelcomeScreen({
            description: "d",
            welcome_channels: [
                {
                    channel_id: "1",
                    description: "c",
                    emoji_id: null,
                    emoji_name: "👋",
                },
            ],
        } as never);
        expect(screen.channels[0]).toMatchObject({
            channelId: "1",
            emojiName: "👋",
        });

        const onboarding = new GuildOnboarding({
            guild_id: "10",
            prompts: [
                {
                    id: "11",
                    type: 0,
                    title: "p",
                    single_select: true,
                    required: false,
                    in_onboarding: true,
                    options: [
                        {
                            id: "12",
                            channel_ids: ["1"],
                            role_ids: [],
                            title: "o",
                            description: null,
                        },
                    ],
                },
            ],
            default_channel_ids: ["1"],
            enabled: true,
            mode: 0,
        } as never);
        expect(onboarding.id).toBe("10");
        expect(onboarding.prompts[0]!.singleSelect).toBe(true);
        expect(onboarding.prompts[0]!.options[0]!.title).toBe("o");
    });
});

import { GuildManager } from "../packages/managers/src/guild.ts";
import { ChannelManager } from "../packages/managers/src/index.ts";
import { REST } from "../packages/rest/src/index.ts";

const recordingRest = (reply: (method: string, path: string) => unknown) => {
    const calls: [string, string, unknown?][] = [];
    const rest = new REST({ token: "t" });
    for (const method of ["get", "post", "patch", "put", "delete"] as const)
        (rest as unknown as Record<string, unknown>)[method] = async (
            path: string,
            body?: unknown,
        ) => {
            calls.push([method, path, body]);
            return reply(method, path);
        };
    return { rest, calls };
};

describe("GuildManager queries", () => {
    test("simple fetches hit the expected routes", async () => {
        const { rest, calls } = recordingRest(() => []);
        const guilds = new GuildManager(rest);
        await guilds.fetchPreview("1");
        await guilds.fetchActiveThreads("1");
        await guilds.fetchWebhooks("1");
        await guilds.fetchInvites("1");
        expect(calls.map(([, path]) => path)).toEqual([
            "/guilds/1/preview",
            "/guilds/1/threads/active",
            "/guilds/1/webhooks",
            "/guilds/1/invites",
        ]);
    });

    test("audit log and member queries clamp and encode options", async () => {
        const { rest, calls } = recordingRest(() => []);
        const guilds = new GuildManager(rest);
        await guilds.fetchAuditLog("1");
        await guilds.fetchAuditLog("1", {
            userId: "2",
            actionType: 0,
            before: "3",
            after: "4",
            limit: 500,
        });
        await guilds.fetchMembers("1", { limit: 0, after: "5" });
        await guilds.fetchMembers("1");
        expect(calls.map(([, path]) => path)).toEqual([
            "/guilds/1/audit-logs",
            "/guilds/1/audit-logs?user_id=2&action_type=0&before=3&after=4&limit=100",
            "/guilds/1/members?limit=1&after=5",
            "/guilds/1/members",
        ]);
    });
});

describe("ChannelManager paging", () => {
    const message = (id: string) => ({
        id,
        channel_id: "1",
        content: "",
        author: { id: "2", username: "u" },
    });

    test("fetchPage reports cursors and hasMore", async () => {
        const { rest, calls } = recordingRest(() => [
            message("10"),
            message("9"),
        ]);
        const messages = new ChannelManager(rest);
        const full = await messages.fetchPage("1", { limit: 2 });
        expect(full).toMatchObject({ before: "10", after: "9", hasMore: true });
        const partial = await messages.fetchPage("1", { limit: 500 });
        expect(partial.hasMore).toBe(false);
        expect(calls[1]![1]).toContain("limit=100");
    });

    test("bulkDelete validates count and posts ids", async () => {
        const { rest, calls } = recordingRest(() => undefined);
        const messages = new ChannelManager(rest);
        await expect(messages.bulkDelete("1", ["1"])).rejects.toThrow(
            RangeError,
        );
        await messages.bulkDelete("1", ["1", "2"]);
        expect(calls).toEqual([
            [
                "post",
                "/channels/1/messages/bulk-delete",
                { messages: ["1", "2"] },
            ],
        ]);
    });
});

import { Routes } from "../packages/rest/src/index.ts";
import {
    UserCommandBuilder,
    MessageCommandBuilder,
} from "../packages/builders/src/index.ts";

describe("Routes (misc)", () => {
    test("guild utility and emoji routes", () => {
        expect(Routes.guildWelcomeScreen("1")).toBe("/guilds/1/welcome-screen");
        expect(Routes.guildOnboarding("1")).toBe("/guilds/1/onboarding");
        expect(Routes.guildPrune("1")).toBe("/guilds/1/prune");
        expect(Routes.stageInstances()).toBe("/stage-instances");
        expect(Routes.stageInstanceByChannel("2")).toBe("/stage-instances/2");
        expect(Routes.invite("a b")).toBe("/invites/a%20b");
        expect(Routes.guildVanity("1")).toBe("/guilds/1/vanity-url");
        expect(Routes.guildEmoji("1")).toBe("/guilds/1/emojis");
        expect(Routes.guildEmoji("1", "3")).toBe("/guilds/1/emojis/3");
        expect(Routes.applicationEmoji("4")).toBe("/applications/4/emojis");
        expect(Routes.applicationEmoji("4", "5")).toBe(
            "/applications/4/emojis/5",
        );
        expect(Routes.gateway()).toBe("/gateway");
        expect(Routes.gatewayBot()).toBe("/gateway/bot");
        expect(() => Routes.guildEmoji("x")).toThrow();
    });
});

describe("context menu command builders", () => {
    test("serialise all fields", () => {
        const user = new UserCommandBuilder()
            .setName("View Profile")
            .setDefaultMemberPermissions(8n)
            .setDMPermission(false)
            .setIntegrationTypes(0, 1)
            .toJSON();
        expect(user).toEqual({
            type: 2,
            name: "View Profile",
            default_member_permissions: "8",
            dm_permission: false,
            integration_types: [0, 1],
        });
        const message = new MessageCommandBuilder()
            .setName("Quote")
            .setDefaultMemberPermissions(null)
            .toJSON();
        expect(message).toEqual({
            type: 3,
            name: "Quote",
            default_member_permissions: null,
        });
        expect(() => new UserCommandBuilder().setName(" ")).toThrow(RangeError);
        expect(() => new UserCommandBuilder().setName("x".repeat(33))).toThrow(
            RangeError,
        );
    });
});

import { Client } from "../packages/core/src/index.ts";

describe("Client utilities", () => {
    const makeClient = () => {
        const client = new Client({ token: "t", intents: 0 });
        const paths: string[] = [];
        (client.rest as unknown as { get: unknown }).get = async (
            path: string,
        ) => {
            paths.push(path);
            return {};
        };
        return { client, paths };
    };

    test("fetch helpers build encoded routes", async () => {
        const { client, paths } = makeClient();
        await client.fetchWebhook("1");
        await client.fetchWebhook("1", "tok");
        await client.fetchGuildPreview("2");
        await client.fetchVoiceRegions();
        await client.fetchInvite("abc");
        await client.fetchInvite("../x", {
            withCounts: true,
            withExpiration: true,
            guildScheduledEventId: "3",
        });
        await client.fetchSticker("4");
        await client.fetchPremiumStickerPacks();
        await client.fetchGuildTemplate("a/b");
        expect(paths).toEqual([
            "/webhooks/1",
            "/webhooks/1/tok",
            "/guilds/2/preview",
            "/voice/regions",
            "/invites/abc",
            "/invites/..%2Fx?with_counts=true&with_expiration=true&guild_scheduled_event_id=3",
            "/stickers/4",
            "/sticker-packs",
            "/guilds/templates/a%2Fb",
        ]);
    });

    test("state getters before ready", () => {
        const { client } = makeClient();
        expect(client.uptime).toBeNull();
        expect(client.isReady()).toBe(false);
        expect(client.token).toBe("t");
        expect(typeof client.ping).toBe("number");
        expect(client.setPresence({ status: "online" } as never)).toBe(false);
        expect(client.setVoiceState({})).toBe(false);
        expect(client.requestGuildMembers({})).toBe(false);
        expect(() => client.generateInvite()).toThrow();
    });

    test("generateInvite uses Discord's `scope` parameter", () => {
        const { client } = makeClient();
        client.user = { id: "5", username: "b" } as never;
        const url = new URL(
            client.generateInvite({
                scopes: ["bot", "applications.commands"],
                permissions: 8n,
            }),
        );
        expect(url.searchParams.get("client_id")).toBe("5");
        expect(url.searchParams.get("scope")).toBe("bot applications.commands");
        expect(url.searchParams.get("permissions")).toBe("8");
        expect(new URL(client.generateInvite()).searchParams.get("scope")).toBe(
            "bot",
        );
    });
});
