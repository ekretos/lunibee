import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
    ClusterWorker,
    ShardManager,
    type ClusterContext,
} from "../packages/sharding/src/index.ts";
import {
    CLUSTER_FRAME,
    REQUEST_ASSIGN,
    REQUEST_HEALTH,
} from "../packages/sharding/src/protocol.ts";
import { Gateway } from "../packages/ws/src/index.ts";
import { tick } from "./helpers/fake-cluster.ts";

type Frame = Record<string, unknown>;

/** The worker's end of the IPC channel, with a parent that the test plays. */
class FakeEndpoint extends EventEmitter {
    public readonly sent: Frame[] = [];
    /** What the parent does with each control frame the worker sends. */
    public parent?: (body: Frame) => void;
    public send(frame: Frame): boolean {
        const body = frame[CLUSTER_FRAME] as Frame;
        this.sent.push(body);
        queueMicrotask(() => this.parent?.(body));
        return true;
    }
    public fromParent(body: Frame): void {
        this.emit("message", { [CLUSTER_FRAME]: body });
    }
    public frames(kind: string): Frame[] {
        return this.sent.filter((f) => f.kind === kind);
    }
}

const context = (over: Partial<ClusterContext> = {}): ClusterContext => ({
    clusterId: 0,
    clusterCount: 2,
    shardCount: 6,
    shardIds: [1, 4],
    coordinatedIdentify: true,
    ...over,
});

const originalConnect = Gateway.prototype.connect;
afterEach(() => {
    Gateway.prototype.connect = originalConnect;
    ClusterWorker.reset();
    delete process.env.LUNIBEE_CLUSTER_WORKER;
    delete process.env.SHARD_COUNT;
    delete process.env.SHARD_LIST;
    delete process.env.CLUSTER_ID;
    delete process.env.CLUSTER_COUNT;
    delete (process as { send?: unknown }).send;
});

