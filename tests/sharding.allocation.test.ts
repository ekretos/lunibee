import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { Client } from "../packages/core/src/index.ts";
import {
    ClusterManager,
    IdentifyCoordinator,
    ShardManager,
    connectInQueue,
    planClusters,
    readClusterContext,
    type ClusterManagerOptions,
    type ClusterPlanInfo,
    type IdentifyEvent,
} from "../packages/sharding/src/index.ts";
import { resolveShardCount } from "../packages/sharding/src/gateway-bot.ts";
import { fakeFork, tick } from "./helpers/fake-cluster.ts";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const plan = (
    shards: number,
    options: { clusterCount?: number; shardsPerCluster?: number } = {},
    defaultClusterCount = 4,
) => planClusters({ shardIds: range(shards), defaultClusterCount, ...options });

describe("planClusters", () => {
    test("Mode A, clusterCount: contiguous blocks, the remainder on the first clusters", () => {
        expect(plan(10, { clusterCount: 3 }).clusters).toEqual([
            [0, 1, 2, 3],
            [4, 5, 6],
            [7, 8, 9],
        ]);
        expect(plan(8, { clusterCount: 4 }).clusters).toEqual([
            [0, 1],
            [2, 3],
            [4, 5],
            [6, 7],
        ]);
        expect(plan(1, { clusterCount: 1 }).clusters).toEqual([[0]]);
        expect(plan(6, { clusterCount: 1 }).clusters).toEqual([range(6)]);
        expect(plan(10, { clusterCount: 3 }).source).toBe("clusterCount");
    });

    test("Mode B, shardsPerCluster: full clusters, a partial last one", () => {
        const result = plan(10, { shardsPerCluster: 4 });
        expect(result.clusters).toEqual([
            [0, 1, 2, 3],
            [4, 5, 6, 7],
            [8, 9],
        ]);
        expect(result).toMatchObject({
            source: "shardsPerCluster",
            requested: 3,
        });
        expect(plan(3, { shardsPerCluster: 10 }).clusters).toEqual([[0, 1, 2]]);
        expect(plan(4, { shardsPerCluster: 1 }).clusters).toEqual([
            [0],
            [1],
            [2],
            [3],
        ]);
    });

    test("Mode C, neither: the default count, never silently one", () => {
        const result = plan(8, {}, 4);
        expect(result.clusters).toHaveLength(4);
        expect(result.source).toBe("default");
    });

    test("more clusters than shards: capped at one shard each, the request recorded", () => {
        const result = plan(2, { clusterCount: 5 });
        expect(result.clusters).toEqual([[0], [1]]);
        expect(result.requested).toBe(5);
    });

    test("a slice of a larger deployment keeps its IDs", () => {
        expect(
            planClusters({
                shardIds: [4, 5, 6, 7, 8],
                clusterCount: 2,
                defaultClusterCount: 1,
            }).clusters,
        ).toEqual([
            [4, 5, 6],
            [7, 8],
        ]);
    });

    test("rejects zero, negative, fractional and conflicting values", () => {
        for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => plan(4, { clusterCount: bad })).toThrow(RangeError);
            expect(() => plan(4, { shardsPerCluster: bad })).toThrow(
                RangeError,
            );
            expect(() => plan(4, {}, bad)).toThrow(RangeError);
        }
        expect(() => plan(4, { clusterCount: 2, shardsPerCluster: 2 })).toThrow(
            /not both/,
        );
        expect(() =>
            planClusters({ shardIds: [], defaultClusterCount: 1 }),
        ).toThrow(/no shards/);
    });

    test("every shard exactly once, for every combination up to 40 shards", () => {
        for (let shards = 1; shards <= 40; shards++)
            for (let n = 1; n <= 12; n++)
                for (const options of [
                    { clusterCount: n },
                    { shardsPerCluster: n },
                ]) {
                    const { clusters } = plan(shards, options);
                    const all = clusters.flat();
                    expect(all).toEqual(range(shards)); // in order, none missing or twice
                    expect(clusters.every((c) => c.length > 0)).toBe(true);
                    if ("shardsPerCluster" in options) {
                        expect(clusters.length).toBe(Math.ceil(shards / n));
                        expect(
                            clusters.slice(0, -1).every((c) => c.length === n),
                        ).toBe(true);
                    } else {
                        const sizes = clusters.map((c) => c.length);
                        expect(
                            Math.max(...sizes) - Math.min(...sizes),
                        ).toBeLessThanOrEqual(1);
                        expect(clusters.length).toBe(Math.min(n, shards));
                    }
                }
    });
});

