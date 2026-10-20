/**
 * Regression tests for the v0.4 voice audit: resume backoff, rejoining the
 * same channel, DAVE never sending plaintext, encrypt failures, stale
 * discovery errors, server moves, FFmpeg failures, codec lifecycle and
 * bounded recording gaps.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
    AudioPlayer,
    DaveSession,
    SILENCE_FRAME,
    VoiceConnection,
    VoiceManager,
    VoiceNetworking,
    VoiceReceiver,
    VoiceUdp,
    createAudioResource,
    loadDave,
    type OpusCodec,
    type VoiceAdapterMethods,
    type VoiceSocketLike,
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

async function voiceServer(
    options?: Parameters<typeof startFakeVoiceServer>[0],
) {
    const server = await startFakeVoiceServer(options);
    cleanup.push(() => server.stop());
    return server;
}

/** A socket that fails to connect, like ECONNREFUSED: it closes with 1006 right away. */
function refusedSocket(): VoiceSocketLike {
    const listeners: Record<string, ((event: never) => void)[]> = {};
    const socket = {
        binaryType: "",
        readyState: 0,
        send() {},
        close() {},
        addEventListener: (type: string, listener: (event: never) => void) =>
            void (listeners[type] ??= []).push(listener),
    };
    setTimeout(() => {
        socket.readyState = 3;
        for (const listener of listeners.close ?? [])
            listener({ code: 1006, reason: "" } as never);
    }, 0);
    return socket;
}

/** A connection driven by hand, connected to `server`. */
async function connect(
    server: Awaited<ReturnType<typeof voiceServer>>,
    options: {
        timeout?: number;
        socketFactory?: (url: string) => VoiceSocketLike;
        resume?: { attempts?: number; delay?: number; maxDelay?: number };
    } = {},
) {
    let methods!: VoiceAdapterMethods;
    const connection = new VoiceConnection({
        guildId: GUILD,
        channelId: CHANNEL,
        dave: false,
        timeout: options.timeout,
        adapterCreator: (m) => {
            methods = m;
            return { sendPayload: () => true, destroy() {} };
        },
        networking: {
            url: server.url,
            socketFactory: options.socketFactory,
            resume: options.resume,
        },
    });
    cleanup.push(() => connection.destroy(false));
    methods.onVoiceStateUpdate({
        guild_id: GUILD,
        channel_id: CHANNEL,
        user_id: USER,
        session_id: "s",
    });
    methods.onVoiceServerUpdate({
        guild_id: GUILD,
        token: "t",
        endpoint: server.endpoint,
    });
    await until(() => connection.status === "ready");
    return { connection, methods };
}

