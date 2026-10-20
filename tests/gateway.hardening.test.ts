/**
 * Gateway hardening regressions:
 * - G1: reconnect URLs keep the connect URL's query (v, encoding, compress),
 *   and IDENTIFY reconnects dial the caller's URL rather than Discord's default.
 * - G2: a heartbeat still unacknowledged when the next is due is an ACK
 *   timeout, even when `heartbeatAckTimeout` is at or above the interval.
 * - G3: a manual `connect()` while a reconnect is armed joins it instead of
 *   cancelling its backoff.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    Gateway,
    GatewayCloseCodes,
    GatewayHeartbeat,
    GatewayOpcodes,
    GatewayState,
    type HeartbeatTimeout,
} from "../packages/ws/src/index.ts";
import { FakeWebSocket, installWebSocket } from "./helpers/fake-websocket.ts";

const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

const RESUME_HOST = "wss://gateway-us-east1-b.discord.gg";

const OriginalWebSocket = globalThis.WebSocket;
const originalRandom = Math.random;
beforeEach(() => {
    FakeWebSocket.instances = [];
    installWebSocket(FakeWebSocket);
    // No jitter: the first heartbeat fires immediately, reconnects after base delay.
    Math.random = () => 0;
});
afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
    Math.random = originalRandom;
});

function gateway(over: Record<string, unknown> = {}): Gateway {
    const g = new Gateway({
        token: "token",
        intents: [1],
        reconnect: true,
        reconnectBaseDelay: 5,
        reconnectMaxDelay: 5,
        ...over,
    });
    g.on("error", () => {});
    return g;
}

/** Opens the newest socket, says HELLO and READY. */
async function ready(
    g: Gateway,
    url?: string,
    resumeURL = RESUME_HOST,
    interval = 45_000,
): Promise<FakeWebSocket> {
    const connecting = g.connect(url);
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.open();
    await connecting;
    socket.receive({
        op: GatewayOpcodes.Hello,
        d: { heartbeat_interval: interval },
    });
    socket.dispatch(
        "READY",
        { session_id: "s", resume_gateway_url: resumeURL },
        1,
    );
    return socket;
}

describe("G1: reconnect URLs", () => {
    test("a RESUME dials the resume host with v, encoding and compress", async () => {
        const g = gateway({ compress: true });
        const first = await ready(g);
        expect(first.url).toBe(
            "wss://gateway.discord.gg/?v=10&encoding=json&compress=zlib-stream",
        );
        first.close(1006);
        await wait(30);
        expect(FakeWebSocket.instances[1]!.url).toBe(
            `${RESUME_HOST}/?v=10&encoding=json&compress=zlib-stream`,
        );
        g.close();
    });

    test("an IDENTIFY reconnect dials the caller's URL, not Discord's default", async () => {
        const proxy = "wss://proxy.example/?v=10&encoding=json";
        const g = gateway();
        const first = await ready(g, proxy);
        first.close(GatewayCloseCodes.SessionTimedOut);
        await wait(30);
        const second = FakeWebSocket.instances[1]!;
        expect(second.url).toBe(proxy);
        second.open();
        second.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });
        expect(second.payloads().map((p) => p.op)).toContain(
            GatewayOpcodes.Identify,
        );
        g.close();
    });

    test("the caller's host is trusted for RESUME; query values on the resume URL win", async () => {
        const g = gateway();
        const first = await ready(
            g,
            "wss://proxy.example/?v=10&encoding=json",
            "wss://proxy.example/resume?v=9",
        );
        first.close(1006);
        await wait(30);
        expect(FakeWebSocket.instances[1]!.url).toBe(
            "wss://proxy.example/resume?v=9&encoding=json",
        );
        g.close();
    });

    test("an untrusted resume host still falls back to the caller's URL", async () => {
        const proxy = "wss://proxy.example/?v=10&encoding=json";
        const g = gateway();
        const first = await ready(g, proxy, "wss://evil.example");
        first.close(1006);
        await wait(30);
        expect(FakeWebSocket.instances[1]!.url).toBe(proxy);
        g.close();
    });

    test("an unparsable connect URL leaves the resume host as it is", async () => {
        const g = gateway();
        // The fake socket accepts any string; the Gateway must not throw on it.
        const first = await ready(g, "not a url");
        first.close(1006);
        await wait(30);
        expect(FakeWebSocket.instances[1]!.url).toBe(RESUME_HOST);
        g.close();
    });

    test("connect() without a URL reuses the last one", async () => {
        const proxy = "wss://proxy.example/?v=10&encoding=json";
        const g = gateway({ reconnect: false });
        const first = await ready(g, proxy);
        first.close(1006);
        expect(g.state).toBe(GatewayState.Connect);
        const again = g.connect();
        expect(FakeWebSocket.instances[1]!.url).toBe(proxy);
        FakeWebSocket.instances[1]!.open();
        await again;
        g.close();
    });
});

