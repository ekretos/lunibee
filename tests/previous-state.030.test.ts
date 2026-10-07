import { describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";

const G = "200000000000000000";
const U = "300000000000000000";
const C = "100000000000000000";

function client(options: Record<string, unknown> = {}) {
    const c = new Client({ token: "a.b", intents: 0, ...options });
    const gw = c.gateway as unknown as {
        emit(event: string, data: unknown): void;
    };
    return { c, gw };
}

function collect<A extends unknown[]>(
    run: (listener: (...args: A) => void) => void,
): A[] {
    const calls: A[] = [];
    run((...args) => calls.push(args));
    return calls;
}

describe("previous state on update events", () => {
    test("voiceStateUpdate", () => {
        const { c, gw } = client();
        const calls = collect<[{ channel_id: string | null }, unknown]>((on) =>
            c.on("voiceStateUpdate", on as never),
        );
        gw.emit("VOICE_STATE_UPDATE", {
            guild_id: G,
            user_id: U,
            channel_id: C,
        });
        gw.emit("VOICE_STATE_UPDATE", {
            guild_id: G,
            user_id: U,
            channel_id: null,
        });
        gw.emit("VOICE_STATE_UPDATE", { user_id: U, channel_id: C });
        expect(calls[0]![1]).toBeNull();
        expect(calls[1]![1]).toMatchObject({ channel_id: C });
        expect(calls[2]![1]).toBeNull();
    });

    test("presenceUpdate needs cache.presences", () => {
        const presence = (status: string) => ({
            guild_id: G,
            user: { id: U },
            status,
        });
        const on = client({ cache: { presences: true } });
        const seen = collect<[{ status: string }, { status: string } | null]>(
            (listener) => on.c.on("presenceUpdate", listener as never),
        );
        on.gw.emit("PRESENCE_UPDATE", presence("online"));
        on.gw.emit("PRESENCE_UPDATE", presence("idle"));
        expect(seen[0]![1]).toBeNull();
        expect(seen[1]![1]?.status).toBe("online");

        const off = client();
        const none = collect<[unknown, unknown]>((listener) =>
            off.c.on("presenceUpdate", listener as never),
        );
        off.gw.emit("PRESENCE_UPDATE", presence("online"));
        off.gw.emit("PRESENCE_UPDATE", presence("idle"));
        expect(none.map((call) => call[1])).toEqual([null, null]);
        off.gw.emit("GUILD_DELETE", { id: G });
    });

    test("stage instance, scheduled event and AutoMod rule updates", () => {
        const { c, gw } = client();
        const stage = collect<[{ topic: string }, { topic: string } | null]>(
            (on) => c.on("stageInstanceUpdate", on as never),
        );
        gw.emit("STAGE_INSTANCE_CREATE", {
            id: "1",
            channel_id: C,
            guild_id: G,
            topic: "a",
        });
        gw.emit("STAGE_INSTANCE_UPDATE", {
            id: "1",
            channel_id: C,
            guild_id: G,
            topic: "b",
        });
        expect(stage[0]![1]?.topic).toBe("a");
        gw.emit("STAGE_INSTANCE_DELETE", {
            id: "1",
            channel_id: C,
            guild_id: G,
            topic: "b",
        });
        gw.emit("STAGE_INSTANCE_UPDATE", {
            id: "1",
            channel_id: C,
            guild_id: G,
            topic: "c",
        });
        expect(stage[1]![1]).toBeNull();

        const events = collect<[{ name: string }, { name: string } | null]>(
            (on) => c.on("guildScheduledEventUpdate", on as never),
        );
        gw.emit("GUILD_SCHEDULED_EVENT_UPDATE", {
            id: "2",
            guild_id: G,
            name: "x",
        });
        gw.emit("GUILD_SCHEDULED_EVENT_UPDATE", {
            id: "2",
            guild_id: G,
            name: "y",
        });
        expect(events[0]![1]).toBeNull();
        expect(events[1]![1]?.name).toBe("x");

        const rules = collect<[{ name: string }, { name: string } | null]>(
            (on) => c.on("autoModerationRuleUpdate", on as never),
        );
        gw.emit("AUTO_MODERATION_RULE_CREATE", {
            id: "3",
            guild_id: G,
            name: "r1",
        });
        gw.emit("AUTO_MODERATION_RULE_UPDATE", {
            id: "3",
            guild_id: G,
            name: "r2",
        });
        expect(rules[0]![1]?.name).toBe("r1");
    });
});