describe("resume backoff (finding 1)", () => {
    test("an unreachable voice server is retried a bounded number of times with growing delays, then closed", async () => {
        const server = await voiceServer();
        let down = false;
        const opens: number[] = [];
        const { connection } = await connect(server, {
            resume: { attempts: 4, delay: 10, maxDelay: 1000 },
            socketFactory: (url) => {
                opens.push(performance.now());
                return down
                    ? refusedSocket()
                    : (new WebSocket(url) as unknown as VoiceSocketLike);
            },
        });
        const errors: string[] = [];
        connection.on("error", (error) => errors.push(error.message));
        down = true;
        const before = opens.length;
        server.close(1001, "going away");
        await until(() => connection.status === "disconnected");
        await Bun.sleep(100);
        const retries = opens.slice(before);
        expect(retries.length).toBe(4);
        expect(connection.disconnectReason).toMatchObject({
            reason: "closed",
            code: 1006,
        });
        expect(connection.disconnectReason?.message).toContain(
            "Could not resume the voice session after 4 attempts.",
        );
        expect(errors.some((m) => m.includes("Could not resume"))).toBe(true);
        // Delays double (with jitter between 50% and 100% of each step).
        const gaps = retries.slice(1).map((t, i) => t - retries[i]!);
        expect(gaps[2]!).toBeGreaterThan(gaps[0]!);
    });

    test("real sockets: a voice server that dies causes a bounded number of opens", async () => {
        const server = await startFakeVoiceServer();
        let opens = 0;
        const { connection } = await connect(server, {
            resume: { attempts: 3, delay: 10, maxDelay: 50 },
            socketFactory: (url) => {
                opens++;
                return new WebSocket(url) as unknown as VoiceSocketLike;
            },
        });
        const before = opens;
        server.stop();
        await until(() => connection.status === "disconnected");
        await Bun.sleep(150);
        expect(opens - before).toBe(3);
        expect(connection.disconnectReason?.reason).toBe("closed");
    });

    test("a successful resume resets the attempt count", async () => {
        const server = await voiceServer();
        const { connection } = await connect(server, {
            resume: { attempts: 1, delay: 5, maxDelay: 5 },
        });
        for (let i = 0; i < 3; i++) {
            server.close(1001, "going away");
            await until(() => server.state.resumes.length === i + 1);
            await until(() => connection.status === "ready");
        }
        expect(connection.status).toBe("ready");
    });

    test("the connection's reconnect timeout covers resuming", async () => {
        const server = await voiceServer();
        const { connection } = await connect(server, {
            timeout: 150,
            resume: { attempts: 5, delay: 60_000 },
            socketFactory: (url) =>
                new WebSocket(url) as unknown as VoiceSocketLike,
        });
        server.close(1001, "going away");
        await until(() => connection.status === "connecting");
        await until(() => connection.status === "disconnected", 1000);
        expect(connection.disconnectReason?.reason).toBe("timeout");
    });
});

describe("rejoining the same channel (finding 2)", () => {
    test("client.voice.join() again for the current channel keeps the connection ready", async () => {
        const server = await voiceServer();
        let first = true;
        const manager: VoiceManager = new VoiceManager(
            {
                userId: USER,
                sendVoiceState: (guildId, channelId) => {
                    // Like Discord: our own voice state comes back for every op 4.
                    queueMicrotask(() => {
                        manager.handleVoiceState({
                            guild_id: guildId,
                            channel_id: channelId,
                            user_id: USER,
                            session_id: "s",
                        });
                        if (first) {
                            first = false;
                            manager.handleVoiceServer({
                                guild_id: GUILD,
                                token: "t",
                                endpoint: server.endpoint,
                            });
                        }
                    });
                    return true;
                },
            },
            { dave: false, networking: { url: server.url } },
        );
        cleanup.push(() => manager.destroy(false));
        const connection = await manager.join({
            guildId: GUILD,
            channelId: CHANNEL,
            timeout: 1000,
        });
        const states: string[] = [];
        connection.on("stateChange", (next) => states.push(next));
        const again = await manager.join({
            guildId: GUILD,
            channelId: CHANNEL,
            selfDeaf: true,
            timeout: 1000,
        });
        expect(again).toBe(connection);
        expect(connection.status).toBe("ready");
        expect(states).toEqual([]);
        expect(server.state.connections).toBe(1);
    });

    test("an echo of the live session's channel while signalling restores ready", async () => {
        const server = await voiceServer();
        const { connection, methods } = await connect(server);
        connection.rejoin({ channelId: OTHER });
        expect(connection.status).toBe("signalling");
        connection.rejoin({ channelId: CHANNEL });
        methods.onVoiceStateUpdate({
            guild_id: GUILD,
            channel_id: CHANNEL,
            user_id: USER,
            session_id: "s",
        });
        expect(connection.status).toBe("ready");
        expect(server.state.connections).toBe(1);
    });
});

