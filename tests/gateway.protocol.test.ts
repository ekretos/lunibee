import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    Gateway,
    GatewayOpcodes,
    classifyFrame,
    classifyPayload,
    identifyPayload,
    resumePayload,
    heartbeatPayload,
} from "../packages/ws/src/index.ts";

/**
 * Stage 1B.5 acceptance: the protocol answers "what does this payload mean?"
 * and performs nothing. Every case here runs without a socket, a session,
 * timers or a Gateway.
 */
const frame = (payload: unknown): string => JSON.stringify(payload);

describe("opcode classification", () => {
    test("op 10 HELLO carries the heartbeat interval", () => {
        expect(
            classifyFrame(frame({ op: 10, d: { heartbeat_interval: 41250 } })),
        ).toEqual({
            sequence: null,
            action: { type: "hello", heartbeatInterval: 41250 },
        });
    });

    test("op 0 DISPATCH carries event, data and sequence", () => {
        expect(
            classifyFrame(
                frame({ op: 0, t: "MESSAGE_CREATE", s: 7, d: { id: "1" } }),
            ),
        ).toEqual({
            sequence: 7,
            action: {
                type: "dispatch",
                event: "MESSAGE_CREATE",
                data: { id: "1" },
            },
        });
    });

    test("op 1 HEARTBEAT asks for a beat; op 11 acknowledges one", () => {
        expect(classifyFrame(frame({ op: 1, d: null })).action).toEqual({
            type: "heartbeat",
        });
        expect(classifyFrame(frame({ op: 11, d: null })).action).toEqual({
            type: "heartbeat-ack",
            data: null,
        });
    });

    test("op 7 RECONNECT is a reconnect request", () => {
        expect(classifyFrame(frame({ op: 7, d: null })).action).toEqual({
            type: "reconnect",
        });
    });

    test("op 9 resumable reports resumable, without touching a session", () => {
        expect(classifyFrame(frame({ op: 9, d: true })).action).toEqual({
            type: "invalid-session",
            resumable: true,
        });
    });

    test("op 9 non-resumable reports non-resumable", () => {
        expect(classifyFrame(frame({ op: 9, d: false })).action).toEqual({
            type: "invalid-session",
            resumable: false,
        });
    });

    test("op 9 with anything but true is treated as non-resumable", () => {
        // The safe reading: a wrongly attempted RESUME costs a round trip,
        // while a wrongly skipped IDENTIFY strands the shard.
        for (const d of [undefined, null, 0, 1, "true", {}, []])
            expect(classifyFrame(frame({ op: 9, d })).action).toEqual({
                type: "invalid-session",
                resumable: false,
            });
    });

    test("a sequence is reported for any payload that carries one", () => {
        // Discord attaches `s` to dispatches, but the protocol reports it
        // wherever it appears rather than assuming.
        expect(classifyFrame(frame({ op: 11, s: 12, d: null })).sequence).toBe(
            12,
        );
        expect(classifyFrame(frame({ op: 11, d: null })).sequence).toBeNull();
        // Sequence 0 is a real sequence, not an absent one.
        expect(
            classifyFrame(frame({ op: 0, t: "READY", s: 0, d: {} })).sequence,
        ).toBe(0);
    });
});

describe("opcodes Lunibee sends but never receives", () => {
    test("client opcodes classify as unknown rather than failing", () => {
        // 2 IDENTIFY, 3 PRESENCE_UPDATE, 4 VOICE_STATE_UPDATE, 6 RESUME,
        // 8 REQUEST_GUILD_MEMBERS: outbound only. Receiving one is not an
        // error, it is simply nothing this client acts on.
        for (const op of [
            GatewayOpcodes.Identify,
            GatewayOpcodes.PresenceUpdate,
            GatewayOpcodes.VoiceStateUpdate,
            GatewayOpcodes.Resume,
            GatewayOpcodes.RequestGuildMembers,
        ])
            expect(classifyFrame(frame({ op, d: null })).action).toEqual({
                type: "unknown",
                opcode: op,
            });
    });

    test("an opcode this version has never heard of is ignored, not rejected", () => {
        // Forward compatibility: Discord adds opcodes (12, 13, 14 …) and a
        // client that errors on an unfamiliar one breaks on every addition.
        for (const op of [5, 12, 13, 14, 31, 99])
            expect(classifyFrame(frame({ op, d: {} })).action).toEqual({
                type: "unknown",
                opcode: op,
            });
    });
});

