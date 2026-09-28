import { describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import { REST } from "../packages/rest/src/index.ts";
import { EmojiManager } from "../packages/managers/src/index.ts";

const G = "200000000000000000";
const U = "300000000000000000";
const V = "100000000000000000";

function setup() {
    const client = new Client({ token: "a.b", intents: 0 });
    const gw = client.gateway as unknown as {
        emit(e: string, d: unknown): void;
    };
    const events: string[] = [];
    return { client, gw, events };
}

describe("voice states, automod rules and invites", () => {
    test("follow Gateway events", () => {
        const { client, gw } = setup();
        const state = {
            guild_id: G,
            channel_id: V,
            user_id: U,
            session_id: "s",
            deaf: false,
        };
        gw.emit("GUILD_CREATE", { id: G, name: "g", voice_states: [state] });
        expect(client.guilds.voiceStates(G).get(U)?.channel_id).toBe(V);
        gw.emit("VOICE_STATE_UPDATE", { ...state, channel_id: null });
        expect(client.guilds.voiceStates(G).has(U)).toBe(false);
        gw.emit("VOICE_STATE_UPDATE", { ...state, guild_id: undefined });

        const rule = { id: "9", guild_id: G, name: "r" };
        gw.emit("AUTO_MODERATION_RULE_CREATE", rule);
        gw.emit("AUTO_MODERATION_RULE_UPDATE", { ...rule, name: "r2" });
        expect(client.guilds.autoModerationRules(G).get("9")?.name).toBe("r2");
        gw.emit("AUTO_MODERATION_RULE_DELETE", rule);
        expect(client.guilds.autoModerationRules(G).size).toBe(0);

        gw.emit("INVITE_CREATE", { code: "abc", guild_id: G, channel_id: V });
        gw.emit("INVITE_CREATE", { code: "dm", channel_id: V });
        expect(client.guilds.invites(G).has("abc")).toBe(true);
        gw.emit("INVITE_DELETE", { code: "abc", guild_id: G, channel_id: V });
        gw.emit("INVITE_DELETE", { code: "dm", channel_id: V });
        expect(client.guilds.invites(G).has("abc")).toBe(false);

        gw.emit("GUILD_DELETE", { id: G });
        expect(client.guilds.voiceStates(G).size).toBe(0);
    });

    test("soundboard events are emitted", () => {
        const { client, gw, events } = setup();
        for (const name of [
            "soundboardSoundCreate",
            "soundboardSoundUpdate",
            "soundboardSoundDelete",
            "soundboardSoundsUpdate",
        ] as const)
            client.on(name, () => events.push(name));
        const sound = {
            sound_id: "1",
            name: "s",
            volume: 1,
            emoji_id: null,
            emoji_name: null,
            available: true,
        };
        gw.emit("GUILD_SOUNDBOARD_SOUND_CREATE", sound);
        gw.emit("GUILD_SOUNDBOARD_SOUND_UPDATE", { ...sound, guild_id: G });
        gw.emit("GUILD_SOUNDBOARD_SOUND_DELETE", {
            sound_id: "1",
            guild_id: G,
        });
        gw.emit("GUILD_SOUNDBOARD_SOUNDS_UPDATE", {
            guild_id: G,
            soundboard_sounds: [],
        });
        expect(events).toHaveLength(4);
    });
});

describe("EmojiManager.fetch", () => {
    test("shares concurrent fetches and keeps a newer write", async () => {
        let calls = 0;
        let release!: (value: unknown) => void;
        const rest = new REST({ token: "t" });
        (rest as unknown as { get: unknown }).get = () => {
            calls++;
            return new Promise((resolve) => (release = resolve));
        };
        const emojis = new EmojiManager(rest, G);
        const a = emojis.fetch("5");
        const b = emojis.fetch("5");
        expect(a).toBe(b);
        emojis.upsert({ id: "5", name: "new" });
        release({ id: "5", name: "old" });
        expect((await a).name).toBe("new");
        expect(calls).toBe(1);
        const c = emojis.fetch("6");
        release({ id: "6", name: "six" });
        expect((await c).name).toBe("six");
        expect(emojis.get("6")?.name).toBe("six");
    });
});
