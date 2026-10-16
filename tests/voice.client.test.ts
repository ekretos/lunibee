import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import { VoiceError } from "../packages/voice/src/index.ts";
import { startFakeVoiceServer } from "./helpers/fake-voice-server.ts";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function until<T>(
    check: () => T | undefined | false,
    ms = 3000,
): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) throw new Error("until() timed out");
        await Bun.sleep(5);
    }
}

const GUILD = "100000000000000001";
const CHANNEL = "100000000000000002";
const BOT = "100000000000000003";

/** A client whose Gateway records op 4 instead of sending it, logged in as BOT. */
function client(options: { owns?: boolean } = {}) {
    const bot = new Client({ token: "a.b", intents: [] });
    const sent: {
        guildId: string;
        channelId: string | null;
        options: unknown;
    }[] = [];
    const gateway = bot.gateway as unknown as Record<string, unknown>;
    gateway.sendVoiceState = (
        guildId: string,
        channelId: string | null,
        opts: unknown,
    ) => {
        sent.push({ guildId, channelId, options: opts });
        return true;
    };
    gateway.ownsGuild = () => options.owns ?? true;
    bot.gateway.emit("READY", {
        v: 10,
        user: { id: BOT, username: "bot", discriminator: "0", bot: true },
        guilds: [],
        session_id: "gw",
        resume_gateway_url: "wss://example",
        application: { id: "1" },
    });
    cleanup.push(() => bot.destroy());
    return { bot, sent };
}

describe("client.voice", () => {
    test("join() sends op 4, uses the client's own voice events, and resolves when ready", async () => {
        const server = await startFakeVoiceServer();
        cleanup.push(() => server.stop());
        const { bot, sent } = client();
        const joining = bot.voice.join({
            guildId: GUILD,
            channelId: CHANNEL,
            selfDeaf: true,
            dave: false,
            networking: { url: server.url },
        });
        expect(sent).toEqual([
            {
                guildId: GUILD,
                channelId: CHANNEL,
                options: { selfMute: false, selfDeaf: true },
            },
        ]);
        // Someone else's voice state is not ours.
        bot.gateway.emit("VOICE_STATE_UPDATE", {
            guild_id: GUILD,
            channel_id: CHANNEL,
            user_id: "999",
            session_id: "x",
        });
        bot.gateway.emit("VOICE_SERVER_UPDATE", {
            guild_id: GUILD,
            token: "tok",
            endpoint: server.endpoint,
        });
        bot.gateway.emit("VOICE_STATE_UPDATE", {
            guild_id: GUILD,
            channel_id: CHANNEL,
            user_id: BOT,
            session_id: "s1",
            deaf: false,
            mute: false,
            self_deaf: true,
            self_mute: false,
            suppress: false,
        });
        const connection = await joining;
        expect(connection.status).toBe("ready");
        expect(bot.voice.get(GUILD)).toBe(connection);
        expect(server.state.identifies[0]).toMatchObject({
            user_id: BOT,
            session_id: "s1",
            token: "tok",
        });

        // Joining again in the same guild moves the same connection.
        const moving = bot.voice.join({
            guildId: GUILD,
            channelId: "100000000000000004",
            networking: { url: server.url },
        });
        expect(sent.at(-1)!.channelId).toBe("100000000000000004");
        bot.gateway.emit("VOICE_STATE_UPDATE", {
            guild_id: GUILD,
            channel_id: "100000000000000004",
            user_id: BOT,
            session_id: "s1",
        });
        expect(await moving).toBe(connection);

        expect(bot.voice.leave(GUILD)).toBe(true);
        expect(sent.at(-1)!.channelId).toBeNull();
        expect(connection.status).toBe("destroyed");
        expect(bot.voice.get(GUILD)).toBeUndefined();
        expect(bot.voice.leave(GUILD)).toBe(false);
    });

    test("join() rejects for a guild on another shard, and on timeout", async () => {
        const foreign = client({ owns: false });
        await expect(
            foreign.bot.voice.join({ guildId: GUILD, channelId: CHANNEL }),
        ).rejects.toThrow(/another shard/);
        expect(foreign.sent).toEqual([]);
        const { bot } = client();
        const error = await bot.voice
            .join({ guildId: GUILD, channelId: CHANNEL, timeout: 30 })
            .catch((e) => e);
        expect(error).toBeInstanceOf(VoiceError);
        expect(String(error)).toMatch(/timed out|No voice connection/);
    });

    test("leaving the guild, and destroying the client, end the connection", async () => {
        const server = await startFakeVoiceServer();
        cleanup.push(() => server.stop());
        const { bot, sent } = client();
        const joining = bot.voice.join({
            guildId: GUILD,
            channelId: CHANNEL,
            dave: false,
            networking: { url: server.url },
        });
        bot.gateway.emit("VOICE_STATE_UPDATE", {
            guild_id: GUILD,
            channel_id: CHANNEL,
            user_id: BOT,
            session_id: "s1",
        });
        bot.gateway.emit("VOICE_SERVER_UPDATE", {
            guild_id: GUILD,
            token: "tok",
            endpoint: server.endpoint,
        });
        const connection = await joining;
        bot.gateway.emit("GUILD_DELETE", { id: GUILD });
        expect(connection.status).toBe("destroyed");
        // Removed from the guild: nothing to leave, so no op 4.
        expect(sent.filter((s) => s.channelId === null)).toEqual([]);

        const again = bot.voice.join({
            guildId: "100000000000000005",
            channelId: CHANNEL,
        });
        again.catch(() => undefined);
        const second = bot.voice.get("100000000000000005")!;
        bot.destroy();
        expect(second.status).toBe("destroyed");
        expect(sent.at(-1)).toMatchObject({
            guildId: "100000000000000005",
            channelId: null,
        });
    });
});

describe("lifecycle (Step 8)", () => {
    test("100 join/leave cycles leave no socket, timer or connection behind", async () => {
        const server = await startFakeVoiceServer();
        cleanup.push(() => server.stop());
        const { bot } = client();
        let opened = 0;
        let closed = 0;
        const udpFactory = async (onData: (data: Uint8Array) => void) => {
            const socket = await Bun.udpSocket({
                socket: {
                    data: (_s, data) => onData(new Uint8Array(data)),
                    error: () => undefined,
                },
            });
            opened++;
            return {
                send: (data: Uint8Array, port: number, address: string) =>
                    socket.send(data, port, address),
                close: () => {
                    closed++;
                    socket.close();
                },
            };
        };
        const before = process.memoryUsage().heapUsed;
        for (let i = 0; i < 100; i++) {
            const joining = bot.voice.join({
                guildId: GUILD,
                channelId: CHANNEL,
                dave: false,
                networking: { url: server.url, udpFactory },
            });
            bot.gateway.emit("VOICE_STATE_UPDATE", {
                guild_id: GUILD,
                channel_id: CHANNEL,
                user_id: BOT,
                session_id: `s${i}`,
            });
            bot.gateway.emit("VOICE_SERVER_UPDATE", {
                guild_id: GUILD,
                token: "tok",
                endpoint: server.endpoint,
            });
            const connection = await joining;
            expect(connection.status).toBe("ready");
            bot.voice.leave(GUILD);
        }
        expect(opened).toBe(100);
        expect(closed).toBe(100);
        expect(bot.voice.connections.size).toBe(0);
        await until(() => server.state.connections === 100);
        Bun.gc(true);
        const grownMB = (process.memoryUsage().heapUsed - before) / 1048576;
        // Generous bound: a leak of one session per cycle would be far larger.
        expect(grownMB).toBeLessThan(40);
    }, 60_000);
});
