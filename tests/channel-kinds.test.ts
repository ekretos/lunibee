import { describe, expect, test } from "bun:test";
import {
    channelCreatePayload,
    Client,
    type CreateChannelOptions,
} from "../packages/core/src/index.ts";
import {
    createChannel,
    DMChannel,
    ForumChannel,
    MediaChannel,
    NewsChannel,
    StageChannel,
    ThreadChannel,
    VoiceChannel,
    CategoryChannel,
} from "../packages/structures/src/index.ts";
import { TextChannel } from "../packages/structures/src/resources.ts";
import {
    channelKindOf,
    channelTypesOf,
    ChannelKinds,
    type ChannelKind,
} from "../packages/types/src/index.ts";

const GUILD = "100000000000000001";
const CHANNEL = "100000000000000003";
const channel = (type: number) =>
    createChannel({ id: CHANNEL, type, name: "c" });

describe("channel kinds", () => {
    test("every type has a kind and every kind lists its types", () => {
        const expected: [number, ChannelKind | "unknown"][] = [
            [0, "text"],
            [1, "dm"],
            [2, "voice"],
            [3, "group-dm"],
            [4, "category"],
            [5, "announcement"],
            [10, "thread"],
            [11, "thread"],
            [12, "thread"],
            [13, "stage"],
            [14, "directory"],
            [15, "forum"],
            [16, "media"],
            [99, "unknown"],
        ];
        for (const [type, kind] of expected) {
            expect(channelKindOf(type), String(type)).toBe(kind);
            expect(channel(type).kind).toBe(kind);
        }
        expect(channelTypesOf("thread")).toEqual([10, 11, 12]);
        expect(channelTypesOf("text")).toEqual([0]);
        expect(Object.keys(ChannelKinds)).toHaveLength(11);
    });

    test("is() narrows to the class, with one or several kinds", () => {
        const voice = channel(2);
        expect(voice.is("voice")).toBe(true);
        expect(voice.is("text")).toBe(false);
        expect(voice.is("text", "voice")).toBe(true);
        if (voice.is("voice")) expect(voice.bitrate).toBeGreaterThanOrEqual(0);
        const classes: [number, unknown, string][] = [
            [0, TextChannel, "text"],
            [5, NewsChannel, "announcement"],
            [2, VoiceChannel, "voice"],
            [13, StageChannel, "stage"],
            [4, CategoryChannel, "category"],
            [11, ThreadChannel, "thread"],
            [15, ForumChannel, "forum"],
            [16, MediaChannel, "media"],
            [1, DMChannel, "dm"],
            [3, DMChannel, "group-dm"],
        ];
        for (const [type, cls, kind] of classes)
            expect(channel(type), kind).toBeInstanceOf(
                cls as new (...args: never[]) => object,
            );
    });

    test("as() returns the channel or explains the mismatch", () => {
        const text = channel(0);
        expect(text.as("text")).toBe(text);
        expect(text.as("text", "announcement")).toBe(text);
        expect(() => text.as("voice")).toThrow(
            `Channel ${CHANNEL} is a text channel, not voice.`,
        );
        expect(() => text.as("voice", "stage")).toThrow("not voice or stage");
    });
});

type Call = {
    method: string;
    path: string;
    body?: Record<string, unknown>;
    reason?: string;
};

function setup(answer: (call: Call) => unknown) {
    const bot = new Client({ token: "a.b", intents: 0 });
    const calls: Call[] = [];
    for (const method of ["get", "post"] as const)
        (bot.rest as unknown as Record<string, unknown>)[method] = async (
            path: string,
            body?: Record<string, unknown>,
            options?: { reason?: string },
        ) => {
            const call = { method, path, body, reason: options?.reason };
            calls.push(call);
            return answer(call);
        };
    return { bot, calls };
}

