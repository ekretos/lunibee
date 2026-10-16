import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import {
    AudioPlayer,
    AudioResource,
    VoiceConnection,
    VoiceError,
    type VoiceAdapterMethods,
    type VoiceStatePayload,
} from "../packages/voice/src/index.ts";
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
const OTHER = "100000000000000009";
const USER = "100000000000000003";

/** An adapter the test drives: it records op 4 payloads and holds the connection's callbacks. */
function testAdapter(options: { refuse?: boolean } = {}) {
    const sent: VoiceStatePayload[] = [];
    let methods: VoiceAdapterMethods | undefined;
    let destroyed = 0;
    return {
        sent,
        get methods() {
            return methods!;
        },
        get destroyed() {
            return destroyed;
        },
        adapterCreator: (m: VoiceAdapterMethods) => {
            methods = m;
            return {
                sendPayload: (payload: VoiceStatePayload) => {
                    sent.push(payload);
                    return !options.refuse;
                },
                destroy: () => void destroyed++,
            };
        },
    };
}

async function voiceServer() {
    const server = await startFakeVoiceServer();
    cleanup.push(() => server.stop());
    return server;
}

/** Endless "Opus" frames, as a resource. */
function endless(): AudioResource {
    let n = 0;
    return new AudioResource(
        (async function* () {
            for (;;) yield Uint8Array.of(0xfc, n++ & 0xff);
        })(),
        { prefetch: 3 },
    );
}