describe("G2: an unacknowledged heartbeat when the next is due", () => {
    function harness(ackTimeout: number, autoAck: boolean) {
        const sent: number[] = [];
        const timeouts: HeartbeatTimeout[] = [];
        const heartbeat: GatewayHeartbeat = new GatewayHeartbeat({
            ackTimeout,
            zombieTimeout: ackTimeout * 10,
            send: () => {
                sent.push(Date.now());
                if (autoAck) queueMicrotask(() => heartbeat.acknowledge());
                return true;
            },
            sequence: () => 1,
            isConnected: () => true,
            onTimeout: (timeout) => timeouts.push(timeout),
            onError: () => {},
        });
        return { heartbeat, sent, timeouts };
    }

    test("is reported as an ACK timeout even when ackTimeout exceeds the interval", async () => {
        const h = harness(1_000, false);
        h.heartbeat.watch();
        h.heartbeat.start(10);
        // Inbound dispatches keep the zombie watch quiet throughout.
        const traffic = setInterval(() => h.heartbeat.receivedMessage(), 3);
        await wait(80);
        clearInterval(traffic);
        h.heartbeat.stop();
        expect(h.timeouts).toHaveLength(1);
        expect(h.timeouts[0]!.type).toBe("ack");
        // The beat that found the previous one unacknowledged was not sent.
        expect(h.sent).toHaveLength(1);
    });

    test("acknowledged beats keep beating with no timeout", async () => {
        const h = harness(1_000, true);
        h.heartbeat.start(10);
        await wait(80);
        h.heartbeat.stop();
        expect(h.timeouts).toEqual([]);
        expect(h.sent.length).toBeGreaterThanOrEqual(4);
    });

    test("a beat that failed to send is not mistaken for an outstanding one", async () => {
        const timeouts: HeartbeatTimeout[] = [];
        const heartbeat = new GatewayHeartbeat({
            ackTimeout: 1_000,
            zombieTimeout: 10_000,
            send: () => false,
            sequence: () => null,
            isConnected: () => false,
            onTimeout: (timeout) => timeouts.push(timeout),
            onError: () => {},
        });
        heartbeat.start(10);
        await wait(40);
        heartbeat.stop();
        expect(timeouts).toEqual([]);
    });

    test("the Gateway closes resumably and RESUMEs", async () => {
        const g = gateway({ heartbeatAckTimeout: 1_000, zombieTimeout: 5_000 });
        const socket = await ready(g, undefined, RESUME_HOST, 10);
        await wait(40);
        expect(socket.closeCode).toBe(4900);
        await wait(30);
        const next = FakeWebSocket.instances[1]!;
        next.open();
        next.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });
        expect(next.payloads().map((p) => p.op)).toContain(
            GatewayOpcodes.Resume,
        );
        g.close();
    });
});

describe("G3: connect() while a reconnect is armed", () => {
    test("joins the scheduled attempt instead of dialing at once", async () => {
        const g = gateway({ reconnectBaseDelay: 30, reconnectMaxDelay: 30 });
        const first = await ready(g);
        first.close(1006);
        expect(g.state).toBe(GatewayState.Reconnect);

        const a = g.connect();
        const b = g.connect();
        expect(b).toBe(a);
        expect(FakeWebSocket.instances).toHaveLength(1);

        let settled = false;
        void a.then(() => (settled = true));
        await wait(50);
        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(settled).toBe(false);
        FakeWebSocket.instances[1]!.open();
        await a;
        expect(FakeWebSocket.instances).toHaveLength(2);
        g.close();
    });

    test("a URL passed while joining is what the scheduled IDENTIFY reconnect dials", async () => {
        const g = gateway({ reconnectBaseDelay: 20, reconnectMaxDelay: 20 });
        const first = await ready(g);
        first.close(GatewayCloseCodes.SessionTimedOut);
        const joined = g.connect("wss://proxy.example/?v=10");
        await wait(40);
        expect(FakeWebSocket.instances[1]!.url).toBe(
            "wss://proxy.example/?v=10",
        );
        FakeWebSocket.instances[1]!.open();
        await joined;
        g.close();
    });

    test("close() rejects a joined attempt and nothing dials afterwards", async () => {
        const g = gateway({ reconnectBaseDelay: 20, reconnectMaxDelay: 20 });
        const first = await ready(g);
        first.close(1006);
        const joined = g.connect().catch((error: unknown) => error);
        g.close();
        expect(await joined).toBeInstanceOf(Error);
        await wait(40);
        expect(FakeWebSocket.instances).toHaveLength(1);
    });

    test("a consumer reconnecting on every close cannot bypass the backoff", async () => {
        const g = gateway({ reconnectBaseDelay: 20, reconnectMaxDelay: 20 });
        g.on("close", () => void g.connect().catch(() => {}));
        const first = await ready(g);
        // Every new socket opens and is dropped at once, as in a reconnect storm.
        const drop = setInterval(() => {
            const socket = FakeWebSocket.instances.at(-1)!;
            if (socket.readyState === 0) {
                socket.open();
                socket.close(1006);
            }
        }, 1);
        first.close(1006);
        await wait(100);
        clearInterval(drop);
        g.close();
        // About one socket per 20 ms backoff; a cancelled backoff gave hundreds.
        expect(FakeWebSocket.instances.length).toBeLessThanOrEqual(8);
    });
});
