import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { ShardBus } from "../packages/sharding/src/bus.ts";
import {
    BUS_FRAME,
    BroadcastChannelTransport,
    IpcTransport,
    PEER_DOWN_FRAME,
    defaultTransport,
} from "../packages/sharding/src/transport.ts";
import { ShardSupervisor } from "../packages/sharding/src/supervisor.ts";

/** A forked worker as the parent sees it, and as the worker sees `process`. */
class Link extends EventEmitter {
    public connected = true;
    public readonly sent: unknown[] = [];
    public exitCode: number | null = null;
    public signalCode: NodeJS.Signals | null = null;
    public constructor(public readonly env: Record<string, string> = {}) {
        super();
    }
    /** The parent sending to the worker. */
    public send(frame: unknown): boolean {
        this.sent.push(frame);
        queueMicrotask(() => this.emit("worker-message", frame));
        return true;
    }
    public kill(): boolean {
        queueMicrotask(() => this.emit("exit", null, "SIGTERM"));
        return true;
    }
}

const children: Link[] = [];
mock.module("node:child_process", () => ({
    fork: (
        _s: string,
        _a: string[],
        options: { env: Record<string, string> },
    ) => {
        const child = new Link(options.env);
        children.push(child);
        return child;
    },
}));
const { ClusterManager } = await import("../packages/sharding/src/cluster.ts");

const bunVersion = process.versions.bun;
beforeAll(() =>
    Object.defineProperty(process.versions, "bun", {
        value: undefined,
        configurable: true,
        writable: true,
    }),
);
afterAll(() =>
    Object.defineProperty(process.versions, "bun", {
        value: bunVersion,
        configurable: true,
        writable: true,
    }),
);

/** A worker's `process`: what it sends reaches the parent, parent frames reach it. */
function worker(link: Link, parentInbox: (frame: unknown) => void) {
    const endpoint = new EventEmitter() as EventEmitter & {
        send(frame: unknown): void;
    };
    endpoint.send = (frame) => queueMicrotask(() => parentInbox(frame));
    link.on("worker-message", (frame) => endpoint.emit("message", frame));
    return endpoint;
}

async function pair() {
    children.length = 0;
    const manager = new ClusterManager({
        token: "t",
        script: "w.js",
        shardCount: 2,
        clusterCount: 2,
        restartOnExit: false,
    });
    await manager.spawn();
    const [a, b] = children as [Link, Link];
    const busA = new ShardBus(0, "app", {
        transport: new IpcTransport(
            worker(a, (f) => a.emit("message", f)) as never,
        ),
    });
    const busB = new ShardBus(1, "app", {
        transport: new IpcTransport(
            worker(b, (f) => b.emit("message", f)) as never,
        ),
    });
    return { manager, a, b, busA, busB };
}

describe("IPC transport through the ClusterManager relay", () => {
    test("forked children are told to use IPC", async () => {
        const { manager, a } = await pair();
        expect(a.env.LUNIBEE_SHARD_BUS).toBe("ipc");
        manager.killAll();
    });

    test("broadcast, send and request/response cross clusters", async () => {
        const { manager, busA, busB } = await pair();
        const got: unknown[] = [];
        busB.on("hello", (m) => got.push(m.data));
        busA.broadcast("hello", 1);
        busA.send(1, "hello", 2);
        busA.send(5, "hello", 3);
        busB.respond("sum", (d: number[]) => d.reduce((x, y) => x + y, 0));
        expect(await busA.request<number>(1, "sum", [1, 2, 3])).toBe(6);
        await Bun.sleep(5);
        expect(got).toEqual([1, 2]);
        const all = await busA.broadcastRequest("sum", [4, 5], { expected: 1 });
        expect(all).toEqual([{ shardId: 1, result: 9 }]);
        manager.killAll();
        busA.close();
        busB.close();
    });

    test("a request times out when nobody answers", async () => {
        const { manager, busA, busB } = await pair();
        await expect(busA.request(1, "silent", null, 20)).rejects.toThrow(
            /did not reply/,
        );
        manager.killAll();
        busA.close();
        busB.close();
    });

    test("a worker dying mid-request rejects the pending promise", async () => {
        const { manager, b, busA, busB } = await pair();
        busB.respond("never", () => new Promise(() => {}));
        const pending = busA.request(1, "never", null, 5000);
        await Bun.sleep(5);
        b.emit("exit", 1, null);
        await expect(pending).rejects.toThrow(/went away/);
        manager.killAll();
        busA.close();
        busB.close();
    });

    test("pending requests are capped", async () => {
        const { manager, busA, busB } = await pair();
        const capped = new ShardBus(0, "app", {
            maxPending: 1,
            transport: { post() {}, onMessage() {}, close() {} },
        });
        const first = capped.request(1, "x", null, 30).catch(() => "timeout");
        await expect(capped.request(1, "y", null, 30)).rejects.toThrow(
            /Too many/,
        );
        expect(await first).toBe("timeout");
        await expect(
            capped.broadcastRequest("z", null, { timeoutMs: 1 }),
        ).resolves.toEqual([]);
        manager.killAll();
        busA.close();
        busB.close();
        capped.close();
    });

    test("ignores frames that are not bus traffic", async () => {
        const { manager, a, b, busA, busB } = await pair();
        a.emit("message", "text");
        a.emit("message", null);
        a.emit("message", { other: 1 });
        expect(b.sent).toEqual([]);
        manager.killAll();
        busA.close();
        busB.close();
    });
});

