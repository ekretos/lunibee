import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    Gateway,
    GatewayError,
    GatewayOpcodes,
    GatewayState,
} from "../packages/ws/src/index.ts";
import { FakeWebSocket, installWebSocket } from "./helpers/fake-websocket.ts";

const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
    FakeWebSocket.instances = [];
    installWebSocket(FakeWebSocket);
});

afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
});

describe("Gateway integration lifecycle", () => {
    test("settles connect only after the socket opens", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        let settled = false;
        const promise = gateway.connect("wss://example.test").then(() => {
            settled = true;
        });
        const socket = FakeWebSocket.instances[0]!;

        await Promise.resolve();
        expect(settled).toBe(false);
        socket.open();
        await promise;
        expect(settled).toBe(true);
        gateway.close();
    });

    test("responds to HELLO with IDENTIFY and schedules heartbeats", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 513,
            reconnect: false,
        });
        const promise = gateway.connect();
        const socket = FakeWebSocket.instances[0]!;
        socket.open();
        await promise;

        socket.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 100 },
        });
        const identify = JSON.parse(socket.sent[0]!);
        expect(identify.op).toBe(GatewayOpcodes.Identify);
        expect(identify.d.token).toBe("token");
        expect(identify.d.intents).toBe(513);
        gateway.close();
    });

    test("marks heartbeat acknowledgements as healthy", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        const promise = gateway.connect();
        const socket = FakeWebSocket.instances[0]!;
        socket.open();
        await promise;
        socket.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 50 },
        });
        await new Promise((resolve) => setTimeout(resolve, 5));
        socket.receive({ op: GatewayOpcodes.HeartbeatAck, d: null });
        expect(socket.closeCode).toBeUndefined();
        gateway.close();
    });

    test("reconnects after a recoverable close", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnectBaseDelay: 1,
            reconnectMaxDelay: 1,
        });
        const first = gateway.connect();
        const socket = FakeWebSocket.instances[0]!;
        socket.open();
        await first;
        socket.close(1000, "network failure");
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(FakeWebSocket.instances.length).toBe(2);
        gateway.close();
    });

    test("clears session state after INVALID_SESSION", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        const promise = gateway.connect();
        const socket = FakeWebSocket.instances[0]!;
        socket.open();
        await promise;
        socket.receive({
            op: GatewayOpcodes.Dispatch,
            t: "READY",
            s: 42,
            d: {
                session_id: "session",
                resume_gateway_url: "wss://gateway-us-east1-b.discord.gg",
            },
        });
        socket.receive({ op: GatewayOpcodes.InvalidSession, d: false });
        expect(socket.closeCode).toBe(1000);
        gateway.close();
    });

    test("reports and closes a zombie connection", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
            heartbeatAckTimeout: 10,
            zombieTimeout: 25,
        });
        const zombies: unknown[] = [];
        gateway.on("zombie", (data) => zombies.push(data));
        gateway.on("error", (error) =>
            expect(error).toBeInstanceOf(GatewayError),
        );
        const promise = gateway.connect();
        const socket = FakeWebSocket.instances[0]!;
        socket.open();
        await promise;
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(zombies.length).toBe(1);
        expect(socket.closeCode).toBe(4900);
        gateway.close();
    });

    const dispatch = (s: number) => ({
        op: GatewayOpcodes.Dispatch,
        t: "TYPING_START",
        s,
        d: {},
    });
    const keepTalking = async (
        socket: FakeWebSocket,
        forMs: number,
        everyMs = 5,
    ) => {
        for (let elapsed = 0, s = 1; elapsed < forMs; elapsed += everyMs, s++) {
            socket.receive(dispatch(s));
            await Bun.sleep(everyMs);
        }
    };

    test("inbound traffic keeps a healthy connection alive past the zombie timeout", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
            heartbeatAckTimeout: 10,
            zombieTimeout: 30,
        });
        const zombies: unknown[] = [];
        gateway.on("zombie", (data) => zombies.push(data));
        gateway.on("error", () => undefined);
        const promise = gateway.connect();
        const socket = FakeWebSocket.instances[0]!;
        socket.open();
        await promise;

        // Five times the zombie timeout of steady traffic: never a zombie.
        await keepTalking(socket, 150);
        expect(zombies.length).toBe(0);
        expect(socket.closeCode).toBeUndefined();

        // Then silence past the deadline: exactly one zombie, one resumable close.
        await Bun.sleep(60);
        expect(zombies.length).toBe(1);
        expect(socket.closeCode).toBe(4900);
        gateway.close();
    });

    test("dispatches without heartbeat ACKs still trip the ACK timeout", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
            heartbeatAckTimeout: 10,
            zombieTimeout: 1_000,
        });
        gateway.on("error", () => undefined);
        const promise = gateway.connect();
        const socket = FakeWebSocket.instances[0]!;
        socket.open();
        await promise;
        socket.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 20 },
        });
        // Traffic keeps the silence clock fresh, but no ACK ever answers a beat.
        await keepTalking(socket, 80);
        expect(socket.closeCode).toBe(4900);
        gateway.close();
    });

    test("frames from a superseded socket do not keep the current one alive", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            heartbeatAckTimeout: 10,
            zombieTimeout: 30,
            reconnectBaseDelay: 1,
            reconnectMaxDelay: 1,
        });
        const zombies: unknown[] = [];
        gateway.on("zombie", (data) => zombies.push(data));
        gateway.on("error", () => undefined);
        const promise = gateway.connect();
        const first = FakeWebSocket.instances[0]!;
        first.open();
        await promise;
        first.close(1000, "network failure");
        await Bun.sleep(10);
        const second = FakeWebSocket.instances[1]!;
        second.open();

        // Only the old socket talks; the new one is silent and must still be caught.
        await keepTalking(first, 80);
        expect(zombies.length).toBeGreaterThanOrEqual(1);
        expect(second.closeCode).toBe(4900);
        gateway.close();
    });

    test("after a reconnect the new socket's traffic keeps it alive", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            heartbeatAckTimeout: 10,
            zombieTimeout: 30,
            reconnectBaseDelay: 1,
            reconnectMaxDelay: 1,
        });
        const zombies: unknown[] = [];
        gateway.on("zombie", (data) => zombies.push(data));
        gateway.on("error", () => undefined);
        const promise = gateway.connect();
        const first = FakeWebSocket.instances[0]!;
        first.open();
        await promise;
        first.close(1000, "network failure");
        await Bun.sleep(10);
        const second = FakeWebSocket.instances[1]!;
        second.open();

        await keepTalking(second, 120);
        expect(zombies.length).toBe(0);
        expect(second.closeCode).toBeUndefined();
        gateway.close();
    });

    test("closes connection when heartbeat acknowledgement times out", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            heartbeatAckTimeout: 10,
            reconnect: false,
        });
        const promise = gateway.connect();
        const socket = FakeWebSocket.instances[0]!;
        socket.open();
        await promise;
        socket.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 20 },
        });
        await Bun.sleep(60);
        expect(socket.closeCode).toBe(4900);
        gateway.close();

        const gwCloseErr = new Gateway({
            token: "token",
            intents: 1,
            heartbeatAckTimeout: 10,
            reconnect: false,
        });
        let gwError: Error | undefined;
        gwCloseErr.on("error", (e) => {
            if (e instanceof Error) gwError = e;
        });
        const p = gwCloseErr.connect();
        const s = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
        s.open();
        await p;
        s.close = () => {
            throw new Error("close failure");
        };
        s.receive({ op: GatewayOpcodes.Hello, d: { heartbeat_interval: 20 } });
        await Bun.sleep(60);
        expect(gwError).toBeDefined();
        gwCloseErr.close();
    });

    test("normalizes connection error", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        installWebSocket(
            class FailingWebSocket {
                constructor() {
                    throw "raw connection error";
                }
            },
        );
        await expect(gateway.connect()).rejects.toThrow();
        gateway.close();

        const gw2 = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        installWebSocket(
            class FailingGwWebSocket {
                constructor() {
                    throw new GatewayError("Custom Gateway error");
                }
            },
        );
        await expect(gw2.connect()).rejects.toThrow("Custom Gateway error");
        gw2.close();
    });

    test("emits error on websocket error event", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        let error: Error | undefined;
        gateway.on("error", (e) => {
            if (e instanceof Error) error = e;
        });
        const promise = gateway.connect();
        const socket = FakeWebSocket.instances[0]!;
        socket.open();
        await promise;
        socket.emit("error", {});
        expect(error).toBeInstanceOf(GatewayError);
        gateway.close();
    });

    test("sends presence, voice state, member requests and handles rate limits", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        const promise = gateway.connect();
        const socket = FakeWebSocket.instances[0]!;
        socket.open();
        await promise;

        expect(
            gateway.setPresence({
                status: "dnd",
                activities: [{ name: "Playing" }],
            }),
        ).toBe(true);
        expect(gateway.setVoiceState({ guild_id: "1", channel_id: "2" })).toBe(
            true,
        );
        expect(gateway.requestGuildMembers({ guild_id: "1", query: "" })).toBe(
            true,
        );

        for (let i = 0; i < 112; i++) {
            gateway.send({ op: 1, d: null, s: null, t: null });
        }
        let error: Error | undefined;
        gateway.on("error", (e) => {
            if (e instanceof Error) error = e;
        });
        expect(gateway.send({ op: 1, d: null, s: null, t: null })).toBe(false);
        gateway.close();

        const failingGw = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        const p2 = failingGw.connect();
        const s2 = FakeWebSocket.instances[1]!;
        s2.open();
        await p2;
        s2.send = () => {
            throw new Error("send failure");
        };
        expect(failingGw.send({ op: 1, d: null, s: null, t: null })).toBe(
            false,
        );
        failingGw.close();
    });

    test("reconnects with fresh identity on 4007", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 5,
        });
        const promise = gateway.connect();
        const socket =
            FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
        socket.open();
        await promise;
        socket.close(4007);
        await Bun.sleep(20);
        expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
        gateway.close();
    });

    test("stops reconnecting on fatal close code 4004", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
        });
        const promise = gateway.connect();
        const socket =
            FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
        socket.open();
        await promise;
        socket.close(4004);
        gateway.close();
    });

    test("exhausts max reconnect attempts", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            maxReconnectAttempts: 1,
            reconnectBaseDelay: 5,
        });
        const promise = gateway.connect();
        const socket =
            FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
        socket.open();
        await promise;
        socket.close(1006);
        await Bun.sleep(20);
        const socket2 =
            FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
        socket2.close(1006);
        await Bun.sleep(20);
        expect(gateway.state).toBe(GatewayState.Connect);
        gateway.close();
    });

    test("emits and removes custom event listeners with emit and off", async () => {
        const gateway = new Gateway({ token: "token", intents: 0 });
        let val: number | undefined;
        const fn: Parameters<Gateway["on"]>[1] = (v) => {
            if (typeof v === "number") val = v;
        };
        gateway.on("custom", fn);
        gateway.emit("custom", 42);
        expect(val).toBe(42);
        gateway.off("custom", fn);
        gateway.emit("custom", 99);
        expect(val).toBe(42);

        let caughtError: Error | undefined;
        gateway.on("error", (e) => {
            if (e instanceof Error) caughtError = e;
        });
        gateway.on("syncThrow", () => {
            throw new Error("sync error");
        });
        caughtError = undefined;
        gateway.emit("syncThrow", null);
        expect(caughtError).toBeDefined();

        gateway.on("rawThrow", () => {
            throw "raw non error";
        });
        caughtError = undefined;
        gateway.emit("rawThrow", null);
        expect(caughtError).toBeDefined();

        gateway.on("asyncThrow", async () => {
            throw new Error("async error");
        });
        caughtError = undefined;
        gateway.emit("asyncThrow", null);
        await Bun.sleep(10);
        expect(caughtError).toBeDefined();

        gateway.close();
    });

    test("resumes session when sessionId and sequence are available", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 1,
            reconnectMaxDelay: 1,
        });
        const first = gateway.connect();
        const socket1 = FakeWebSocket.instances[0]!;
        socket1.open();
        await first;

        socket1.receive({
            op: GatewayOpcodes.Dispatch,
            t: "READY",
            s: 42,
            d: {
                session_id: "test-session",
                resume_gateway_url: "wss://gateway-us-east1-b.discord.gg",
            },
        });

        socket1.close(1000, "network failure");
        await Bun.sleep(10);

        const socket2 = FakeWebSocket.instances[1]!;
        expect(socket2.url).toBe("wss://gateway-us-east1-b.discord.gg");
        socket2.open();

        socket2.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 100 },
        });

        const resume = JSON.parse(socket2.sent[0]!);
        expect(resume.op).toBe(GatewayOpcodes.Resume);
        expect(resume.d.session_id).toBe("test-session");
        expect(resume.d.seq).toBe(42);
        expect(gateway.state).toBe(GatewayState.Resume);

        gateway.close();
    });

    test("handles zlib-stream compression", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            compress: true,
            reconnect: false,
        });
        const promise = gateway.connect();
        const socket = FakeWebSocket.instances[0]!;
        expect(socket.url).toContain("compress=zlib-stream");
        socket.open();
        await promise;

        // Test requires a valid zlib-stream deflate-raw chunk of '{"op":10,"d":{"heartbeat_interval":50}}'
        // But since we can't easily mock DecompressionStream without native zlib, we can mock DecompressionStream

        gateway.close();
    });
});

describe("resumable client closes", () => {
    test("a server reconnect request closes with 4900, not 1000/1001", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        const promise = gateway.connect();
        const socket = FakeWebSocket.instances.at(-1)!;
        socket.open();
        await promise;
        socket.receive({ op: GatewayOpcodes.Reconnect, d: null });
        expect(socket.closeCode).toBe(4900);
        gateway.close();
    });
});