describe("ClusterWorker", () => {
    test("needs an IPC channel", () => {
        expect(
            () => new ClusterWorker(context(), new EventEmitter() as never),
        ).toThrow(/IPC channel/);
    });

    test("current() exists only inside a forked worker", () => {
        expect(ClusterWorker.current()).toBeUndefined();
        process.env.LUNIBEE_CLUSTER_WORKER = "1";
        process.env.SHARD_COUNT = "4";
        process.env.SHARD_LIST = "0,1";
        process.env.CLUSTER_ID = "0";
        process.env.CLUSTER_COUNT = "2";
        expect(ClusterWorker.current()).toBeUndefined(); // no process.send
        (process as { send?: unknown }).send = () => true;
        const worker = ClusterWorker.current();
        expect(worker?.context).toMatchObject({
            shardCount: 4,
            shardIds: [0, 1],
        });
        expect(ClusterWorker.current()).toBe(worker);
    });

    test("ready() and reportHealth() send control frames", () => {
        const endpoint = new FakeEndpoint();
        const worker = new ClusterWorker(context(), endpoint as never);
        worker.ready();
        worker.ready([1]);
        worker.reportHealth({ shards: [], reportedAt: 1 });
        expect(endpoint.sent).toEqual([
            { kind: "ready", shardIds: [1, 4] },
            { kind: "ready", shardIds: [1] },
            { kind: "health", report: { shards: [], reportedAt: 1 } },
        ]);
    });

    test("the identify gate asks the parent and waits for its answer", async () => {
        const endpoint = new FakeEndpoint();
        const worker = new ClusterWorker(context(), endpoint as never);
        const gate = worker.identifyGate!;
        let granted = false;
        const waiting = gate.acquire(1).then(() => {
            granted = true;
        });
        await tick();
        expect(granted).toBe(false);
        expect(endpoint.frames("identify")).toEqual([
            { kind: "identify", id: 1, shardId: 1 },
        ]);
        endpoint.fromParent({ kind: "identify-grant", id: 99 }); // unknown id
        endpoint.fromParent({ kind: "identify-grant", id: 1 });
        await waiting;
        gate.release(1);
        expect(endpoint.frames("identify-done")).toEqual([
            { kind: "identify-done", shardId: 1 },
        ]);

        const denied = gate.acquire(4).catch((error: Error) => error.message);
        endpoint.fromParent({ kind: "identify-deny", id: 2, error: "no" });
        expect(await denied).toBe("no");
    });

    test("there is no gate unless the parent coordinates", () => {
        const worker = new ClusterWorker(
            context({ coordinatedIdentify: false }),
            new FakeEndpoint() as never,
        );
        expect(worker.identifyGate).toBeUndefined();
    });

    test("losing the parent or closing rejects waiting requests", async () => {
        const endpoint = new FakeEndpoint();
        const worker = new ClusterWorker(context(), endpoint as never);
        const first = worker
            .identifyGate!.acquire(1)
            .catch((e: Error) => e.message);
        endpoint.emit("disconnect");
        expect(await first).toMatch(/parent went away/);
        const second = worker
            .identifyGate!.acquire(4)
            .catch((e: Error) => e.message);
        worker.close();
        expect(await second).toMatch(/closed/);
        await expect(worker.identifyGate!.acquire(1)).rejects.toThrow(/closed/);
        expect(endpoint.listenerCount("message")).toBe(0);
        expect(endpoint.listenerCount("disconnect")).toBe(0);
    });

    test("a send failure rejects waiting requests instead of hanging", async () => {
        const endpoint = new FakeEndpoint();
        const worker = new ClusterWorker(context(), endpoint as never);
        endpoint.send = () => {
            throw new Error("channel closed");
        };
        await expect(worker.identifyGate!.acquire(1)).rejects.toThrow(
            "channel closed",
        );
    });

    test("answers parent requests: result, error, async, unknown type", async () => {
        const endpoint = new FakeEndpoint();
        const worker = new ClusterWorker(context(), endpoint as never);
        worker
            .onRequest("sum", (data) =>
                (data as number[]).reduce((a, b) => a + b),
            )
            .onRequest("slow", async () => {
                await tick(5);
                return "later";
            })
            .onRequest("boom", () => {
                throw new Error("handler failed");
            })
            .onRequest("throws-text", () => {
                throw "plain";
            });
        for (const [id, type, data] of [
            ["a", "sum", [1, 2, 3]],
            ["b", "slow", null],
            ["c", "boom", null],
            ["d", "throws-text", null],
            ["e", "missing", null],
        ] as const)
            endpoint.fromParent({ kind: "request", id, type, data });
        await tick(15);
        const replies = Object.fromEntries(
            endpoint.frames("reply").map((f) => [f.id, f]),
        );
        expect(replies.a).toMatchObject({ result: 6 });
        expect(replies.b).toMatchObject({ result: "later" });
        expect(replies.c).toMatchObject({ error: "handler failed" });
        expect(replies.d).toMatchObject({ error: "plain" });
        expect(replies.e).toMatchObject({ error: 'No handler for "missing".' });
        expect(() => worker.onRequest("", () => 1)).toThrow(TypeError);
        expect(() => worker.onRequest("x", 5 as never)).toThrow(TypeError);
    });

    test("ignores frames that are not for it", () => {
        const endpoint = new FakeEndpoint();
        const worker = new ClusterWorker(context(), endpoint as never);
        worker.onRequest("t", () => 1);
        endpoint.emit("message", "text");
        endpoint.emit("message", null);
        endpoint.emit("message", { other: 1 });
        endpoint.emit("message", { [CLUSTER_FRAME]: { kind: "nope" } });
        endpoint.emit("message", {
            [CLUSTER_FRAME]: { kind: "request", id: 1 },
        });
        expect(endpoint.sent).toEqual([]);
    });
});

