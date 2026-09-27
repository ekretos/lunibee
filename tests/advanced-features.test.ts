import { describe, expect, test } from "bun:test";
import { REST, Routes } from "../packages/rest/src/index.ts";
import {
    ChannelManager,
    GuildSoundboardManager,
    GuildStickerManager,
    MonetizationManager,
} from "../packages/managers/src/index.ts";
import { Client } from "../packages/core/src/index.ts";

const G = "200000000000000000";
const C = "100000000000000000";
const M = "600000000000000000";
const APP = "700000000000000000";

function recordingRest(reply: (method: string, path: string) => unknown) {
    const calls: unknown[][] = [];
    const rest = new REST({ token: "t" });
    for (const method of ["get", "post", "patch", "put", "delete"] as const)
        (rest as unknown as Record<string, unknown>)[method] = async (
            path: string,
            ...rest: unknown[]
        ) => {
            calls.push([method, path, ...rest]);
            return reply(method, path);
        };
    return { rest, calls };
}

const sticker = (id: string) => ({ id, name: "s", type: 2, format_type: 1 });
const sound = (id: string) => ({
    sound_id: id,
    name: "s",
    volume: 1,
    emoji_id: null,
    emoji_name: null,
    available: true,
    guild_id: G,
});

describe("routes", () => {
    test("builds and validates advanced routes", () => {
        expect(Routes.pollAnswerVoters(C, M, 1)).toBe(
            `/channels/${C}/polls/${M}/answers/1`,
        );
        expect(() => Routes.pollAnswerVoters(C, M, -1)).toThrow(TypeError);
        expect(Routes.skuSubscription("1", "2")).toBe(
            "/skus/1/subscriptions/2",
        );
        expect(Routes.applicationEntitlement(APP, "3")).toBe(
            `/applications/${APP}/entitlements/3`,
        );
    });
});

describe("GuildStickerManager", () => {
    test("fetches, creates as multipart, edits, removes and syncs", async () => {
        const { rest, calls } = recordingRest((method, path) =>
            method === "get" && path.endsWith("/stickers")
                ? [sticker("1"), sticker("2")]
                : sticker("1"),
        );
        const stickers = new GuildStickerManager(rest, G);
        expect(await stickers.fetchAll()).toHaveLength(2);
        await stickers.fetch("1");
        await stickers.create({
            name: "s",
            description: "d",
            tags: "smile",
            file: new Blob(["x"]),
            reason: "r",
        });
        expect(calls[2]![2]).toBeInstanceOf(FormData);
        expect(calls[2]![3]).toEqual({ reason: "r" });
        await stickers.edit("1", { name: "n", reason: "r" });
        expect(calls[3]!.slice(2)).toEqual([{ name: "n" }, { reason: "r" }]);
        await stickers.remove("2");
        expect(stickers.has("2")).toBe(false);
        stickers.sync([sticker("9")]);
        expect([...stickers.cache.keys()]).toEqual(["9"]);
    });
});

describe("GuildSoundboardManager", () => {
    test("manages guild sounds", async () => {
        const { rest, calls } = recordingRest((method, path) =>
            method === "get" && path.endsWith("/soundboard-sounds")
                ? { items: [sound("1")] }
                : sound("2"),
        );
        const sounds = new GuildSoundboardManager(rest, G);
        expect(await sounds.fetchAll()).toHaveLength(1);
        await sounds.fetch("2");
        await sounds.create({
            name: "s",
            sound: "data:audio/ogg;base64,AA==",
            volume: 0.5,
        });
        expect(() =>
            sounds.create({ name: "s", sound: "x", volume: 2 }),
        ).toThrow(RangeError);
        await sounds.edit("2", { volume: null });
        await sounds.remove("2");
        expect(sounds.has("2")).toBe(false);
        expect(calls.map((c) => c[0])).toEqual([
            "get",
            "get",
            "post",
            "patch",
            "delete",
        ]);
    });
});