describe("guildsPerShard is a sizing hint", () => {
    test("never fewer shards than Discord recommends, and never ownership", async () => {
        const info = { shards: 8 } as Parameters<typeof resolveShardCount>[1];
        expect(
            await resolveShardCount("t", info, {
                guildsPerShard: 1000,
                guildCount: 3000,
            }),
        ).toBe(8);
        expect(
            await resolveShardCount("t", info, {
                guildsPerShard: 1000,
                guildCount: 20_000,
            }),
        ).toBe(20);
        expect(await resolveShardCount("t", info, {})).toBe(8);
    });
});

const managers: ClusterManager[] = [];
afterEach(async () => {
    for (const manager of managers.splice(0)) manager.killAll();
});

function setup(options: Partial<ClusterManagerOptions> = {}) {
    const forked = fakeFork();
    const manager = new ClusterManager({
        token: "t",
        script: "w.js",
        shardCount: 10,
        clusterCount: 3,
        spawnInterval: 0,
        restartDelay: 5,
        fork: forked.fork,
        ...options,
    });
    managers.push(manager);
    const errors: Error[] = [];
    const plans: ClusterPlanInfo[] = [];
    manager.on("error", (error) => errors.push(error));
    manager.on("plan", (p) => plans.push(p));
    return { manager, errors, plans, ...forked };
}

describe("ClusterManager startup", () => {
    test("spawns every configured cluster with its shards and the global shard count", async () => {
        const { manager, children, plans } = setup();
        await manager.spawn();
        expect(children.map((c) => c.env.SHARD_LIST)).toEqual([
            "0,1,2,3",
            "4,5,6",
            "7,8,9",
        ]);
        expect(children.map((c) => c.env.CLUSTER_ID)).toEqual(["0", "1", "2"]);
        for (const child of children)
            expect(child.env).toMatchObject({
                SHARD_COUNT: "10",
                CLUSTER_COUNT: "3",
            });
        expect(plans).toEqual([
            {
                totalShards: 10,
                clusterCount: 3,
                clusterCountSource: "clusterCount",
                requestedClusterCount: 3,
                clusters: [
                    { id: 0, shards: [0, 1, 2, 3] },
                    { id: 1, shards: [4, 5, 6] },
                    { id: 2, shards: [7, 8, 9] },
                ],
                maxConcurrency: 1,
                startup: "safe",
                identifyCoordinated: true,
            },
        ]);
        expect(children.every((c) => c.env.LUNIBEE_STARTUP === undefined)).toBe(
            true,
        );
    });

    test("shardsPerCluster spawns ceil(shards / size) clusters", async () => {
        const { manager, children } = setup({
            clusterCount: undefined,
            shardsPerCluster: 4,
        });
        await manager.spawn();
        expect(children.map((c) => c.env.SHARD_LIST)).toEqual([
            "0,1,2,3",
            "4,5,6,7",
            "8,9",
        ]);
        expect(children.every((c) => c.env.CLUSTER_COUNT === "3")).toBe(true);
    });

    test("is ready only once every cluster is ready", async () => {
        const { manager, children } = setup();
        await manager.spawn();
        let ready = false;
        const waiting = manager.ready().then(() => (ready = true));
        children[0]!.ready();
        children[1]!.ready();
        await tick();
        expect(ready).toBe(false);
        children[2]!.ready();
        await waiting;
        expect(manager.health().readyClusters).toBe(3);
    });

    test("a fork that throws fails that cluster only; it is retried and the others start", async () => {
        let calls = 0;
        const forked = fakeFork();
        const { manager, errors } = setup({
            fork: (script, env) => {
                if (++calls === 2) throw new Error("spawn EAGAIN");
                return forked.fork(script, env);
            },
        });
        await manager.spawn();
        expect(forked.children.map((c) => c.env.CLUSTER_ID)).toEqual([
            "0",
            "2",
        ]);
        expect(errors[0]!.message).toBe(
            "Cluster 1 (shards 4,5,6) could not be spawned: spawn EAGAIN",
        );
        // The restart policy brings it up.
        await tick(30);
        expect(forked.children.map((c) => c.env.CLUSTER_ID)).toEqual([
            "0",
            "2",
            "1",
        ]);
        expect(forked.children[2]!.env.SHARD_LIST).toBe("4,5,6");
    });

    test("a worker that dies during startup does not stop the clusters after it", async () => {
        const { manager, children, onFork } = setup({ restartOnExit: false });
        onFork((child) => {
            if (child.env.CLUSTER_ID === "0")
                queueMicrotask(() => child.exit(1, null));
        });
        await manager.spawn();
        await tick();
        expect(children.map((c) => c.env.CLUSTER_ID)).toEqual(["0", "1", "2"]);
        expect(manager.clusters.get(0)).toBeUndefined();
        expect(manager.clusters.get(1)?.state).toBe("starting");
    });

    test("a startup timeout kills the cluster; its restart owns the same shards, once", async () => {
        const { manager, children, onFork } = setup({ startTimeout: 15 });
        const timeouts: number[] = [];
        manager.on("clusterStartTimeout", (c) => timeouts.push(c.id));
        let starts = 0;
        onFork((child) => {
            // Cluster 1 hangs on its first start and is ready on the second.
            if (child.env.CLUSTER_ID !== "1")
                queueMicrotask(() => child.ready());
            else if (++starts === 2) queueMicrotask(() => child.ready());
        });
        await manager.spawn();
        await manager.ready();
        expect(timeouts).toEqual([1]);
        expect([...manager.assignments().keys()].sort((a, b) => a - b)).toEqual(
            range(10),
        );
        const one = children.filter((c) => c.env.CLUSTER_ID === "1");
        expect(one).toHaveLength(2);
        expect(one[0]!.kills).toEqual(["SIGKILL"]);
        expect(manager.clusterForShard(5)?.process).toBe(one[1] as never);
        expect(manager.health().readyClusters).toBe(3);
    });

    test("shutdownAll stops every worker and reports it", async () => {
        const { manager, children } = setup();
        const done: unknown[] = [];
        manager.on("shutdown", (info) => done.push(info));
        await manager.spawn();
        await manager.shutdownAll(20);
        expect(children.every((c) => c.kills.length > 0)).toBe(true);
        expect(done).toEqual([{ clusters: 3, durationMs: expect.any(Number) }]);
    });
});

