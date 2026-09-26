import { describe, expect, test } from "bun:test";
import {
    IntentsBitField,
    GatewayIntentBits,
    resolveGatewayIntents,
    Gateway,
    REST,
    GuildManager,
    ChannelManager,
    StageInstanceManager,
    GuildBanManager,
    GuildScheduledEventManager,
    PermissionOverwriteManager,
    Client,
} from "../packages/lunibee/src/index.ts";

describe("IntentsBitField", () => {
    test("resolves, mutates and lists intents", () => {
        const intents = new IntentsBitField([
            IntentsBitField.Flags.Guilds,
            "GuildMessages",
        ]);
        expect(intents.bitfield).toBe(
            GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
        );
        expect(intents.has("Guilds")).toBe(true);
        expect(intents.has(["Guilds", "GuildMembers"])).toBe(false);
        expect(intents.any(["Guilds", "GuildMembers"])).toBe(true);
        intents.add("GuildMembers").remove("Guilds");
        expect(intents.toArray()).toEqual(["GuildMembers", "GuildMessages"]);
        expect(intents.equals(["GuildMembers", "GuildMessages"])).toBe(true);
        expect(+intents).toBe(intents.bitfield);
        expect(JSON.stringify({ intents })).toBe(
            `{"intents":${intents.bitfield}}`,
        );
        expect(new IntentsBitField().bitfield).toBe(0);
    });

    test("is accepted wherever intents are", () => {
        const intents = new IntentsBitField(["Guilds"]);
        expect(resolveGatewayIntents(intents)).toBe(GatewayIntentBits.Guilds);
        expect(() => new Gateway({ token: "t", intents })).not.toThrow();
        expect(() => new Client({ token: "t", intents })).not.toThrow();
    });
});

const recordingRest = (reply: (method: string, path: string) => unknown) => {
    const calls: [string, string, unknown?, unknown?][] = [];
    const rest = new REST({ token: "t" });
    for (const method of ["get", "post", "patch", "put", "delete"] as const)
        (rest as unknown as Record<string, unknown>)[method] = async (
            path: string,
            body?: unknown,
            options?: unknown,
        ) => {
            calls.push([method, path, body, options]);
            return reply(method, path);
        };
    return { rest, calls };
};

describe("guild resource managers", () => {
    test("GuildBanManager", async () => {
        const ban = { user: { id: "5", username: "u" }, reason: "r" };
        const { rest, calls } = recordingRest((_m, path) =>
            path.endsWith("/bans/5") ? ban : [ban],
        );
        const bans = new GuildManager(rest).bans("1");
        expect(new GuildManager(rest).bans("1")).not.toBe(bans);
        expect(bans).toBeInstanceOf(GuildBanManager);
        await bans.fetch("5");
        await bans.fetchAll({ limit: 5000, after: "2" });
        await bans.create("5", { deleteMessageSeconds: 60, reason: "spam" });
        await bans.remove("5", "appeal");
        expect(calls).toEqual([
            ["get", "/guilds/1/bans/5", undefined, undefined],
            ["get", "/guilds/1/bans?limit=1000&after=2", undefined, undefined],
            [
                "put",
                "/guilds/1/bans/5",
                { delete_message_seconds: 60 },
                { reason: "spam" },
            ],
            ["delete", "/guilds/1/bans/5", { reason: "appeal" }, undefined],
        ]);
        expect(bans.has("5")).toBe(false);
    });

    test("GuildScheduledEventManager", async () => {
        const event = { id: "9", guild_id: "1", name: "e" };
        const { rest, calls } = recordingRest((_m, path) =>
            path.includes("/scheduled-events?") ||
            path.endsWith("scheduled-events")
                ? [event]
                : event,
        );
        const guilds = new GuildManager(rest);
        const events = guilds.scheduledEvents("1");
        expect(guilds.scheduledEvents("1")).toBe(events);
        expect(events).toBeInstanceOf(GuildScheduledEventManager);
        await events.fetch("9", { withUserCount: true });
        await events.fetchAll();
        await events.create({ name: "e" }, "why");
        await events.edit("9", { name: "f" });
        await events.fetchSubscribers("9", { limit: 500, withMember: true });
        await events.remove("9");
        expect(calls.map(([m, p]) => `${m} ${p}`)).toEqual([
            "get /guilds/1/scheduled-events/9?with_user_count=true",
            "get /guilds/1/scheduled-events",
            "post /guilds/1/scheduled-events",
            "patch /guilds/1/scheduled-events/9",
            "get /guilds/1/scheduled-events/9/users?limit=100&with_member=true",
            "delete /guilds/1/scheduled-events/9",
        ]);
        expect(calls[2]![3]).toEqual({ reason: "why" });
        expect(events.has("9")).toBe(false);
    });

    test("StageInstanceManager", async () => {
        const stage = { id: "3", guild_id: "1", channel_id: "7", topic: "t" };
        const { rest, calls } = recordingRest(() => stage);
        const stages = new Client({ token: "t", intents: 0 }).stageInstances;
        expect(stages).toBeInstanceOf(StageInstanceManager);
        const manager = new StageInstanceManager(rest);
        await manager.create("7", { topic: "t", privacyLevel: 2 });
        expect(manager.get("7")).toEqual(stage as never);
        await manager.fetch("7");
        await manager.edit("7", { topic: "u" });
        await manager.remove("7", "done");
        expect(calls.map(([m, p]) => `${m} ${p}`)).toEqual([
            "post /stage-instances",
            "get /stage-instances/7",
            "patch /stage-instances/7",
            "delete /stage-instances/7",
        ]);
        expect(calls[0]![2]).toMatchObject({
            channel_id: "7",
            topic: "t",
            privacy_level: 2,
        });
        expect(manager.has("7")).toBe(false);
    });

    test("PermissionOverwriteManager", async () => {
        const { rest, calls } = recordingRest(() => undefined);
        const overwrites = new ChannelManager(rest).permissionOverwrites("4");
        expect(overwrites).toBeInstanceOf(PermissionOverwriteManager);
        await overwrites.edit("8", { type: 0, allow: 1024n, deny: 2 }, "r");
        await overwrites.remove("8");
        expect(calls).toEqual([
            [
                "put",
                "/channels/4/permissions/8",
                { type: 0, allow: "1024", deny: "2" },
                { reason: "r" },
            ],
            [
                "delete",
                "/channels/4/permissions/8",
                { reason: undefined },
                undefined,
            ],
        ]);
    });
});