describe("handler failures are never swallowed", () => {
    test("without an error listener they become a process warning", async () => {
        const warnings: Error[] = [];
        const original = process.emitWarning;
        process.emitWarning = ((warning: Error) => {
            warnings.push(warning);
        }) as never;
        const hub = new BroadcastChannelTransport("warn");
        const bus = new ShardBus(1, "warn", {
            transport: new BroadcastChannelTransport("warn"),
        });
        bus.on("boom", () => {
            throw new Error("sync");
        });
        bus.on("boom", async () => {
            throw "async";
        });
        hub.post({ source: 0, target: null, type: "boom", data: 1, id: "x" });
        await Bun.sleep(20);
        process.emitWarning = original;
        expect(warnings.map((w) => w.message).sort()).toEqual([
            "async",
            "sync",
        ]);
        bus.close();
        hub.close();
    });
});

describe("IpcTransport and defaults", () => {
    test("needs an IPC channel", () => {
        expect(() => new IpcTransport({ on() {}, off() {} })).toThrow(
            /forked by ClusterManager/,
        );
    });

    test("close stops listening; foreign frames are ignored", () => {
        const endpoint = new EventEmitter() as EventEmitter & {
            send(frame: unknown): void;
        };
        endpoint.send = () => {};
        const transport = new IpcTransport(endpoint as never);
        const seen: unknown[] = [];
        transport.onMessage((m) => seen.push(m));
        endpoint.emit("message", { [BUS_FRAME]: { type: "a" } });
        endpoint.emit("message", { [PEER_DOWN_FRAME]: [1] });
        endpoint.emit("message", 5);
        transport.close();
        endpoint.emit("message", { [BUS_FRAME]: { type: "b" } });
        expect(seen).toEqual([{ type: "a" }]);
    });

    test("defaultTransport follows the environment", () => {
        expect(defaultTransport("n")).toBeInstanceOf(BroadcastChannelTransport);
        const send = process.send;
        process.env.LUNIBEE_SHARD_BUS = "ipc";
        process.send = (() => true) as never;
        try {
            expect(defaultTransport("n")).toBeInstanceOf(IpcTransport);
        } finally {
            delete process.env.LUNIBEE_SHARD_BUS;
            process.send = send;
        }
    });
});

describe("ShardSupervisor", () => {
    test("fixed delay by default, never gives up", () => {
        const supervisor = new ShardSupervisor();
        for (let i = 0; i < 20; i++) expect(supervisor.next(0, i)).toBe(5000);
    });

    test("backoff, cap and jitter", () => {
        const supervisor = new ShardSupervisor(
            { restartDelay: 100, backoff: 2, maxDelay: 350, jitter: 0.5 },
            () => 1,
        );
        expect([0, 1, 2, 3].map((t) => supervisor.next(7, t))).toEqual([
            150, 300, 525, 525,
        ]);
    });

    test("gives up after maxRestarts in the window, and forgives a stable cluster", () => {
        const supervisor = new ShardSupervisor({
            restartDelay: 1,
            maxRestarts: 2,
            window: 1000,
        });
        expect(supervisor.next(1, 0)).toBe(1);
        expect(supervisor.next(1, 10)).toBe(1);
        expect(supervisor.next(1, 20)).toBeNull();
        expect(supervisor.next(1, 30)).toBe(1); // history cleared by giving up
        expect(supervisor.next(1, 5000)).toBe(1); // earlier crashes aged out
        expect(supervisor.next(2, 20)).toBe(1); // clusters are independent
        supervisor.reset(2);
        supervisor.reset();
    });

    test("validates options", () => {
        expect(() => new ShardSupervisor({ backoff: 0.5 })).toThrow(RangeError);
        expect(() => new ShardSupervisor({ jitter: 2 })).toThrow(RangeError);
        expect(() => new ShardSupervisor({ window: 0 })).toThrow(RangeError);
        expect(() => new ShardSupervisor({ restartDelay: -1 })).toThrow(
            RangeError,
        );
        expect(() => new ShardSupervisor({ maxRestarts: -1 })).toThrow(
            RangeError,
        );
    });

    test("ClusterManager gives up on a crash loop", async () => {
        children.length = 0;
        const gaveUp: number[] = [];
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 1,
            clusterCount: 1,
            restartDelay: 1,
            supervisor: { maxRestarts: 2 },
            onGiveUp: (cluster) => {
                gaveUp.push(cluster.id);
                throw new Error("isolated");
            },
        });
        await manager.spawn();
        for (let i = 0; i < 3; i++) {
            children.at(-1)!.emit("exit", 1, null);
            await Bun.sleep(10);
        }
        expect(children).toHaveLength(3);
        expect(gaveUp).toEqual([0]);
        manager.killAll();
    });
});
