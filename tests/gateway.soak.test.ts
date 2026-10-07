import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
    Gateway,
    GatewayDispatcher,
    GatewayOpcodes,
    GatewaySendLimiter,
    SendBudget,
} from "../packages/ws/src/index.ts";
import { GatewayReconnect } from "../packages/ws/src/reconnect.ts";
import { FakeWebSocket, installWebSocket } from "./helpers/fake-websocket.ts";

const OriginalWebSocket = globalThis.WebSocket;
const HEARTBEAT_INTERVAL = 41_250;

beforeEach(() => {
    FakeWebSocket.instances = [];
    installWebSocket(FakeWebSocket);
    jest.useFakeTimers();
});
afterEach(() => {
    jest.useRealTimers();
    globalThis.WebSocket = OriginalWebSocket;
});

async function tick(ms: number): Promise<void> {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
}

async function connected(options: Record<string, unknown> = {}) {
    const gateway = new Gateway({ token: "token", intents: 1, ...options });
    gateway.on("error", () => undefined);
    const promise = gateway.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await promise;
    socket.receive({
        op: GatewayOpcodes.Hello,
        d: { heartbeat_interval: HEARTBEAT_INTERVAL },
    });
    return { gateway, socket };
}

/** Answers every heartbeat the way Discord does, and talks only now and then. */
async function simulate(
    socket: FakeWebSocket,
    minutes: number,
    dispatchEveryMs: number,
): Promise<void> {
    let answered = 0;
    let sequence = 0;
    let nextDispatch = dispatchEveryMs;
    for (let elapsed = 0; elapsed < minutes * 60_000; elapsed += 1000) {
        await tick(1000);
        const beats = socket
            .payloads()
            .filter((p) => p.op === GatewayOpcodes.Heartbeat).length;
        for (; answered < beats; answered++)
            socket.receive({ op: GatewayOpcodes.HeartbeatAck });
        if (elapsed >= nextDispatch) {
            socket.dispatch("TYPING_START", {}, ++sequence);
            nextDispatch += dispatchEveryMs;
        }
    }
}

describe("liveness soak (fake clock)", () => {
    test("30 minutes of sparse traffic cause no reconnect", async () => {
        const { gateway, socket } = await connected();
        const zombies: unknown[] = [];
        gateway.on("zombie", (z) => zombies.push(z));
        // One dispatch every five minutes: far sparser than the zombie timeout.
        await simulate(socket, 30, 5 * 60_000);
        expect(zombies).toHaveLength(0);
        expect(socket.closeCode).toBeUndefined();
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(gateway.health()).toMatchObject({
            reconnects: 0,
            state: gateway.state,
        });
        expect(gateway.health().latency).toBeGreaterThanOrEqual(0);
        gateway.close();
    });

    test("a silenced link is caught once and reconnects once", async () => {
        const { gateway, socket } = await connected();
        const zombies: unknown[] = [];
        gateway.on("zombie", (z) => zombies.push(z));
        // Healthy for ten minutes, then Discord stops answering anything.
        await simulate(socket, 10, 60_000);
        expect(zombies).toHaveLength(0);
        for (let i = 0; i < 120 && socket.closeCode === undefined; i++)
            await tick(1000);
        // Caught by the missing ACK or by the staleness watch, whichever is first.
        expect(socket.closeCode).toBe(4900);
        expect(socket.closeCalls).toHaveLength(1);
        expect(zombies.length).toBeLessThanOrEqual(1);
        expect(gateway.health().reconnects).toBe(1);
        gateway.close();
    });
});

describe("reconnect storms", () => {
    test("backoff keeps growing when each connection succeeds and drops again", () => {
        let now = 0;
        const reconnect = new GatewayReconnect({
            enabled: true,
            maxAttempts: Infinity,
            baseDelay: 1000,
            maxDelay: 30_000,
            stormLimit: 3,
            stormWindow: 60_000,
            random: () => 0,
            now: () => now,
        });
        const delays: number[] = [];
        const flags: boolean[] = [];
        for (let i = 0; i < 8; i++) {
            const result = reconnect.schedule(() => undefined);
            if (!result.scheduled) throw new Error("not scheduled");
            delays.push(result.delayMs);
            flags.push(result.unstable !== undefined);
            reconnect.cancel();
            reconnect.reset(); // the connection worked, then dropped
            now += 2000;
        }
        expect(delays).toEqual([
            1000, 1000, 1000, 2000, 4000, 8000, 16_000, 30_000,
        ]);
        expect(flags).toEqual([
            false,
            false,
            false,
            true,
            true,
            true,
            true,
            true,
        ]);
        // A quiet minute forgives it.
        now += 120_000;
        const calm = reconnect.schedule(() => undefined);
        expect(calm).toMatchObject({ scheduled: true, delayMs: 1000 });
        expect(calm.scheduled && calm.unstable).toBeUndefined();
        reconnect.cancel();
    });

    test("the Gateway emits unstable and the shard bubbles it", async () => {
        const { gateway, socket } = await connected({
            reconnectStormLimit: 1,
            reconnectBaseDelay: 1,
            reconnectMaxDelay: 1000,
        });
        const unstable: Array<{ reconnects: number; delay: number }> = [];
        gateway.on("unstable", (info) =>
            unstable.push(info as { reconnects: number; delay: number }),
        );
        let current = socket;
        for (let i = 0; i < 3; i++) {
            current.close(1006, "drop");
            await tick(5000);
            current = FakeWebSocket.instances.at(-1)!;
            current.open();
            await Promise.resolve();
            current.receive({
                op: GatewayOpcodes.Hello,
                d: { heartbeat_interval: HEARTBEAT_INTERVAL },
            });
        }
        expect(unstable.length).toBeGreaterThanOrEqual(2);
        expect(unstable.at(-1)!.delay).toBeGreaterThan(unstable[0]!.delay - 1);
        gateway.close();
    });
});

describe("extracted gateway pieces", () => {
    test("GatewayDispatcher isolates failing listeners and never loops on error", async () => {
        const failures: unknown[] = [];
        const dispatcher = new GatewayDispatcher((e) => failures.push(e));
        const seen: unknown[] = [];
        const bad = () => {
            throw new Error("sync");
        };
        dispatcher.on("x", bad);
        dispatcher.on("x", async () => {
            throw new Error("async");
        });
        dispatcher.on("x", (d) => seen.push(d));
        dispatcher.emit("x", 1);
        await Promise.resolve();
        await Promise.resolve();
        expect(seen).toEqual([1]);
        expect(failures.map((e) => (e as Error).message).sort()).toEqual([
            "async",
            "sync",
        ]);
        dispatcher.off("x", bad);
        dispatcher.on("error", bad);
        dispatcher.on("error", async () => {
            throw new Error("e");
        });
        dispatcher.emit("error", 1);
        await Promise.resolve();
        await Promise.resolve();
        expect(failures).toHaveLength(2);
        dispatcher.emit("none", 0);
    });

    test("GatewaySendLimiter keeps its old name", () => {
        expect(SendBudget).toBe(GatewaySendLimiter);
        const limiter = new GatewaySendLimiter(1, 1000);
        limiter.record(0);
        expect(limiter.allows(false, 10)).toBe(false);
        expect(limiter.allows(true, 10)).toBe(true);
        expect(limiter.allows(false, 2000)).toBe(true);
    });
});