import {
    Channel,
    TextChannel,
    NewsChannel,
    DMChannel,
    VoiceChannel,
    StageChannel,
    CategoryChannel,
    ThreadChannel,
    ForumChannel,
    MediaChannel,
    createChannel,
} from "../packages/lunibee/src/index.ts";

describe("channel subclasses", () => {
    const make = (type: number, extra: Record<string, unknown> = {}) =>
        createChannel({ id: "1", type, ...extra } as never);

    test("createChannel picks the most specific class", () => {
        const cases: [number, unknown][] = [
            [0, TextChannel],
            [1, DMChannel],
            [2, VoiceChannel],
            [3, DMChannel],
            [4, CategoryChannel],
            [5, NewsChannel],
            [10, ThreadChannel],
            [11, ThreadChannel],
            [12, ThreadChannel],
            [13, StageChannel],
            [15, ForumChannel],
            [16, MediaChannel],
            [14, Channel],
        ];
        for (const [type, cls] of cases) {
            const channel = make(type);
            expect(channel.constructor).toBe(cls as never);
            expect(channel).toBeInstanceOf(Channel);
        }
    });

    test("type guards", () => {
        expect(make(11).isThread()).toBe(true);
        expect(make(0).isThread()).toBe(false);
        expect(make(13).isVoiceBased()).toBe(true);
        expect(make(4).isTextBased()).toBe(false);
        expect(make(2).isTextBased()).toBe(true);
        expect(make(3).isDMBased()).toBe(true);
        expect(make(0).isDMBased()).toBe(false);
    });

    test("subclass fields", () => {
        const voice = make(2, {
            bitrate: 96000,
            user_limit: 5,
            rtc_region: "us",
        }) as VoiceChannel;
        expect([voice.bitrate, voice.userLimit, voice.rtcRegion]).toEqual([
            96000,
            5,
            "us",
        ]);
        const defaults = make(13) as StageChannel;
        expect([
            defaults.bitrate,
            defaults.userLimit,
            defaults.rtcRegion,
        ]).toEqual([64000, 0, null]);
        const thread = make(11, {
            owner_id: "9",
            message_count: 3,
            thread_metadata: {
                archived: true,
                locked: false,
                auto_archive_duration: 60,
                archive_timestamp: "",
            },
        }) as ThreadChannel;
        expect([thread.ownerId, thread.messageCount, thread.archived]).toEqual([
            "9",
            3,
            true,
        ]);
        expect([thread.locked, thread.autoArchiveDuration]).toEqual([
            false,
            60,
        ]);
        const bare = make(12) as ThreadChannel;
        expect([bare.archived, bare.locked, bare.autoArchiveDuration]).toEqual([
            false,
            false,
            null,
        ]);
        const dm = make(1, {
            recipients: [{ id: "2", username: "u" }],
        }) as DMChannel;
        expect(dm.recipients[0]!.id).toBe("2");
        expect(dm.ownerId).toBeNull();
        const forum = make(15, {
            available_tags: [{ id: "1", name: "t" }],
        }) as ForumChannel;
        expect(forum.availableTags).toHaveLength(1);
        expect(forum.defaultReactionEmoji).toBeNull();
        expect(forum.defaultThreadRateLimitPerUser).toBe(0);
    });
});