describe("MonetizationManager", () => {
    test("SKUs, entitlements and subscriptions", async () => {
        const entitlement = {
            id: "5",
            sku_id: "1",
            application_id: APP,
            type: 8,
            deleted: false,
        };
        const { rest, calls } = recordingRest((method, path) => {
            if (
                path.includes("/entitlements") &&
                method === "get" &&
                !path.includes("/entitlements/")
            )
                return [entitlement];
            if (method === "get" && path.includes("/entitlements/"))
                return entitlement;
            if (method === "post" && path.endsWith("/entitlements"))
                return { ...entitlement, id: "6" };
            return [];
        });
        const money = new MonetizationManager(rest, APP);
        await money.fetchSkus();
        await money.fetchEntitlements({
            userId: "9",
            skuIds: ["1", "2"],
            limit: 10,
            excludeEnded: true,
        });
        expect(calls[1]![1]).toBe(
            `/applications/${APP}/entitlements?user_id=9&sku_ids=1%2C2&limit=10&exclude_ended=true`,
        );
        expect(() => money.fetchEntitlements({ limit: 0 })).toThrow(RangeError);
        await money.fetch("5");
        await money.consume("5");
        expect(money.get("5")?.consumed).toBe(true);
        await money.consume("404");
        await money.createTestEntitlement({
            skuId: "1",
            ownerId: G,
            ownerType: 1,
        });
        expect(money.has("6")).toBe(true);
        await money.deleteTestEntitlement("6");
        expect(money.has("6")).toBe(false);
        await money.fetchSubscriptions("1", { userId: "9" });
        await money.fetchSubscription("1", "2");
        expect(calls.at(-2)![1]).toBe("/skus/1/subscriptions?user_id=9");
        expect(calls.at(-1)![1]).toBe("/skus/1/subscriptions/2");
    });
});

describe("ChannelManager polls and soundboard", () => {
    test("ends polls, lists voters and plays sounds", async () => {
        const { rest, calls } = recordingRest((method) =>
            method === "post"
                ? {
                      id: M,
                      channel_id: C,
                      author: { id: "1", username: "u" },
                      content: "",
                  }
                : { users: [{ id: "1", username: "u" }] },
        );
        const channels = new ChannelManager(rest);
        expect((await channels.endPoll(C, M)).id).toBe(M);
        const voters = await channels.fetchPollVoters(C, M, 1, {
            after: "5",
            limit: 10,
        });
        expect(voters[0]?.id).toBe("1");
        expect(calls[1]![1]).toBe(
            `/channels/${C}/polls/${M}/answers/1?after=5&limit=10`,
        );
        await channels.fetchPollVoters(C, M, 2);
        expect(calls[2]![1]).toBe(`/channels/${C}/polls/${M}/answers/2`);
        await expect(
            channels.fetchPollVoters(C, M, 1, { limit: 101 }),
        ).rejects.toThrow(RangeError);
        await channels.sendSoundboardSound(C, { soundId: "3" });
        expect(calls.at(-1)!.slice(1, 3)).toEqual([
            `/channels/${C}/send-soundboard-sound`,
            { sound_id: "3", source_guild_id: undefined },
        ]);
    });
});

describe("Client wiring", () => {
    test("keeps stickers, soundboard and entitlements in sync", async () => {
        const client = new Client({ token: "a.b", intents: 0 });
        const gw = client.gateway as unknown as {
            emit(e: string, d: unknown): void;
        };
        const events: string[] = [];
        client.on("entitlementCreate", () => events.push("create"));
        client.on("entitlementUpdate", () => events.push("update"));
        client.on("entitlementDelete", () => events.push("delete"));
        const entitlement = {
            id: "5",
            sku_id: "1",
            application_id: APP,
            type: 8,
            deleted: false,
        };
        gw.emit("ENTITLEMENT_CREATE", entitlement);
        gw.emit("READY", {
            user: { id: APP, username: "bot" },
            application: { id: APP },
        });
        gw.emit("READY", {
            user: { id: APP, username: "bot" },
            application: { id: APP },
        });
        gw.emit("ENTITLEMENT_UPDATE", entitlement);
        expect(client.monetization?.has("5")).toBe(true);
        gw.emit("ENTITLEMENT_DELETE", entitlement);
        expect(client.monetization?.has("5")).toBe(false);
        expect(events).toEqual(["create", "update", "delete"]);

        gw.emit("GUILD_STICKERS_UPDATE", {
            guild_id: G,
            stickers: [sticker("1")],
        });
        expect(client.guilds.stickers(G).has("1")).toBe(true);
        gw.emit("GUILD_SOUNDBOARD_SOUND_CREATE", sound("1"));
        gw.emit("GUILD_SOUNDBOARD_SOUND_UPDATE", {
            ...sound("2"),
            guild_id: undefined,
        });
        expect(client.guilds.soundboard(G).has("1")).toBe(true);
        gw.emit("GUILD_SOUNDBOARD_SOUND_DELETE", {
            sound_id: "1",
            guild_id: G,
        });
        expect(client.guilds.soundboard(G).has("1")).toBe(false);
        gw.emit("GUILD_SOUNDBOARD_SOUNDS_UPDATE", {
            guild_id: G,
            soundboard_sounds: [sound("3")],
        });
        expect([...client.guilds.soundboard(G).cache.keys()]).toEqual(["3"]);
        client.guilds.delete(G);

        const seen: string[] = [];
        (client.rest as unknown as Record<string, unknown>).get = async (
            path: string,
        ) => seen.push(path);
        await client.fetchDefaultSoundboardSounds();
        expect(seen).toEqual(["/soundboard-default-sounds"]);
    });
});