describe("IDENTIFY queue", () => {
    function clock() {
        let now = 0;
        const timers: { at: number; fn: () => void }[] = [];
        return {
            now: () => now,
            schedule: (fn: () => void, ms: number) => {
                const timer = { at: now + ms, fn };
                timers.push(timer);
                return timer;
            },
            cancel: (handle: unknown) => {
                const index = timers.indexOf(handle as never);
                if (index !== -1) timers.splice(index, 1);
            },
            advance(ms: number) {
                now += ms;
                for (const timer of [...timers].sort((a, b) => a.at - b.at))
                    if (timer.at <= now) {
                        timers.splice(timers.indexOf(timer), 1);
                        timer.fn();
                    }
            },
        };
    }

    test("buckets IDENTIFY in parallel, one per bucket per interval, across clusters", async () => {
        const time = clock();
        const events: IdentifyEvent[] = [];
        const coordinator = new IdentifyCoordinator({
            maxConcurrency: 2,
            interval: 5000,
            ...time,
            onEvent: (e) => events.push(e),
        });
        const granted: number[] = [];
        const ask = (owner: number, shard: number) =>
            coordinator.acquire(owner, shard).then(() => granted.push(shard));
        void ask(0, 0);
        void ask(0, 1);
        void ask(1, 2);
        void ask(1, 3);
        await tick();
        expect(granted).toEqual([0, 1]); // buckets 0 and 1 together
        coordinator.release(0, 0);
        coordinator.release(0, 1);
        time.advance(4999);
        await tick();
        expect(granted).toEqual([0, 1]);
        time.advance(1);
        await tick();
        expect(granted).toEqual([0, 1, 2, 3]);
        expect(
            events
                .filter((e) => e.type === "granted")
                .map((e) => [e.shardId, e.bucket]),
        ).toEqual([
            [0, 0],
            [1, 1],
            [2, 0],
            [3, 1],
        ]);
        expect(
            events.find((e) => e.shardId === 2 && e.type === "granted")
                ?.waitedMs,
        ).toBe(5000);
        coordinator.close();
    });

    test("sequential startup: one shared bucket, whatever max_concurrency is", async () => {
        const { manager, children, plans } = setup({
            startup: "sequential",
            maxConcurrency: 16,
        });
        const identify: IdentifyEvent[] = [];
        manager.on("identify", (e) => identify.push(e));
        await manager.spawn();
        expect(plans[0]!.startup).toBe("sequential");
        expect(
            children.every((c) => c.env.LUNIBEE_STARTUP === "sequential"),
        ).toBe(true);
        expect(readClusterContext(children[0]!.env)?.startup).toBe(
            "sequential",
        );
        children[0]!.control({ kind: "identify", id: 1, shardId: 0 });
        children[1]!.control({ kind: "identify", id: 1, shardId: 4 });
        await tick();
        // Different max_concurrency buckets, yet the second waits for the first.
        expect(identify.map((e) => [e.type, e.shardId])).toEqual([
            ["queued", 0],
            ["granted", 0],
            ["queued", 4],
        ]);
        expect(() =>
            setup({ startup: "sequential", identify: { coordinate: false } }),
        ).toThrow(/needs IDENTIFY coordination/);
        expect(() => setup({ startup: "fast" as never })).toThrow(RangeError);
    });

    test("sequential startup: workers wait for READY as long as the parent holds the slot", async () => {
        const { manager, children } = setup({
            startup: "sequential",
            identify: { holdTimeout: 1500 },
        });
        await manager.spawn();
        expect(
            children.every((c) => c.env.LUNIBEE_READY_TIMEOUT === "1500"),
        ).toBe(true);
        expect(readClusterContext(children[0]!.env)?.readyTimeout).toBe(1500);
        const defaults = setup({ startup: "sequential" });
        await defaults.manager.spawn();
        expect(defaults.children[0]!.env.LUNIBEE_READY_TIMEOUT).toBe("60000");
        const safe = setup();
        await safe.manager.spawn();
        expect(safe.children[0]!.env.LUNIBEE_READY_TIMEOUT).toBeUndefined();
        expect(
            readClusterContext(safe.children[0]!.env)?.readyTimeout,
        ).toBeUndefined();
    });

    test("ShardManager readyTimeout must be a positive number of milliseconds", () => {
        for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY])
            expect(
                () =>
                    new ShardManager({
                        token: "t",
                        intents: [],
                        cluster: false,
                        readyTimeout: bad,
                    }),
            ).toThrow(
                "readyTimeout must be a positive number of milliseconds.",
            );
        expect(
            () =>
                new ShardManager({
                    token: "t",
                    intents: [],
                    cluster: false,
                    readyTimeout: 5000,
                }),
        ).not.toThrow();
    });

    class FakeGateway extends EventEmitter {
        public state = "CONNECT";
        public fail = false;
        public async connect(): Promise<void> {
            if (this.fail) throw new Error("connect failed");
            this.setState("IDENTIFY");
        }
        public setState(next: string): void {
            this.state = next;
            this.emit("stateChange", { next });
        }
    }

    function gate() {
        const log: string[] = [];
        return {
            log,
            acquire: async (id: number) => void log.push(`acquire ${id}`),
            release: (id: number) => void log.push(`release ${id}`),
        };
    }

    test("connectInQueue: safe mode frees the slot once IDENTIFY is sent, sequential once READY", async () => {
        const safe = gate();
        const gw = new FakeGateway();
        expect(await connectInQueue(gw as never, 3, safe)).toBe(true);
        expect(safe.log).toEqual(["acquire 3", "release 3"]);

        const strict = gate();
        const slow = new FakeGateway();
        let ready: boolean | undefined;
        const pending = connectInQueue(slow as never, 5, strict, {
            waitForReady: true,
        }).then((r) => (ready = r));
        await tick(5);
        expect(strict.log).toEqual(["acquire 5"]); // IDENTIFY sent, slot still held
        slow.emit("ready");
        await pending;
        expect(ready).toBe(true);
        expect(strict.log).toEqual(["acquire 5", "release 5"]);

        const late = gate();
        expect(
            await connectInQueue(new FakeGateway() as never, 6, late, {
                waitForReady: true,
                readyTimeout: 10,
            }),
        ).toBe(false);
        expect(late.log).toEqual(["acquire 6", "release 6"]);
    });

    test("connectInQueue: a failed connect still frees the slot, and a stale start does not connect", async () => {
        const failing = gate();
        const gw = new FakeGateway();
        gw.fail = true;
        await expect(connectInQueue(gw as never, 1, failing)).rejects.toThrow(
            "connect failed",
        );
        expect(failing.log).toEqual(["acquire 1", "release 1"]);
        const stale = gate();
        const idle = new FakeGateway();
        expect(
            await connectInQueue(idle as never, 2, stale, {
                cancelled: () => true,
            }),
        ).toBe(false);
        expect(idle.state).toBe("CONNECT");
        expect(stale.log).toEqual(["acquire 2", "release 2"]);
    });
});

