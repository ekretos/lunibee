import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    Gateway,
    GatewayOpcodes,
    GatewayState,
} from "../packages/ws/src/index.ts";
import { FakeWebSocket, installWebSocket } from "./helpers/fake-websocket.ts";

const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

const OriginalWebSocket = globalThis.WebSocket;
beforeEach(() => {
    FakeWebSocket.instances = [];
    installWebSocket(FakeWebSocket);
});
afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
});

const gateway = (over: Record<string, unknown> = {}) =>
    new Gateway({
        token: "token",
        intents: [1],
        reconnect: true,
        reconnectBaseDelay: 5,
        reconnectMaxDelay: 5,
        ...over,
    });

/** Opens the newest socket, says HELLO and READY. */
async function ready(g: Gateway, interval = 45_000, sequence = 1) {
    const connecting = g.connect("wss://main.test");
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.open();
    await connecting;
    socket.receive({
        op: GatewayOpcodes.Hello,
        d: { heartbeat_interval: interval },
    });
    socket.dispatch(
        "READY",
        { session_id: "s", resume_gateway_url: "wss://resume.test" },
        sequence,
    );
    return socket;
}
const heartbeats = (socket: FakeWebSocket) =>
    socket.payloads().filter((p) => p.op === GatewayOpcodes.Heartbeat).length;

describe("shutdown", () => {
    test("connect() after close() rejects instead of throwing", async () => {
        const g = gateway();
        g.close();
        let thrown: unknown;
        let promise: Promise<void> | undefined;
        try {
            promise = g.connect();
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeUndefined();
        await expect(promise).rejects.toThrow(/permanently closed/);
    });

    test("close() is safe to call twice, before connecting and mid-connect", async () => {
        const never = gateway();
        never.close();
        never.close();
        expect(never.state).toBe(GatewayState.Closed);

        const g = gateway();
        const connecting = g.connect("wss://main.test");
        const settled = connecting.catch((e: unknown) => e);
        g.close();
        g.close();
        expect(await settled).toBeInstanceOf(Error);
        expect(g.state).toBe(GatewayState.Closed);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    test("a closed Gateway sends no heartbeats and opens no sockets", async () => {
        const g = gateway({ reconnect: true });
        const socket = await ready(g, 15);
        await wait(60);
        expect(heartbeats(socket)).toBeGreaterThan(0);
        g.close();
        const sent = socket.sent.length;
        await wait(120);
        expect(socket.sent.length).toBe(sent);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });
});

describe("lifecycle", () => {
    test("a second HELLO does not start a second heartbeat loop", async () => {
        const g = gateway({ reconnect: false });
        const socket = await ready(g, 20);
        socket.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 20 },
        });
        socket.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 20 },
        });
        const before = heartbeats(socket);
        await wait(200);
        const beats = heartbeats(socket) - before;
        // One loop at 20 ms gives about 10; three overlapping loops would give 30.
        expect(beats).toBeGreaterThan(3);
        expect(beats).toBeLessThanOrEqual(14);
        g.close();
    });

    test("listeners are not duplicated by reconnects", async () => {
        const g = gateway();
        let seen = 0;
        g.on("dispatch", () => seen++);
        g.on("MESSAGE_CREATE", () => undefined);
        let socket = await ready(g);
        for (let round = 0; round < 3; round++) {
            socket.close(1006);
            await wait(40);
            socket = FakeWebSocket.instances.at(-1)!;
            socket.open();
            socket.receive({
                op: GatewayOpcodes.Hello,
                d: { heartbeat_interval: 45_000 },
            });
            socket.receive({ op: GatewayOpcodes.InvalidSession, d: true });
            await wait(5);
        }
        seen = 0;
        socket.dispatch("MESSAGE_CREATE", { id: "1" }, 99);
        await wait(5);
        expect(seen).toBeLessThanOrEqual(1);
        g.close();
    });

    test("a frame that is not a Gateway payload is reported, closes the connection and reconnects", async () => {
        for (const data of [
            "garbage",
            "{",
            "null",
            "[]",
            "42",
            '{"op":"0"}',
            "12345",
        ]) {
            FakeWebSocket.instances = [];
            const g = gateway();
            const errors: string[] = [];
            g.on("error", (e) => errors.push((e as Error).message));
            const socket = await ready(g);
            expect(() =>
                socket.emit("message", { data: data as string }),
            ).not.toThrow();
            await wait(60);
            expect({ data, errors: errors.length }).toEqual({
                data,
                errors: 1,
            });
            // The connection was dropped and a new one opened to recover.
            expect({ data, sockets: FakeWebSocket.instances.length }).toEqual({
                data,
                sockets: 2,
            });
            g.close();
        }
    });

    test("odd but well-formed frames neither crash nor dispatch what they do not name", async () => {
        const g = gateway({ reconnect: false });
        const errors: unknown[] = [];
        let dispatches = 0;
        g.on("error", (e) => errors.push(e));
        g.on("MESSAGE_CREATE", () => dispatches++);
        const socket = await ready(g);
        const frames = [
            '{"op":99}',
            '{"op":0}',
            '{"op":0,"t":5,"s":1,"d":{}}',
            `{"op":0,"t":"${"X".repeat(5000)}","s":2,"d":{}}`,
        ];
        for (const data of frames) socket.emit("message", { data });
        await wait(10);
        expect(dispatches).toBe(0);
        expect(errors).toEqual([]);
        // The connection is still usable afterwards.
        socket.dispatch("MESSAGE_CREATE", { id: "9" }, 50);
        await wait(5);
        expect(dispatches).toBe(1);
        expect(g.state).not.toBe(GatewayState.Closed);
        g.close();
    });

    test("a session the Gateway invalidates is identified again, not resumed with stale state", async () => {
        const g = gateway();
        const first = await ready(g, 45_000, 10);
        first.receive({ op: GatewayOpcodes.InvalidSession, d: false });
        await wait(1500);
        const second = FakeWebSocket.instances.at(-1)!;
        expect(second).not.toBe(first);
        second.open();
        second.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });
        await wait(5);
        const ops = second.payloads().map((p) => p.op);
        expect(ops).toContain(GatewayOpcodes.Identify);
        expect(ops).not.toContain(GatewayOpcodes.Resume);
        g.close();
    });
});