describe("joining and leaving (Step 1)", () => {
    for (const order of ["state first", "server first"] as const) {
        test(`connects when both events arrive (${order})`, async () => {
            const server = await voiceServer();
            const adapter = testAdapter();
            const connection = new VoiceConnection({
                guildId: GUILD,
                channelId: CHANNEL,
                selfDeaf: true,
                adapterCreator: adapter.adapterCreator,
                networking: { url: server.url },
                dave: false,
            });
            cleanup.push(() => connection.destroy());
            expect(connection.status).toBe("signalling");
            expect(adapter.sent).toEqual([
                {
                    op: 4,
                    d: {
                        guild_id: GUILD,
                        channel_id: CHANNEL,
                        self_mute: false,
                        self_deaf: true,
                    },
                },
            ]);
            const state = () =>
                adapter.methods.onVoiceStateUpdate({
                    guild_id: GUILD,
                    channel_id: CHANNEL,
                    user_id: USER,
                    session_id: "s1",
                });
            const srv = () =>
                adapter.methods.onVoiceServerUpdate({
                    guild_id: GUILD,
                    token: "tok",
                    endpoint: server.endpoint,
                });
            if (order === "state first") {
                state();
                expect(connection.status).toBe("signalling");
                srv();
            } else {
                srv();
                expect(connection.status).toBe("signalling");
                state();
            }
            await until(() => connection.status === "ready");
            expect(server.state.identifies[0]).toMatchObject({
                server_id: GUILD,
                user_id: USER,
                session_id: "s1",
                token: "tok",
            });
        });
    }

    test("times out when Discord never answers", async () => {
        const adapter = testAdapter();
        const errors: Error[] = [];
        const connection = new VoiceConnection({
            guildId: GUILD,
            channelId: CHANNEL,
            adapterCreator: adapter.adapterCreator,
            timeout: 40,
        });
        cleanup.push(() => connection.destroy());
        connection.on("error", (e) => errors.push(e));
        await until(() => connection.status === "disconnected");
        expect(connection.disconnectReason?.reason).toBe("timeout");
        expect(errors[0]).toBeInstanceOf(VoiceError);
    });

    test("an op 4 that cannot be sent disconnects at once", () => {
        const adapter = testAdapter({ refuse: true });
        const connection = new VoiceConnection({
            guildId: GUILD,
            channelId: CHANNEL,
            adapterCreator: adapter.adapterCreator,
        });
        expect(connection.status).toBe("disconnected");
        expect(connection.disconnectReason?.reason).toBe("unsent");
        connection.destroy(false);
    });

    test("disconnect() leaves (channel null) and rejoin() comes back", async () => {
        const server = await voiceServer();
        const adapter = testAdapter();
        const connection = new VoiceConnection({
            guildId: GUILD,
            channelId: CHANNEL,
            adapterCreator: adapter.adapterCreator,
            networking: { url: server.url },
            dave: false,
        });
        cleanup.push(() => connection.destroy());
        adapter.methods.onVoiceStateUpdate({
            guild_id: GUILD,
            channel_id: CHANNEL,
            user_id: USER,
            session_id: "s1",
        });
        adapter.methods.onVoiceServerUpdate({
            guild_id: GUILD,
            token: "tok",
            endpoint: server.endpoint,
        });
        await until(() => connection.status === "ready");
        expect(connection.disconnect()).toBe(true);
        expect(adapter.sent.at(-1)!.d.channel_id).toBeNull();
        expect(connection.status).toBe("disconnected");
        expect(connection.disconnectReason?.reason).toBe("left");
        adapter.methods.onVoiceStateUpdate({
            guild_id: GUILD,
            channel_id: null,
            user_id: USER,
            session_id: "s1",
        });
        expect(connection.disconnectReason?.reason).toBe("left");
        expect(connection.rejoin({ selfMute: true })).toBe(true);
        expect(adapter.sent.at(-1)!.d).toEqual({
            guild_id: GUILD,
            channel_id: CHANNEL,
            self_mute: true,
            self_deaf: false,
        });
        expect(connection.status).toBe("signalling");
        adapter.methods.onVoiceStateUpdate({
            guild_id: GUILD,
            channel_id: CHANNEL,
            user_id: USER,
            session_id: "s2",
        });
        adapter.methods.onVoiceServerUpdate({
            guild_id: GUILD,
            token: "tok",
            endpoint: server.endpoint,
        });
        await until(() => connection.status === "ready");
    });

    test("a moderator move reconnects, and a new voice server keeps the player playing", async () => {
        const first = await voiceServer();
        const second = await voiceServer();
        const adapter = testAdapter();
        const local = { url: (endpoint: string) => `ws://${endpoint}/?v=8` };
        const connection = new VoiceConnection({
            guildId: GUILD,
            channelId: CHANNEL,
            adapterCreator: adapter.adapterCreator,
            networking: local,
            dave: false,
        });
        cleanup.push(() => connection.destroy());
        const player = new AudioPlayer();
        cleanup.push(() => player.stop(true));
        connection.subscribe(player);
        player.play(endless());
        expect(player.state).toBe("buffering");
        adapter.methods.onVoiceStateUpdate({
            guild_id: GUILD,
            channel_id: CHANNEL,
            user_id: USER,
            session_id: "s1",
        });
        adapter.methods.onVoiceServerUpdate({
            guild_id: GUILD,
            token: "tok",
            endpoint: first.endpoint,
        });
        await until(() => connection.status === "ready");
        await until(() => first.state.packets.length >= 3);
        expect(player.state).toBe("playing");

        // Moved by a moderator: same session, new channel → a new voice session.
        adapter.methods.onVoiceStateUpdate({
            guild_id: GUILD,
            channel_id: OTHER,
            user_id: USER,
            session_id: "s1",
        });
        expect(connection.channelId).toBe(OTHER);
        await until(
            () =>
                first.state.connections === 2 && connection.status === "ready",
        );

        // Region change: Discord deallocates the server (endpoint null), then names a new one.
        adapter.methods.onVoiceServerUpdate({
            guild_id: GUILD,
            token: "tok2",
            endpoint: null,
        });
        expect(connection.status).toBe("connecting");
        await until(() => player.state === "autopaused");
        expect(player.ticking).toBe(false);
        adapter.methods.onVoiceServerUpdate({
            guild_id: GUILD,
            token: "tok2",
            endpoint: second.endpoint,
        });
        await until(() => connection.status === "ready");
        // The same player resumes on the new server without being re-subscribed.
        await until(() => second.state.packets.length >= 3);
        expect(player.state).toBe("playing");
        expect(second.state.identifies[0]).toMatchObject({ token: "tok2" });
        expect(second.state.decryptFailures).toBe(0);
    });

    test("removed by a moderator (channel null) is a disconnect with reason 'removed'", async () => {
        const server = await voiceServer();
        const adapter = testAdapter();
        const connection = new VoiceConnection({
            guildId: GUILD,
            channelId: CHANNEL,
            adapterCreator: adapter.adapterCreator,
            networking: { url: server.url },
            dave: false,
        });
        cleanup.push(() => connection.destroy());
        adapter.methods.onVoiceStateUpdate({
            guild_id: GUILD,
            channel_id: CHANNEL,
            user_id: USER,
            session_id: "s1",
        });
        adapter.methods.onVoiceServerUpdate({
            guild_id: GUILD,
            token: "tok",
            endpoint: server.endpoint,
        });
        await until(() => connection.status === "ready");
        adapter.methods.onVoiceStateUpdate({
            guild_id: GUILD,
            channel_id: null,
            user_id: USER,
            session_id: "s1",
        });
        expect(connection.status).toBe("disconnected");
        expect(connection.disconnectReason?.reason).toBe("removed");
    });

    test("destroy() leaves, releases the adapter and is final", async () => {
        const adapter = testAdapter();
        const connection = new VoiceConnection({
            guildId: GUILD,
            channelId: CHANNEL,
            adapterCreator: adapter.adapterCreator,
        });
        connection.destroy();
        connection.destroy();
        expect(connection.status).toBe("destroyed");
        expect(adapter.sent.at(-1)!.d.channel_id).toBeNull();
        expect(adapter.destroyed).toBe(1);
        expect(() => connection.rejoin()).toThrow(VoiceError);
        expect(() => connection.subscribe(new AudioPlayer())).toThrow(
            VoiceError,
        );
        expect(connection.disconnect()).toBe(false);
    });

    test("custom audio, getters, a non-resumable close, rejoin rules and the reconnect timeout", async () => {
        const server = await voiceServer();
        const adapter = testAdapter();
        const errors: Error[] = [];
        const connection = new VoiceConnection({
            guildId: GUILD,
            channelId: CHANNEL,
            adapterCreator: adapter.adapterCreator,
            networking: { url: (e: string) => `ws://${e}/?v=8` },
            dave: false,
            timeout: 300,
        });
        cleanup.push(() => connection.destroy());
        connection.on("error", (e) => errors.push(e));
        expect([
            connection.ping,
            connection.voicePrivacyCode,
            connection.endToEndEncrypted,
        ]).toEqual([-1, null, false]);
        expect(connection.playOpusPacket(Uint8Array.of(1))).toBe(false);
        adapter.methods.onVoiceStateUpdate({
            guild_id: GUILD,
            channel_id: CHANNEL,
            user_id: USER,
            session_id: "s1",
        });
        adapter.methods.onVoiceServerUpdate({
            guild_id: GUILD,
            token: "tok",
            endpoint: server.endpoint,
        });
        await until(() => connection.status === "ready");
        expect(connection.subscription).toBeUndefined();
        expect(connection.playOpusPacket(Uint8Array.of(0xfc, 1))).toBe(true);
        connection.setSpeaking(false);
        await until(
            () =>
                server.state.packets.length === 1 &&
                server.state.speaking.length === 2,
        );

        // Mute only: op 4 goes out, the voice session stays.
        expect(connection.rejoin({ selfMute: true })).toBe(true);
        expect(connection.status).toBe("ready");
        expect(adapter.sent.at(-1)!.d.self_mute).toBe(true);
        expect(() => connection.rejoin({ channelId: "" })).toThrow(TypeError);

        // A close Discord does not let us resume (4006) disconnects and reports it.
        server.close(4006, "Session no longer valid");
        await until(() => connection.status === "disconnected");
        expect(connection.disconnectReason).toMatchObject({
            reason: "closed",
            code: 4006,
        });
        expect(errors.some((e) => /4006/.test(e.message))).toBe(true);

        // A new server that never answers: the reconnect times out.
        connection.rejoin();
        adapter.methods.onVoiceStateUpdate({
            guild_id: GUILD,
            channel_id: CHANNEL,
            user_id: USER,
            session_id: "s2",
        });
        adapter.methods.onVoiceServerUpdate({
            guild_id: GUILD,
            token: "tok",
            endpoint: server.endpoint,
        });
        await until(() => connection.status === "ready");
        // Accepts the TCP connection, never answers the WebSocket handshake.
        const silent = Bun.listen({
            hostname: "127.0.0.1",
            port: 0,
            socket: { data: () => undefined },
        });
        cleanup.push(() => silent.stop(true));
        adapter.methods.onVoiceServerUpdate({
            guild_id: GUILD,
            token: "tok",
            endpoint: `127.0.0.1:${silent.port}`,
        });
        expect(connection.status).toBe("connecting");
        await until(() => connection.status === "disconnected", 2000);
        expect(connection.disconnectReason?.reason).toBe("timeout");
    });

    test("constructor validation", () => {
        const { adapterCreator } = testAdapter();
        expect(
            () =>
                new VoiceConnection({
                    guildId: "",
                    channelId: CHANNEL,
                    adapterCreator,
                }),
        ).toThrow(TypeError);
        expect(
            () =>
                new VoiceConnection({
                    guildId: GUILD,
                    channelId: " ",
                    adapterCreator,
                }),
        ).toThrow(TypeError);
        expect(
            () =>
                new VoiceConnection({
                    guildId: GUILD,
                    channelId: CHANNEL,
                    adapterCreator: undefined as never,
                }),
        ).toThrow(TypeError);
    });
});