describe("malformed payloads fail deterministically", () => {
    test("invalid JSON is reported, never swallowed", () => {
        const result = classifyFrame("{not json");
        expect(result.sequence).toBeNull();
        expect(result.action).toMatchObject({
            type: "invalid",
            violation: "invalid-json",
        });
        expect((result.action as { cause?: unknown }).cause).toBeInstanceOf(
            SyntaxError,
        );
    });

    test("a payload that is not an object is invalid", () => {
        for (const raw of ["null", '"a string"', "42", "[]", "true"])
            expect(classifyFrame(raw).action).toMatchObject({
                type: "invalid",
                violation: "invalid-payload",
            });
    });

    test("a missing or non-numeric opcode is invalid", () => {
        expect(classifyPayload({ d: {} }).action).toMatchObject({
            violation: "invalid-payload",
        });
        expect(classifyPayload({ op: "0", d: {} }).action).toMatchObject({
            violation: "invalid-payload",
        });
        expect(classifyPayload({ op: null }).action).toMatchObject({
            violation: "invalid-payload",
        });
        expect(classifyPayload(undefined).action).toMatchObject({
            violation: "invalid-payload",
        });
    });

    test("HELLO without a usable interval is invalid", () => {
        for (const d of [
            undefined,
            null,
            {},
            { heartbeat_interval: "45000" },
            { heartbeat_interval: 0 },
            { heartbeat_interval: -1 },
            { heartbeat_interval: Number.NaN },
            { heartbeat_interval: Number.POSITIVE_INFINITY },
        ])
            expect(classifyFrame(frame({ op: 10, d })).action).toMatchObject({
                type: "invalid",
                violation: "invalid-hello",
            });
    });

    test("a DISPATCH without an event name still classifies, with a null event", () => {
        // Missing `t` is odd but not malformed: the caller decides what an
        // unnamed dispatch means.
        expect(
            classifyFrame(frame({ op: 0, s: 3, d: { a: 1 } })).action,
        ).toEqual({ type: "dispatch", event: null, data: { a: 1 } });
        expect(classifyFrame(frame({ op: 0, t: 7, d: null })).action).toEqual({
            type: "dispatch",
            event: null,
            data: null,
        });
    });

    test("missing data is not itself a failure", () => {
        expect(classifyFrame(frame({ op: 11 })).action).toEqual({
            type: "heartbeat-ack",
            data: undefined,
        });
        expect(classifyFrame(frame({ op: 7 })).action).toEqual({
            type: "reconnect",
        });
    });
});

describe("outbound payload construction", () => {
    test("IDENTIFY carries a numeric intent bitfield and the shard tuple", () => {
        const payload = identifyPayload({
            token: "token",
            intents: 513,
            shardId: 2,
            shardCount: 4,
        });
        expect(payload.op).toBe(GatewayOpcodes.Identify);
        const data = payload.d as Record<string, any>;
        expect(data.token).toBe("token");
        expect(typeof data.intents).toBe("number");
        expect(data.shard).toEqual([2, 4]);
        expect(data.properties.os).toBe("Android");
        // Both spellings, so the payload works against either expectation.
        expect(data.properties.$os).toBe("Android");
        expect(data.presence).toEqual({
            since: null,
            activities: [],
            status: "online",
            afk: false,
        });
    });

    test("IDENTIFY honours supplied properties and presence", () => {
        const payload = identifyPayload({
            token: "t",
            intents: 1,
            shardId: 0,
            shardCount: 1,
            properties: { os: "linux", browser: "lunibee", device: "server" },
            presence: { status: "dnd", activities: [], afk: true, since: 10 },
        });
        const data = payload.d as Record<string, any>;
        expect(data.properties).toMatchObject({
            os: "linux",
            browser: "lunibee",
            $browser: "lunibee",
        });
        expect(data.presence).toEqual({
            since: 10,
            activities: [],
            status: "dnd",
            afk: true,
        });
    });

    test("RESUME carries the session's resume material verbatim", () => {
        const payload = resumePayload("token", {
            sessionId: "abc",
            sequence: 0,
            resumeURL: "wss://resume.test",
        });
        expect(payload.op).toBe(GatewayOpcodes.Resume);
        // Sequence 0 must survive into the payload.
        expect(payload.d).toEqual({
            token: "token",
            session_id: "abc",
            seq: 0,
        });
    });

    test("HEARTBEAT carries the last sequence, including null and zero", () => {
        expect(heartbeatPayload(null).d).toBeNull();
        expect(heartbeatPayload(0).d).toBe(0);
        expect(heartbeatPayload(42)).toEqual({
            op: GatewayOpcodes.Heartbeat,
            d: 42,
            s: null,
            t: null,
        });
    });
});