describe("handle.as() and guild.createChannel()", () => {
    test("channel handle as() fetches then narrows", async () => {
        const { bot, calls } = setup(() => ({
            id: CHANNEL,
            type: 2,
            guild_id: GUILD,
            name: "voice",
            bitrate: 64_000,
        }));
        const voice = await bot.channel(CHANNEL).as("voice");
        expect(voice.bitrate).toBe(64_000);
        expect(calls).toHaveLength(1);
        await expect(bot.channel(CHANNEL).as("text")).rejects.toThrow(
            TypeError,
        );
        expect(calls).toHaveLength(1);
    });

    test("each kind is created with the right type and fields", async () => {
        const { bot, calls } = setup((call) => ({
            id: CHANNEL,
            guild_id: GUILD,
            name: String(call.body?.name),
            type: call.body?.type,
        }));
        const guild = bot.guild(GUILD);
        const text = await guild.createChannel({
            kind: "text",
            name: "general",
            parent: "100000000000000009",
            topic: "hi",
            slowmode: 10,
            nsfw: false,
            autoArchive: 60,
            reason: "setup",
        });
        expect(text).toBeInstanceOf(TextChannel);
        const voice = await guild.createChannel({
            kind: "voice",
            name: "talk",
            bitrate: 64_000,
            userLimit: 5,
            region: null,
            videoQuality: "720p",
        });
        expect(voice).toBeInstanceOf(VoiceChannel);
        const category = await guild.createChannel({
            kind: "category",
            name: "cat",
            position: 2,
        });
        expect(category).toBeInstanceOf(CategoryChannel);
        await guild.createChannel({ kind: "announcement", name: "news" });
        await guild.createChannel({ kind: "stage", name: "stage" });
        const forum = await guild.createChannel({
            kind: "forum",
            name: "help",
            tags: [
                { name: "bug", emoji: "🐛", moderated: true },
                { name: "custom", emoji: "123456789012345678" },
                { name: "plain" },
            ],
            defaultReaction: "👍",
            sortOrder: "creation-date",
            layout: "gallery",
            threadSlowmode: 30,
        });
        expect(forum).toBeInstanceOf(ForumChannel);
        await guild.createChannel({
            kind: "media",
            name: "art",
            defaultReaction: "987654321098765432",
            sortOrder: "latest-activity",
            layout: "list",
        });
        expect(calls.every((c) => c.path === `/guilds/${GUILD}/channels`)).toBe(
            true,
        );
        expect(calls.map((c) => c.body?.type)).toEqual([
            0, 2, 4, 5, 13, 15, 16,
        ]);
        expect(calls[0]).toMatchObject({
            reason: "setup",
            body: {
                name: "general",
                parent_id: "100000000000000009",
                topic: "hi",
                rate_limit_per_user: 10,
                nsfw: false,
                default_auto_archive_duration: 60,
            },
        });
        expect(calls[1]!.body).toMatchObject({
            bitrate: 64_000,
            user_limit: 5,
            rtc_region: null,
            video_quality_mode: 2,
        });
        expect(calls[2]!.body).toMatchObject({ position: 2 });
        expect(calls[5]!.body).toMatchObject({
            available_tags: [
                {
                    name: "bug",
                    moderated: true,
                    emoji_id: null,
                    emoji_name: "🐛",
                },
                {
                    name: "custom",
                    moderated: false,
                    emoji_id: "123456789012345678",
                    emoji_name: null,
                },
                { name: "plain", moderated: false },
            ],
            default_reaction_emoji: { emoji_id: null, emoji_name: "👍" },
            default_sort_order: 1,
            default_forum_layout: 2,
            default_thread_rate_limit_per_user: 30,
        });
        expect(calls[6]!.body).toMatchObject({
            default_reaction_emoji: {
                emoji_id: "987654321098765432",
                emoji_name: null,
            },
            default_sort_order: 0,
            default_forum_layout: 1,
        });
    });

    test("an answer of the wrong kind is reported", async () => {
        const { bot } = setup(() => ({
            id: CHANNEL,
            type: 0,
            guild_id: GUILD,
            name: "x",
        }));
        await expect(
            bot.guild(GUILD).createChannel({ kind: "voice", name: "x" }),
        ).rejects.toThrow(TypeError);
    });
});

describe("channelCreatePayload", () => {
    test("refuses what Discord would", () => {
        const make = (options: object) => () =>
            channelCreatePayload(options as CreateChannelOptions);
        expect(make({ kind: "text", name: "" })).toThrow(RangeError);
        expect(make({ kind: "text", name: "x".repeat(101) })).toThrow(
            RangeError,
        );
        expect(make({ kind: "text", name: "a", slowmode: 21_601 })).toThrow(
            RangeError,
        );
        expect(make({ kind: "text", name: "a", slowmode: 1.5 })).toThrow(
            RangeError,
        );
        expect(make({ kind: "voice", name: "a", userLimit: 100 })).toThrow(
            RangeError,
        );
        expect(make({ kind: "thread", name: "a" })).toThrow(TypeError);
        expect(make({ kind: "dm", name: "a" })).toThrow("Use one of: text");
        expect(
            channelCreatePayload({ kind: "text", name: "ok", slowmode: 0 })
                .rate_limit_per_user,
        ).toBe(0);
    });
});