describe("ShardManager inside a cluster", () => {
    /** A manager wired to a fake parent that grants every IDENTIFY. */
    function inCluster(
        over: Partial<ClusterContext> = {},
        options: Partial<ConstructorParameters<typeof ShardManager>[0]> = {},
    ) {
        const endpoint = new FakeEndpoint();
        const ctx = context(over);
        const worker = new ClusterWorker(ctx, endpoint as never);
        endpoint.parent = (body) => {
            if (body.kind === "identify")
                endpoint.fromParent({ kind: "identify-grant", id: body.id });
        };
        const manager = new ShardManager({
            token: "t",
            intents: [],
            cluster: ctx,
            worker,
            handshakeTimeout: 1,
            ...options,
        });
        return { manager, endpoint, worker };
    }

    const stubConnect = (log: string[] = []) => {
        Gateway.prototype.connect = async function () {
            log.push("connect");
        };
        return log;
    };

    test("owns only the cluster's shards but knows the total", () => {
        const { manager } = inCluster();
        expect(manager.shardIds).toEqual([1, 4]);
        expect(manager.shardCount).toBe(6);
        expect([...manager.shards.keys()]).toEqual([1, 4]);
        // The guild-to-shard mapping still uses the deployment's total.
        const guild = (BigInt(7) << 22n).toString();
        expect(manager.getShardIdForGuild(guild)).toBe(1);
        manager.destroy();
    });

    test("validates its options against the worker contract", () => {
        const make = (
            options: Partial<ConstructorParameters<typeof ShardManager>[0]>,
        ) => inCluster({}, options).manager;
        expect(() => make({ shardCount: "auto" })).toThrow(/ClusterManager/);
        expect(() => make({ shardCount: 8 })).toThrow(/differs/);
        expect(() => make({ autoScaleInterval: 5000 })).toThrow(TypeError);
        expect(() => make({ shardIds: [0] })).toThrow(/subset/);
        expect(make({ shardIds: [4], shardCount: 6 }).shardIds).toEqual([4]);
    });

    test("explicit shardIds outside a cluster are validated", async () => {
        const base = { token: "t", intents: [], cluster: false } as const;
        expect(
            new ShardManager({ ...base, shardCount: 4, shardIds: [2, 3] })
                .shardIds,
        ).toEqual([2, 3]);
        expect(
            () => new ShardManager({ ...base, shardCount: 4, shardIds: [4] }),
        ).toThrow(/outside 0-3/);
        expect(
            () =>
                new ShardManager({ ...base, shardCount: 4, shardIds: [1, 1] }),
        ).toThrow(/twice/);
        const original = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(JSON.stringify({ shards: 2 }), {
                status: 200,
            })) as never;
        try {
            const manager = new ShardManager({
                ...base,
                shardCount: "auto",
                shardIds: [5],
            });
            await expect(manager.connect()).rejects.toThrow(/outside 0-1/);
        } finally {
            globalThis.fetch = original;
        }
    });

    test("every IDENTIFY goes through the parent: acquire, connect, release", async () => {
        const order: string[] = [];
        Gateway.prototype.connect = async function () {
            order.push("connect");
        };
        const { manager, endpoint } = inCluster();
        const original = endpoint.send.bind(endpoint);
        endpoint.send = (frame: Frame) => {
            const body = frame[CLUSTER_FRAME] as Frame;
            if (body.kind === "identify" || body.kind === "identify-done")
                order.push(`${body.kind}:${body.shardId}`);
            return original(frame);
        };
        await manager.connect();
        expect(order.filter((e) => e !== "connect")).toEqual([
            "identify:1",
            "identify:4",
            "identify-done:1",
            "identify-done:4",
        ]);
        // Each shard connected after its own request and before its release.
        expect(order.indexOf("identify:1")).toBeLessThan(
            order.indexOf("connect"),
        );
        expect(order.filter((e) => e === "connect")).toHaveLength(2);
        manager.destroy();
    });

    test("a failed connect still releases the slot, then fails the start", async () => {
        Gateway.prototype.connect = async function () {
            throw new Error("socket refused");
        };
        const { manager, endpoint } = inCluster();
        await expect(manager.connect()).rejects.toThrow(
            "Failed to connect shard 1.",
        );
        expect(endpoint.frames("identify-done")).toHaveLength(2);
        expect(manager.shardCount).toBe(0);
    });

    test("a refused slot fails the start with the parent's reason", async () => {
        stubConnect();
        const { manager, endpoint } = inCluster();
        endpoint.parent = (body) => {
            if (body.kind === "identify")
                endpoint.fromParent({
                    kind: "identify-deny",
                    id: body.id,
                    error: "budget",
                });
        };
        const failure = await manager.connect().catch((error: Error) => error);
        expect((failure as Error).cause).toMatchObject({ message: "budget" });
    });

    test("without coordination it paces locally", async () => {
        const log = stubConnect();
        const { manager, endpoint } = inCluster(
            { coordinatedIdentify: false },
            { spawnDelay: 0 },
        );
        await manager.connect();
        expect(log).toHaveLength(2);
        expect(endpoint.frames("identify")).toHaveLength(0);
        manager.destroy();
    });

    test("announces ready once every shard is ready, and again after a drop", async () => {
        stubConnect();
        const { manager, endpoint } = inCluster();
        const events: string[] = [];
        manager.on("ready", () => events.push("ready"));
        await manager.connect();
        expect(manager.health().map((h) => h.status)).toEqual([
            "connecting",
            "connecting",
        ]);
        manager.shards.get(1)!.emit("ready");
        expect(endpoint.frames("ready")).toHaveLength(0);
        manager.shards.get(4)!.emit("ready");
        expect(events).toEqual(["ready"]);
        expect(endpoint.frames("ready")).toEqual([
            { kind: "ready", shardIds: [1, 4] },
        ]);
        expect(endpoint.frames("health")).toHaveLength(1);
        manager.shards.get(4)!.emit("ready"); // not announced twice
        expect(events).toEqual(["ready"]);

        manager.shards
            .get(4)!
            .emit("close", { code: 1006, action: "reconnect" });
        const dropped = manager.health().find((h) => h.id === 4)!;
        expect(dropped.status).toBe("disconnected");
        expect(dropped.disconnectedAt).toBeDefined();
        manager.shards.get(4)!.emit("resumed");
        expect(events).toEqual(["ready", "ready"]);
        expect(endpoint.frames("ready")).toHaveLength(2);

        manager.shards.get(1)!.emit("unstable", { reconnects: 5, delay: 100 });
        expect(manager.health().find((h) => h.id === 1)!.status).toBe(
            "unstable",
        );
        expect(manager.health().find((h) => h.id === 1)!.readyAt).toBeDefined();
        manager.destroy();
        expect(manager.health()).toEqual([]);
    });

    test("answers the parent's health request, with metrics only when asked", async () => {
        stubConnect();
        const { manager, endpoint } = inCluster();
        await manager.connect();
        endpoint.fromParent({
            kind: "request",
            id: "h1",
            type: REQUEST_HEALTH,
            data: { metrics: false },
        });
        endpoint.fromParent({
            kind: "request",
            id: "h2",
            type: REQUEST_HEALTH,
            data: { metrics: true },
        });
        await tick(5);
        const [plain, rich] = ["h1", "h2"].map(
            (id) =>
                endpoint.frames("reply").find((f) => f.id === id)!.result as {
                    shards: unknown[];
                    metrics?: Record<string, number>;
                },
        );
        expect(plain.shards).toHaveLength(2);
        expect(plain.metrics).toBeUndefined();
        expect(rich.metrics!.rssBytes).toBeGreaterThan(0);
        expect(rich.metrics!.heapUsedBytes).toBeGreaterThan(0);
        expect(manager.report().reportedAt).toBeGreaterThan(0);
        manager.destroy();
    });

    test("takes over another cluster's shards when assigned", async () => {
        const log = stubConnect();
        const { manager, endpoint } = inCluster();
        await manager.connect();
        manager.shards.get(1)!.emit("ready");
        manager.shards.get(4)!.emit("ready");
        endpoint.fromParent({
            kind: "request",
            id: "a1",
            type: REQUEST_ASSIGN,
            data: { shardIds: [0, 3] },
        });
        await tick(10);
        expect(
            endpoint.frames("reply").find((f) => f.id === "a1"),
        ).toMatchObject({
            result: { shardIds: [0, 3] },
        });
        expect(manager.shardIds.sort()).toEqual([0, 1, 3, 4]);
        expect(log).toHaveLength(4);
        // Not ready again until the new shards are.
        manager.shards.get(0)!.emit("ready");
        manager.shards.get(3)!.emit("ready");
        expect(endpoint.frames("ready").at(-1)).toEqual({
            kind: "ready",
            shardIds: [0, 1, 3, 4],
        });
        manager.destroy();
    });

    test("rejects bad assignments and keeps running shards when taking over fails", async () => {
        stubConnect();
        const { manager, endpoint } = inCluster();
        await manager.connect();
        const ask = async (id: string, data: unknown) => {
            endpoint.fromParent({
                kind: "request",
                id,
                type: REQUEST_ASSIGN,
                data,
            });
            await tick(10);
            return endpoint.frames("reply").find((f) => f.id === id)!;
        };
        expect((await ask("x1", { shardIds: "no" })).error).toMatch(/array/);
        expect((await ask("x2", { shardIds: [1] })).error).toMatch(
            /already owned/,
        );
        expect((await ask("x3", { shardIds: [9] })).error).toMatch(
            /outside 0-5/,
        );
        expect((await ask("x4", null)).error).toMatch(/array/);

        Gateway.prototype.connect = async function () {
            throw new Error("down");
        };
        expect((await ask("x5", { shardIds: [0] })).error).toMatch(
            /Failed to connect shard 0/,
        );
        // The new shard was rolled back; the running ones are untouched.
        expect(manager.shardIds.sort()).toEqual([1, 4]);
        expect(manager.shardCount).toBe(6);
        manager.destroy();
    });

    test("a manager that is not in a cluster behaves as before", async () => {
        const log = stubConnect();
        const manager = new ShardManager({
            token: "t",
            intents: [],
            shardCount: 3,
            spawnDelay: 0,
        });
        expect(manager.shardIds).toEqual([0, 1, 2]);
        await manager.connect();
        expect(log).toHaveLength(3);
        await manager.addShards([]); // nothing to do
        expect(() => manager.addShards([1])).toThrow;
        await expect(manager.addShards([1])).rejects.toThrow(/already owned/);
        manager.destroy();
        expect(manager.shardCount).toBe(0);
    });
});
