import { describe, expect, test } from "bun:test";
import {
    GatewayHeartbeat,
    type HeartbeatTimeout,
} from "../packages/ws/src/index.ts";

/**
 * Stage 1B.2 acceptance: every liveness rule is asserted without a WebSocket,
 * a Gateway or a reconnect. Previously an ACK deadline could only be tested by
 * driving a fake socket through a full connection.
 */
interface Harness {
    heartbeat: GatewayHeartbeat;
    sent: Array<number | null>;
    timeouts: HeartbeatTimeout[];
    errors: Error[];
    setConnected: (value: boolean) => void;
    setSequence: (value: number | null) => void;
    failSends: (value: boolean) => void;
}

function harness(
    options: { ackTimeout?: number; zombieTimeout?: number } = {},
): Harness {
    const sent: Array<number | null> = [];
    const timeouts: HeartbeatTimeout[] = [];
    const errors: Error[] = [];
    let connected = true;
    let sequence: number | null = null;
    let failing = false;

    const heartbeat = new GatewayHeartbeat({
        ackTimeout: options.ackTimeout ?? 20,
        zombieTimeout: options.zombieTimeout ?? 50,
        send: (value) => {
            if (failing) return false;
            sent.push(value);
            return true;
        },
        sequence: () => sequence,
        isConnected: () => connected,
        onTimeout: (timeout) => timeouts.push(timeout),
        onError: (error) => errors.push(error),
    });

    return {
        heartbeat,
        sent,
        timeouts,
        errors,
        setConnected: (value) => (connected = value),
        setSequence: (value) => (sequence = value),
        failSends: (value) => (failing = value),
    };
}

const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

describe("GatewayHeartbeat construction", () => {
    test("rejects a zombie timeout that cannot outlast the ACK deadline", () => {
        expect(
            () =>
                new GatewayHeartbeat({
                    ackTimeout: 100,
                    zombieTimeout: 100,
                    send: () => true,
                    sequence: () => null,
                    isConnected: () => true,
                    onTimeout: () => {},
                    onError: () => {},
                }),
        ).toThrow(RangeError);
    });

    test("starts with no latency and an acknowledged state", () => {
        const { heartbeat } = harness();
        expect(heartbeat.latency).toBe(-1);
        expect(heartbeat.interval).toBe(0);
        expect(heartbeat.acknowledged).toBe(true);
        expect(heartbeat.isHealthy()).toBe(true);
        heartbeat.stop();
    });
});

describe("GatewayHeartbeat beating", () => {
    test("sends the current session sequence, including 0", () => {
        const h = harness();
        h.setSequence(0);
        h.heartbeat.sendHeartbeat();
        expect(h.sent).toEqual([0]);

        h.setSequence(42);
        h.heartbeat.sendHeartbeat();
        expect(h.sent).toEqual([0, 42]);
        h.heartbeat.stop();
    });

    test("a sent heartbeat is unacknowledged until an ACK arrives", () => {
        const h = harness();
        h.heartbeat.sendHeartbeat();
        expect(h.heartbeat.acknowledged).toBe(false);
        expect(h.heartbeat.isHealthy()).toBe(false);

        h.heartbeat.acknowledge();
        expect(h.heartbeat.acknowledged).toBe(true);
        expect(h.heartbeat.latency).toBeGreaterThanOrEqual(0);
        expect(h.heartbeat.isHealthy()).toBe(true);
        h.heartbeat.stop();
    });

    test("start() beats on the interval after a jittered first beat", async () => {
        const h = harness();
        h.heartbeat.start(30);
        expect(h.heartbeat.interval).toBe(30);
        await wait(80);
        expect(h.sent.length).toBeGreaterThanOrEqual(2);
        h.heartbeat.stop();

        const afterStop = h.sent.length;
        await wait(50);
        expect(h.sent.length).toBe(afterStop);
    });

    test("restarting replaces the previous interval instead of stacking", async () => {
        const h = harness();
        h.heartbeat.start(1000);
        h.heartbeat.start(20);
        await wait(70);
        // Only the 20ms interval is live; a stacked 1000ms timer would not
        // fire here, but a stacked 20ms one would double the count.
        expect(h.sent.length).toBeLessThanOrEqual(5);
        expect(h.sent.length).toBeGreaterThanOrEqual(2);
        h.heartbeat.stop();
    });
});