describe("worker shard ownership", () => {
    const context = {
        clusterId: 1,
        clusterCount: 2,
        shardCount: 4,
        shardIds: [2, 3],
        coordinatedIdentify: false,
    };

    test("a cluster's ShardManager creates only its shards, with the global count", () => {
        const manager = new ShardManager({
            token: "t",
            intents: [],
            cluster: context,
            worker: false,
            identify: false,
        });
        // Shards exist once connect() resolves the count; the IDs are known now.
        expect(manager.shardIds).toEqual([2, 3]);
        expect(
            () =>
                new ShardManager({
                    token: "t",
                    intents: [],
                    cluster: context,
                    worker: false,
                    shardCount: 2,
                }),
        ).toThrow(/differs from the cluster's 4/);
        expect(
            () =>
                new ShardManager({
                    token: "t",
                    intents: [],
                    cluster: context,
                    worker: false,
                    shardIds: [0],
                }),
        ).toThrow(/subset/);
    });

    test("the worker contract is validated", () => {
        const env = {
            LUNIBEE_CLUSTER_WORKER: "1",
            SHARD_COUNT: "4",
            SHARD_LIST: "2,3",
            CLUSTER_ID: "1",
            CLUSTER_COUNT: "2",
        };
        expect(readClusterContext(env)?.shardIds).toEqual([2, 3]);
        expect(() => readClusterContext({ ...env, CLUSTER_ID: "2" })).toThrow(
            /outside the 2 cluster/,
        );
        expect(() => readClusterContext({ ...env, SHARD_LIST: "" })).toThrow(
            /no shards/,
        );
        expect(() => readClusterContext({ ...env, SHARD_LIST: "2,4" })).toThrow(
            /outside 0-3/,
        );
    });

    test("a Client in a cluster worker must run one of the cluster's shards with the global count", async () => {
        const keys = [
            "LUNIBEE_CLUSTER_WORKER",
            "SHARD_COUNT",
            "SHARD_LIST",
            "CLUSTER_ID",
            "CLUSTER_COUNT",
        ];
        const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
        Object.assign(process.env, {
            LUNIBEE_CLUSTER_WORKER: "1",
            SHARD_COUNT: "4",
            SHARD_LIST: "2,3",
            CLUSTER_ID: "1",
            CLUSTER_COUNT: "2",
        });
        try {
            const make = (gateway?: {
                shardId?: number;
                shardCount?: number;
            }) =>
                new Client({
                    token: "a.b.c",
                    intents: [],
                    ...(gateway ? { gateway } : {}),
                });
            await expect(make().login()).rejects.toThrow(
                /cluster 1's worker: use new Client\(\{ …, gateway: \{ shardId, shardCount: 4 \} \}\) with shardId one of 2, 3/,
            );
            await expect(
                make({ shardId: 0, shardCount: 4 }).login(),
            ).rejects.toThrow(
                /Shard 0 belongs to another cluster; cluster 1 runs 2, 3/,
            );
            await expect(
                make({ shardId: 2, shardCount: 8 }).login(),
            ).rejects.toThrow(/deployment's 4 shards/);
        } finally {
            for (const key of keys)
                if (saved[key] === undefined) delete process.env[key];
                else process.env[key] = saved[key];
        }
    });
});