/** A DAVE module whose session readiness and encryption the test controls. */
function controlledDave(options: { ready?: boolean; fail?: boolean } = {}) {
    const state = {
        ready: options.ready ?? false,
        fail: options.fail ?? false,
    };
    class DAVESession {
        get ready() {
            return state.ready;
        }
        voicePrivacyCode = "";
        reinit() {}
        reset() {}
        setExternalSender() {}
        getSerializedKeyPackage() {
            return Buffer.from([1]);
        }
        processProposals() {
            return {};
        }
        processWelcome() {}
        processCommit() {}
        canPassthrough() {
            return false;
        }
        setPassthroughMode() {}
        encryptOpus(packet: Buffer): Buffer {
            if (state.fail) throw new Error("Failed to encrypt: NotReady");
            return Buffer.concat([Buffer.from([0xee]), packet]);
        }
        decrypt(_user: string, _media: number, packet: Buffer) {
            return packet;
        }
    }
    return { state, module: { DAVE_PROTOCOL_VERSION: 1, DAVESession } };
}

async function daveNetworking(module: unknown) {
    const server = await voiceServer({ daveVersion: 1 });
    const errors: string[] = [];
    const networking = new VoiceNetworking(
        {
            guildId: "1",
            channelId: CHANNEL,
            userId: USER,
            sessionId: "s",
            token: "t",
            endpoint: server.endpoint,
        },
        { error: (error) => errors.push(error.message) },
        { url: server.url, daveModule: module as never },
    );
    cleanup.push(() => networking.destroy());
    await until(() => networking.state === "ready");
    return { server, networking, errors };
}

describe("DAVE never sends plaintext (findings 3 and 4)", () => {
    test("with real @snazzah/davey before the MLS group is ready: Opus frames are dropped, silence still goes", async () => {
        const module = await loadDave();
        const { server, networking } = await daveNetworking(module);
        expect(networking.dave?.protocolVersion).toBe(1);
        expect(networking.dave?.active).toBe(false);
        expect(networking.sendFrame(Uint8Array.of(0xfc, 0x11, 0x22))).toBe(
            false,
        );
        expect(networking.sendFrame(SILENCE_FRAME)).toBe(true);
        await until(() => server.state.packets.length === 1);
        await Bun.sleep(30);
        expect(server.state.packets.length).toBe(1);
        expect([...server.state.packets[0]!.payload]).toEqual([
            ...SILENCE_FRAME,
        ]);
    });

    test("DaveSession.encrypt: dropped while required and not ready, passthrough at v0 and during an upgrade", () => {
        const dave = controlledDave();
        const hooks = {
            keyPackage: () => undefined,
            invalidTransition: () => undefined,
        };
        const required = new DaveSession(
            dave.module as never,
            1,
            USER,
            CHANNEL,
            hooks,
        );
        required.reinit();
        expect(required.encrypt(Uint8Array.of(1))).toBeNull();
        dave.state.ready = true;
        expect([...required.encrypt(Uint8Array.of(1))!]).toEqual([0xee, 1]);
        // An invalid commit re-initializes: not ready again, so dropped again.
        dave.state.ready = false;
        expect(required.encrypt(Uint8Array.of(1))).toBeNull();

        // Upgrade from transport-only: unencrypted until the transition executes.
        const upgrade = new DaveSession(
            dave.module as never,
            0,
            USER,
            CHANNEL,
            hooks,
        );
        expect([...upgrade.encrypt(Uint8Array.of(2))!]).toEqual([2]);
        upgrade.prepareEpoch(1, 1);
        expect([...upgrade.encrypt(Uint8Array.of(2))!]).toEqual([2]);
        expect(upgrade.prepareTransition(9, 1)).toBe(true);
        expect(upgrade.executeTransition(9)).toBe(true);
        expect(upgrade.encrypt(Uint8Array.of(2))).toBeNull();
        dave.state.ready = true;
        expect([...upgrade.encrypt(Uint8Array.of(2))!]).toEqual([0xee, 2]);
        // Downgrade to v0: passthrough.
        upgrade.prepareTransition(10, 0);
        upgrade.executeTransition(10);
        dave.state.ready = false;
        expect([...upgrade.encrypt(Uint8Array.of(3))!]).toEqual([3]);
        required.destroy();
        upgrade.destroy();
    });

    test("an encrypt failure is reported once per failure streak and the frame is not sent", async () => {
        const dave = controlledDave({ ready: true, fail: true });
        const { server, networking, errors } = await daveNetworking(
            dave.module,
        );
        expect(networking.sendFrame(Uint8Array.of(0xfc, 1))).toBe(false);
        expect(networking.sendFrame(Uint8Array.of(0xfc, 2))).toBe(false);
        expect(errors).toEqual([
            "DAVE could not encrypt a frame; frames are dropped until it can: Failed to encrypt: NotReady",
        ]);
        dave.state.fail = false;
        expect(networking.sendFrame(Uint8Array.of(0xfc, 3))).toBe(true);
        dave.state.fail = true;
        networking.sendFrame(Uint8Array.of(0xfc, 4));
        expect(errors.length).toBe(2);
        await until(() => server.state.packets.length === 1);
        expect([...server.state.packets[0]!.payload]).toEqual([0xee, 0xfc, 3]);
    });
});