describe("GatewayHeartbeat acknowledgement deadline", () => {
    test("reports an ACK timeout when no acknowledgement arrives", async () => {
        const h = harness({ ackTimeout: 20 });
        h.heartbeat.sendHeartbeat();
        await wait(50);
        expect(h.timeouts).toHaveLength(1);
        expect(h.timeouts[0]!.type).toBe("ack");
        expect(
            (h.timeouts[0] as { elapsedMs: number }).elapsedMs,
        ).toBeGreaterThanOrEqual(15);
        h.heartbeat.stop();
    });

    test("an acknowledged heartbeat never reports a timeout", async () => {
        const h = harness({ ackTimeout: 20 });
        h.heartbeat.sendHeartbeat();
        h.heartbeat.acknowledge();
        await wait(50);
        expect(h.timeouts).toEqual([]);
        h.heartbeat.stop();
    });

    test("a heartbeat that never reached the wire errors instead of arming a deadline", async () => {
        const h = harness({ ackTimeout: 20 });
        h.failSends(true);
        h.heartbeat.sendHeartbeat();
        expect(h.errors).toHaveLength(1);
        expect(h.errors[0]!.message).toContain("Unable to send");
        await wait(50);
        // No ACK deadline was armed, because nothing was sent to acknowledge.
        expect(h.timeouts).toEqual([]);
        h.heartbeat.stop();
    });

    test("stop() cancels a pending ACK deadline", async () => {
        const h = harness({ ackTimeout: 20 });
        h.heartbeat.sendHeartbeat();
        h.heartbeat.stop();
        await wait(50);
        expect(h.timeouts).toEqual([]);
    });
});

describe("GatewayHeartbeat staleness watch", () => {
    test("reports a zombie once after the deadline, not repeatedly", async () => {
        const h = harness({ ackTimeout: 20, zombieTimeout: 50 });
        h.heartbeat.watch();
        await wait(140);
        expect(h.timeouts).toHaveLength(1);
        expect(h.timeouts[0]).toMatchObject({ type: "zombie" });
        expect(
            (h.timeouts[0] as { silentFor: number }).silentFor,
        ).toBeGreaterThanOrEqual(50);
        h.heartbeat.stop();
    });

    test("inbound traffic resets the silence and re-arms reporting", async () => {
        const h = harness({ ackTimeout: 20, zombieTimeout: 50 });
        h.heartbeat.watch();
        for (let i = 0; i < 4; i++) {
            await wait(20);
            h.heartbeat.receivedMessage();
        }
        expect(h.timeouts).toEqual([]);
        expect(h.heartbeat.silentFor).toBeLessThan(50);

        await wait(120);
        expect(h.timeouts).toHaveLength(1);
        h.heartbeat.stop();
    });

    test("a disconnected socket is never reported as a zombie", async () => {
        const h = harness({ ackTimeout: 20, zombieTimeout: 50 });
        h.heartbeat.watch();
        h.setConnected(false);
        await wait(140);
        expect(h.timeouts).toEqual([]);
        h.heartbeat.stop();
    });

    test("the deadline always outlasts one interval plus its ACK budget", () => {
        const h = harness({ ackTimeout: 20, zombieTimeout: 50 });
        expect(h.heartbeat.stalenessDeadline).toBe(50);
        // A quiet Gateway with a long interval must not look dead.
        h.heartbeat.start(45_000);
        expect(h.heartbeat.stalenessDeadline).toBe(45_020);
        h.heartbeat.stop();
    });

    test("isHealthy() reports silence beyond the deadline", async () => {
        const h = harness({ ackTimeout: 20, zombieTimeout: 40 });
        h.heartbeat.watch();
        expect(h.heartbeat.isHealthy()).toBe(true);
        await wait(70);
        expect(h.heartbeat.isHealthy()).toBe(false);
        h.heartbeat.receivedMessage();
        expect(h.heartbeat.isHealthy()).toBe(true);
        h.heartbeat.stop();
    });

    test("stop() ends the staleness watch", async () => {
        const h = harness({ ackTimeout: 20, zombieTimeout: 50 });
        h.heartbeat.watch();
        h.heartbeat.stop();
        await wait(140);
        expect(h.timeouts).toEqual([]);
    });
});