class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    readonly url: string;
    readyState = 0;
    sent: string[] = [];
    closeCalls: Array<{ code: number; reason: string }> = [];
    #listeners = new Map<string, Set<(event: any) => void>>();

    constructor(url: string) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }
    addEventListener(event: string, listener: (event: any) => void): void {
        let listeners = this.#listeners.get(event);
        if (!listeners) this.#listeners.set(event, (listeners = new Set()));
        listeners.add(listener);
    }
    send(data: string): void {
        if (this.readyState !== 1) throw new Error("socket is not open");
        this.sent.push(data);
    }
    close(code = 1000, reason = ""): void {
        this.closeCalls.push({ code, reason });
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.emit("close", { code, reason });
    }
    open(): void {
        this.readyState = 1;
        this.emit("open", {});
    }
    receive(payload: unknown): void {
        this.emit("message", { data: JSON.stringify(payload) });
    }
    emit(event: string, value: unknown): void {
        for (const listener of this.#listeners.get(event) ?? [])
            listener(value);
    }
    payloads(): Array<{ op: number; d?: any }> {
        return this.sent.map((raw) => JSON.parse(raw));
    }
}

describe("Gateway applies protocol actions", () => {
    const OriginalWebSocket = globalThis.WebSocket;
    beforeEach(() => {
        FakeWebSocket.instances = [];
        globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    });
    afterEach(() => {
        globalThis.WebSocket = OriginalWebSocket;
    });

    async function connect(
        options: Record<string, unknown> = {},
    ): Promise<{ gateway: Gateway; socket: FakeWebSocket }> {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
            ...options,
        } as any);
        const connecting = gateway.connect("wss://main.test");
        const socket = FakeWebSocket.instances[0]!;
        socket.open();
        await connecting;
        return { gateway, socket };
    }

    test("an intent resolvable is identified as a numeric bitfield", async () => {
        // Regression: the array form the documentation recommends used to be
        // sent verbatim, and Discord answers a non-numeric intents field with
        // 4013 — a fatal close, so such a bot never connected.
        const { gateway, socket } = await connect({
            intents: ["Guilds", "GuildMessages"],
        });
        socket.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });
        const identify = socket
            .payloads()
            .find((p) => p.op === GatewayOpcodes.Identify);
        expect(typeof identify!.d.intents).toBe("number");
        expect(identify!.d.intents).toBe(513);
        gateway.close();
    });

    test("an unknown opcode is ignored without closing the connection", async () => {
        const { gateway, socket } = await connect();
        const errors: unknown[] = [];
        gateway.on("error", (error) => errors.push(error));
        socket.receive({ op: 77, d: { anything: true } });
        expect(errors).toEqual([]);
        expect(socket.closeCalls).toEqual([]);
        gateway.close();
    });

    test("a malformed frame reports an error and closes with 1002", async () => {
        const { gateway, socket } = await connect();
        const errors: Error[] = [];
        gateway.on("error", (error) => errors.push(error as Error));
        socket.emit("message", { data: "{not json" });
        expect(errors[0]!.message).toContain("invalid JSON");
        expect(socket.closeCalls[0]).toEqual({
            code: 1002,
            reason: "Invalid JSON",
        });
        gateway.close();
    });

    test("an invalid HELLO closes with the interval reason", async () => {
        const { gateway, socket } = await connect();
        const errors: Error[] = [];
        gateway.on("error", (error) => errors.push(error as Error));
        socket.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: "soon" },
        });
        expect(errors[0]!.message).toContain("invalid heartbeat interval");
        expect(socket.closeCalls[0]).toEqual({
            code: 1002,
            reason: "Invalid heartbeat interval",
        });
        gateway.close();
    });

    test("op 9 is classified by the protocol and applied by the Gateway", async () => {
        const { gateway, socket } = await connect();
        const seen: unknown[] = [];
        gateway.on("invalidSession", (resumable) => seen.push(resumable));
        socket.receive({ op: GatewayOpcodes.InvalidSession, d: true });
        expect(seen).toEqual([true]);
        // Resumable: closed with a code that keeps the session recoverable.
        expect(socket.closeCalls[0]!.reason).toBe(
            "Invalid session (resumable)",
        );
        gateway.close();
    });
});