describe("no late errors from a dead session (finding 5)", () => {
    test("VoiceUdp.close() ends a pending discovery at once", async () => {
        const udp = await VoiceUdp.open("127.0.0.1", 9, async () => ({
            send: () => true,
            close() {},
        }));
        const started = performance.now();
        const pending = udp.discover(1, 10_000);
        udp.close();
        await expect(pending).rejects.toThrow(
            "The voice UDP socket is closed.",
        );
        expect(performance.now() - started).toBeLessThan(100);
    });

    test("destroy() during IP discovery reports nothing afterwards", async () => {
        const server = await voiceServer({ discovery: false });
        const events: string[] = [];
        const networking = new VoiceNetworking(
            {
                guildId: GUILD,
                channelId: CHANNEL,
                userId: USER,
                sessionId: "s",
                token: "t",
                endpoint: server.endpoint,
            },
            {
                close: (code) => events.push(`close ${code}`),
                error: (error) => events.push(`error ${error.message}`),
            },
            { url: server.url, dave: false },
        );
        await until(() => networking.state === "discovering");
        networking.destroy();
        await Bun.sleep(50);
        expect(events).toEqual([]);
    });

    test("disconnect() during IP discovery: the connection emits no error", async () => {
        const server = await voiceServer({ discovery: false });
        let methods!: VoiceAdapterMethods;
        const connection = new VoiceConnection({
            guildId: GUILD,
            channelId: CHANNEL,
            dave: false,
            adapterCreator: (m) => {
                methods = m;
                return { sendPayload: () => true, destroy() {} };
            },
            networking: { url: server.url },
        });
        cleanup.push(() => connection.destroy(false));
        const errors: string[] = [];
        connection.on("error", (error) => errors.push(error.message));
        methods.onVoiceStateUpdate({
            guild_id: GUILD,
            channel_id: CHANNEL,
            user_id: USER,
            session_id: "s",
        });
        methods.onVoiceServerUpdate({
            guild_id: GUILD,
            token: "t",
            endpoint: server.endpoint,
        });
        await until(() => server.state.identifies.length === 1);
        await Bun.sleep(50);
        connection.disconnect();
        await Bun.sleep(50);
        expect(errors).toEqual([]);
        expect(connection.status).toBe("disconnected");
    });
});

describe("server move without a new server (finding 6)", () => {
    test("endpoint: null with no follow-up update times out", async () => {
        const server = await voiceServer();
        const { connection, methods } = await connect(server, { timeout: 100 });
        methods.onVoiceServerUpdate({
            guild_id: GUILD,
            token: "t",
            endpoint: null,
        });
        expect(connection.status).toBe("connecting");
        await until(() => connection.status === "disconnected", 1000);
        expect(connection.disconnectReason?.reason).toBe("timeout");
    });
});

