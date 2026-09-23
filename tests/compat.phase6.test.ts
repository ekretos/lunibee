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
