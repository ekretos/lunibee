import { describe, expect, test } from "bun:test";
import { HttpTransport, REST } from "../packages/rest/src/index.ts";
import { GuildManager, AuditLogEvent } from "../packages/managers/src/index.ts";
import {
    AuditLog,
    Guild,
    Message,
    Role,
    Sticker,
    stickerURL,
} from "../packages/structures/src/index.ts";

const ID = "175928847299117063";
const created = Number((BigInt(ID) >> 22n) + 1420070400000n);

describe("createdTimestamp", () => {
    test("every snowflake structure has it; messages honour their timestamp", () => {
        const role = new Role({ id: ID, name: "r" });
        expect(role.createdTimestamp).toBe(created);
        expect(role.createdAt.getTime()).toBe(created);
        const message = new Message({
            id: ID,
            channel_id: "1",
            author: { id: "2", username: "u" },
            content: "x",
            timestamp: "2020-01-01T00:00:00.000Z",
        });
        expect(message.createdTimestamp).toBe(
            Date.parse("2020-01-01T00:00:00.000Z"),
        );
    });

    test("Guild keeps the boost progress bar flag", () => {
        expect(new Guild({ id: ID, name: "g" }).premiumProgressBarEnabled).toBe(
            false,
        );
        expect(
            new Guild({ id: ID, name: "g", premium_progress_bar_enabled: true })
                .premiumProgressBarEnabled,
        ).toBe(true);
    });
});

describe("Sticker", () => {
    const data = (format_type: number) => ({
        id: ID,
        name: "wave",
        description: null,
        tags: "hi",
        type: 2,
        format_type,
        guild_id: "5",
        sort_value: 3,
        user: { id: "9", username: "u" },
    });

    test("URLs follow the format", () => {
        expect(new Sticker(data(1)).url()).toBe(
            `https://cdn.discordapp.com/stickers/${ID}.png`,
        );
        expect(new Sticker(data(2)).url({ size: 128 })).toBe(
            `https://cdn.discordapp.com/stickers/${ID}.png?size=128`,
        );
        expect(new Sticker(data(3)).url()).toBe(
            `https://cdn.discordapp.com/stickers/${ID}.json`,
        );
        expect(new Sticker(data(4)).url({ size: 64 })).toBe(
            `https://media.discordapp.net/stickers/${ID}.gif?size=64`,
        );
        expect(stickerURL("1", 1)).toBe(
            "https://cdn.discordapp.com/stickers/1.png",
        );
    });

    test("fields, animation and the message form", () => {
        const sticker = new Sticker(data(1));
        expect(sticker).toMatchObject({
            name: "wave",
            tags: "hi",
            guildId: "5",
            packId: null,
            sortValue: 3,
            available: true,
            description: null,
        });
        expect(sticker.animated).toBe(false);
        expect(new Sticker(data(4)).animated).toBe(true);
        expect(sticker.toItem()).toEqual({
            id: ID,
            name: "wave",
            format_type: 1,
        });
        const bare = new Sticker({
            id: ID,
            name: "x",
            type: 1,
            format_type: 1,
        });
        expect(bare).toMatchObject({ tags: "", user: null, guildId: null });
    });
});

describe("AuditLog", () => {
    const entry = (
        id: string,
        action_type: number,
        extra: Record<string, unknown> = {},
    ) => ({ id, action_type, user_id: "10", target_id: "20", ...extra });
    // Snowflakes for 2020-01-01 and 2021-01-01.
    const old = String(
        (BigInt(Date.parse("2020-01-01")) - 1420070400000n) << 22n,
    );
    const recent = String(
        (BigInt(Date.parse("2021-01-01")) - 1420070400000n) << 22n,
    );
    const log = new AuditLog({
        audit_log_entries: [
            entry(recent, 72, { options: { channel_id: "7", count: "3" } }),
            entry("3", 20, { target_id: "21", user_id: "11" }),
            entry(old, 21, {
                options: { delete_member_days: "7", members_removed: "12" },
                changes: [{ key: "nick", old_value: "a", new_value: "b" }],
            }),
            entry("4", 13, {
                options: { id: "5", type: "0", role_name: "Mod" },
            }),
            entry("5", 26, { options: { channel_id: "8", count: "2" } }),
            entry("6", 27, { options: { count: "1" } }),
            entry("7", 73, { options: { count: "50" } }),
            entry("8", 74, { options: { channel_id: "9", message_id: "10" } }),
            entry("9", 83, { options: { channel_id: "11" } }),
            entry("10", 121, { options: { app_id: "12" } }),
            entry("11", 143, {
                options: {
                    auto_moderation_rule_name: "no links",
                    auto_moderation_rule_trigger_type: "1",
                    channel_id: "13",
                },
            }),
            entry("12", 1),
        ],
    } as never);

    test("typed info per action type", () => {
        const [deleted, , prune] = [...log.entries.values()];
        if (!deleted!.is(72)) throw new Error("expected a message delete");
        expect(deleted.info).toEqual({ channelId: "7", count: 3 });
        if (!prune!.is(21)) throw new Error("expected a prune");
        expect(prune.info).toEqual({ deleteMemberDays: 7, membersRemoved: 12 });
        expect(prune.change("nick")).toEqual({ old: "a", new: "b" });
        expect(prune.change("nope")).toBeUndefined();
        const info = (id: string) => log.entries.get(id)!.info;
        expect(info("4")).toEqual({ id: "5", type: 0, roleName: "Mod" });
        expect(info("5")).toEqual({ channelId: "8", count: 2 });
        expect(info("6")).toEqual({ count: 1 });
        expect(info("7")).toEqual({ count: 50 });
        expect(info("8")).toEqual({ channelId: "9", messageId: "10" });
        expect(info("9")).toEqual({ channelId: "11" });
        expect(info("10")).toEqual({ applicationId: "12" });
        expect(info("11")).toEqual({
            ruleName: "no links",
            ruleTriggerType: 1,
            channelId: "13",
        });
        expect(info("12")).toBeUndefined();
        expect(log.entries.get("3")!.info).toBeUndefined();
        expect(log.entries.get("3")!.is(20)).toBe(true);
    });

    test("find and filter", () => {
        expect(log.find({ type: 20 })?.id).toBe("3");
        expect(log.find({ type: 20, targetId: "99" })).toBeUndefined();
        expect(log.find({ userId: "11" })?.id).toBe("3");
        expect(log.filter({ type: [72, 21] }).map((e) => e.id)).toEqual([
            recent,
            old,
        ]);
        expect(
            log
                .filter({ type: [72, 21], since: new Date("2020-06-01") })
                .map((e) => e.id),
        ).toEqual([recent]);
        expect(log.filter({ since: "2030-01-01" })).toEqual([]);
        expect(
            log.filter({ since: Date.parse("2020-06-01"), type: 21 }),
        ).toEqual([]);
    });

    test("GuildManager fetches it as an AuditLog", async () => {
        const rest = new REST({
            token: "t",
            transport: new HttpTransport({
                fetch: async () =>
                    new Response(
                        JSON.stringify({
                            audit_log_entries: [
                                entry("3", AuditLogEvent.MemberKick),
                            ],
                        }),
                        { headers: { "content-type": "application/json" } },
                    ),
            }),
        });
        const result = await new GuildManager(rest).fetchAuditLogEntries(ID, {
            actionType: AuditLogEvent.MemberKick,
        });
        expect(result).toBeInstanceOf(AuditLog);
        expect(
            result.find({ targetId: "20" })?.is(AuditLogEvent.MemberKick),
        ).toBe(true);
    });
});