/** Plays `resource` on a player without subscribers and resolves with how it ended. */
function outcome(resource: ReturnType<typeof createAudioResource>) {
    const player = new AudioPlayer({ noSubscriber: "play" });
    return new Promise<string>((resolve) => {
        player.on("finish", () => resolve("finish"));
        player.on("error", (error) => resolve(`error: ${error.message}`));
        player.play(resource);
    });
}

describe("FFmpeg failures (finding 7)", () => {
    test("FFmpeg exiting with an error is the resource's error, not a finish", async () => {
        const result = await outcome(
            createAudioResource(Uint8Array.of(1, 2, 3), {
                inputType: "arbitrary",
                ffmpegPath: "false",
            }),
        );
        expect(result).toBe("error: FFmpeg exited with code 1.");
    });

    test.skipIf(!Bun.which("ffmpeg"))(
        "a missing input file reports FFmpeg's error output",
        async () => {
            const result = await outcome(
                createAudioResource("/nonexistent/song.mp3", {
                    inputType: "arbitrary",
                }),
            );
            expect(result).toStartWith("error: FFmpeg exited with code");
        },
    );

    test.skipIf(!Bun.which("ffmpeg"))(
        "destroying a resource that kills FFmpeg is not an error",
        async () => {
            const resource = createAudioResource(
                new ReadableStream<Uint8Array>({ start() {} }),
                { inputType: "arbitrary" },
            );
            await Bun.sleep(50);
            resource.destroy();
            await Bun.sleep(100);
            expect(resource.error).toBeUndefined();
        },
    );
});

describe("codec lifecycle (finding 8)", () => {
    function codecs() {
        const log = { created: 0, destroyed: 0, encodeAfterDestroy: 0 };
        const factory = async (): Promise<OpusCodec> => {
            await Bun.sleep(20); // the library loads
            log.created++;
            let dead = false;
            return {
                library: "fake",
                encode: () => {
                    if (dead) log.encodeAfterDestroy++;
                    return Uint8Array.of(0xfc, 1);
                },
                decode: () => new Uint8Array(3840),
                destroy: () => {
                    dead = true;
                    log.destroyed++;
                },
            };
        };
        return { log, factory };
    }

    test("destroyed while the codec loads: the codec is freed", async () => {
        const { log, factory } = codecs();
        const resource = createAudioResource(new Uint8Array(3840 * 4), {
            inputType: "raw",
            codecFactory: factory,
        });
        resource.destroy();
        await Bun.sleep(60);
        expect(log.created).toBe(1);
        expect(log.destroyed).toBe(1);
    });

    test("a chunk in flight at destroy() is not encoded with the freed codec", async () => {
        const { log, factory } = codecs();
        let push!: (chunk: Uint8Array) => void;
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(3840));
                push = (chunk) => controller.enqueue(chunk);
            },
        });
        const resource = createAudioResource(source, {
            inputType: "raw",
            prefetch: 2,
            codecFactory: factory,
        });
        await until(() => resource.readable);
        resource.destroy();
        push(new Uint8Array(3840));
        await Bun.sleep(50);
        expect(log).toEqual({
            created: 1,
            destroyed: 1,
            encodeAfterDestroy: 0,
        });
    });
});

describe("recording gaps (finding 9)", () => {
    test("a long silence gap is bounded by highWaterMark", async () => {
        const receiver = new VoiceReceiver();
        const realNow = performance.now.bind(performance);
        let offset = 0;
        performance.now = () => realNow() + offset;
        try {
            const stream = receiver.record("u", { highWaterMark: 64 * 1024 });
            receiver.push("u", Uint8Array.of(0xfc, 1));
            offset = 3_600_000; // silent for an hour
            receiver.push("u", Uint8Array.of(0xfc, 2));
            receiver.close();
            let bytes = 0;
            for await (const chunk of stream) bytes += chunk.length;
            // At most the high-water mark plus one page of 50 frames.
            expect(bytes).toBeLessThan(64 * 1024 + 4096);
            expect(bytes).toBeGreaterThan(32 * 1024);
        } finally {
            performance.now = realNow;
        }
    });
});
