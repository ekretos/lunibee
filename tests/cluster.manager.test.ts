import { afterEach, describe, expect, test } from "bun:test";
import {
    ClusterManager,
    type ClusterManagerOptions,
} from "../packages/sharding/src/index.ts";
import { CLUSTER_FRAME } from "../packages/sharding/src/protocol.ts";
import { BUS_FRAME } from "../packages/sharding/src/transport.ts";
import { fakeFork, tick, type FakeChild } from "./helpers/fake-cluster.ts";

const managers: ClusterManager[] = [];
afterEach(async () => {
    for (const manager of managers.splice(0)) manager.killAll();
});

function setup(options: Partial<ClusterManagerOptions> = {}) {
    const forked = fakeFork();
    const manager = new ClusterManager({
        token: "t",
        script: "w.js",
        shardCount: 4,
        clusterCount: 2,
        spawnInterval: 0,
        restartDelay: 5,
        fork: forked.fork,
        ...options,
    });
    managers.push(manager);
    const errors: Error[] = [];
    manager.on("error", (error) => errors.push(error));
    return { manager, errors, ...forked };
}

async function readyAll(children: FakeChild[]): Promise<void> {
    for (const child of children) child.ready();
    await tick();
}

describe("allocation and the worker contract", () => {
    test("every shard is owned by exactly one cluster", async () => {
        const { manager, children } = setup({ shardCount: 7, clusterCount: 3 });
        await manager.spawn();
        expect(children.map((c) => c.env.SHARD_LIST)).toEqual([
            "0,3,6",
            "1,4",
            "2,5",
        ]);
        const all = children.flatMap((c) => c.shards).sort((a, b) => a - b);
        expect(all).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect([...manager.assignments()].sort((a, b) => a[0] - b[0])).toEqual([
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 0],
            [4, 1],
            [5, 2],
            [6, 0],
        ]);
        expect(manager.clusterForShard(4)?.id).toBe(1);
        expect(manager.clusterForShard(99)).toBeUndefined();
        for (const [index, child] of children.entries()) {
            expect(child.env).toMatchObject({
                CLUSTER_ID: String(index),
                CLUSTER_COUNT: "3",
                SHARD_COUNT: "7",
                LUNIBEE_CLUSTER_WORKER: "1",
                LUNIBEE_SHARD_BUS: "ipc",
                LUNIBEE_IDENTIFY: "coordinated",
            });
        }
    });

    test("shardsPerCluster sets the cluster count; one shard per cluster works", async () => {
        const a = setup({
            shardCount: 5,
            clusterCount: undefined,
            shardsPerCluster: 2,
        });
        await a.manager.spawn();
        expect(a.children.map((c) => c.env.SHARD_LIST)).toEqual([
            "0,3",
            "1,4",
            "2",
        ]);

        const b = setup({ shardCount: 3, clusterCount: 3 });
        await b.manager.spawn();
        expect(b.children.map((c) => c.env.SHARD_LIST)).toEqual([
            "0",
            "1",
            "2",
        ]);
    });

    test("more clusters than shards forks only the clusters that have shards", async () => {
        const { manager, children } = setup({ shardCount: 2, clusterCount: 5 });
        await manager.spawn();
        expect(children).toHaveLength(2);
        expect(children.every((c) => c.env.CLUSTER_COUNT === "2")).toBe(true);
    });

    test("shardIds runs a slice of a larger deployment", async () => {
        const { manager, children } = setup({
            shardCount: 8,
            shardIds: [4, 5, 6, 7],
        });
        await manager.spawn();
        expect(children.map((c) => c.env.SHARD_LIST)).toEqual(["4,6", "5,7"]);
        expect(children.every((c) => c.env.SHARD_COUNT === "8")).toBe(true);
        expect(manager.shardCount).toBe(8);
        expect(manager.clusterForShard(0)).toBeUndefined();
    });

    test("rejects invalid configuration", async () => {
        const make = (options: Partial<ClusterManagerOptions>) =>
            new ClusterManager({ token: "t", script: "w.js", ...options });
        expect(() => make({ clusterCount: 2, shardsPerCluster: 2 })).toThrow(
            /either/,
        );
        expect(() => make({ clusterCount: 0 })).toThrow(RangeError);
        expect(() => make({ shardsPerCluster: 1.5 })).toThrow(RangeError);
        expect(() => make({ maxConcurrency: 0 })).toThrow(RangeError);
        expect(() => make({ spawnInterval: -1 })).toThrow(RangeError);
        expect(() => make({ shardCount: 4, shardIds: [4] })).toThrow(
            RangeError,
        );
        expect(() => make({ shardCount: 4, shardIds: [1, 1] })).toThrow(
            /twice/,
        );
        const { manager } = setup({
            shardCount: "auto" as never,
            shardIds: [9],
        });
        const original = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(JSON.stringify({ shards: 3 }), {
                status: 200,
            })) as never;
        try {
            await expect(manager.spawn()).rejects.toThrow(/outside 0-2/);
        } finally {
            globalThis.fetch = original;
        }
    });

    test("a failed spawn can be retried", async () => {
        const { manager, children } = setup({ shardCount: "auto" });
        const original = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response("{}", { status: 500 })) as never;
        try {
            await expect(manager.spawn()).rejects.toThrow(/status 500/);
            globalThis.fetch = (async () =>
                new Response(JSON.stringify({ shards: 2 }), {
                    status: 200,
                })) as never;
            await manager.spawn();
            expect(children).toHaveLength(2);
        } finally {
            globalThis.fetch = original;
        }
    });

    test("auto count reads max_concurrency and the budget from /gateway/bot", async () => {
        const { manager, children } = setup({
            shardCount: "auto",
            maxConcurrency: 1,
        });
        const original = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(
                JSON.stringify({
                    shards: 4,
                    session_start_limit: {
                        total: 1000,
                        remaining: 999,
                        reset_after: 1000,
                        max_concurrency: 16,
                    },
                }),
                { status: 200 },
            )) as never;
        try {
            await manager.spawn();
            expect(children).toHaveLength(2);
            // The option may lower Discord's max_concurrency, so shards 0 and
            // 1 share a key and cannot IDENTIFY together.
            children[0]!.control({ kind: "identify", id: 1, shardId: 0 });
            children[1]!.control({ kind: "identify", id: 1, shardId: 1 });
            await tick();
            expect(children[0]!.controlFrames("identify-grant")).toHaveLength(
                1,
            );
            expect(children[1]!.controlFrames("identify-grant")).toHaveLength(
                0,
            );
        } finally {
            globalThis.fetch = original;
        }
    });

    test("fetchLimits asks Discord even for a fixed count, and survives failure", async () => {
        const { manager, children, errors } = setup({
            fetchLimits: true,
            maxConcurrency: 2,
        });
        const original = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response("{}", { status: 401 })) as never;
        try {
            await manager.spawn();
            expect(children).toHaveLength(2);
            expect(errors.map((e) => e.message)).toEqual([
                "Gateway discovery failed with status 401",
            ]);
        } finally {
            globalThis.fetch = original;
        }
    });
});

describe("lifecycle", () => {
    test("spawn is idempotent and concurrent calls share one start", async () => {
        const { manager, children } = setup();
        const [a, b] = [manager.spawn(), manager.spawn()];
        expect(a).toBe(b);
        await Promise.all([a, b]);
        await manager.spawn();
        expect(children).toHaveLength(2);
    });

    test("readiness handshake, ready() and the ready event", async () => {
        const { manager, children } = setup();
        const events: string[] = [];
        manager.on("clusterSpawn", (c) => events.push(`spawn${c.id}`));
        manager.on("clusterReady", (c) => events.push(`ready${c.id}`));
        manager.on("ready", () => events.push("all"));
        await manager.spawn();
        expect(manager.health().state).toBe("starting");
        let resolved = false;
        void manager.ready().then(() => {
            resolved = true;
        });
        children[0]!.ready();
        await tick();
        expect(resolved).toBe(false);
        expect(manager.clusters.get(0)?.state).toBe("ready");
        children[1]!.ready();
        await tick();
        expect(resolved).toBe(true);
        expect(events).toEqual(["spawn0", "spawn1", "ready0", "ready1", "all"]);
        expect(manager.health().state).toBe("ready");
        await manager.ready(); // already ready
    });

    test("waitForReady holds spawn() until every cluster reported", async () => {
        const { manager, children } = setup({ waitForReady: true });
        let spawned = false;
        const promise = manager.spawn().then(() => {
            spawned = true;
        });
        await tick(5);
        expect(spawned).toBe(false);
        await readyAll(children);
        await promise;
        expect(spawned).toBe(true);
    });

    test("ready() times out, and rejects when the manager stops", async () => {
        const { manager } = setup();
        await manager.spawn();
        await expect(manager.ready(10)).rejects.toThrow(
            /not all ready within 10ms/,
        );
        const waiting = manager.ready();
        const failure = waiting.catch((error: Error) => error.message);
        await manager.shutdownAll();
        expect(await failure).toMatch(/stopping/);
    });

    test("a cluster that never becomes ready is killed and restarted (startTimeout)", async () => {
        const { manager, children } = setup({
            shardCount: 1,
            clusterCount: 1,
            startTimeout: 15,
        });
        const timeouts: number[] = [];
        manager.on("clusterStartTimeout", (c) => timeouts.push(c.id));
        await manager.spawn();
        await tick(40);
        expect(timeouts[0]).toBe(0);
        expect(children[0]!.kills).toEqual(["SIGKILL"]);
        expect(children.length).toBeGreaterThanOrEqual(2);
    });

    test("a ready cluster is not subject to startTimeout", async () => {
        const { manager, children } = setup({
            shardCount: 1,
            clusterCount: 1,
            startTimeout: 15,
        });
        await manager.spawn();
        children[0]!.ready();
        await tick(40);
        expect(children[0]!.kills).toEqual([]);
        expect(children).toHaveLength(1);
    });

    test("ready frames for shards the cluster does not own are rejected", async () => {
        const { manager, children, errors } = setup();
        await manager.spawn();
        children[0]!.ready([1]);
        await tick();
        expect(manager.clusters.get(0)?.state).toBe("starting");
        expect(errors[0]!.message).toMatch(/does not own/);
    });

    test("malformed control frames are reported, the bot's own IPC traffic is ignored", async () => {
        const { manager, children, errors } = setup();
        await manager.spawn();
        children[0]!.emit("message", { [CLUSTER_FRAME]: { kind: "nope" } });
        children[0]!.emit("message", { custom: "bot message" });
        children[0]!.emit("message", "text");
        children[0]!.emit("message", null);
        await tick();
        expect(errors).toHaveLength(1);
        expect(errors[0]!.message).toMatch(/malformed/);
    });

    test("graceful shutdown is idempotent, concurrent-safe and kills nothing twice", async () => {
        const { manager, children } = setup();
        await manager.spawn();
        await Promise.all([manager.shutdownAll(), manager.shutdownAll()]);
        await manager.shutdownAll();
        expect(children.every((c) => c.kills.length === 1)).toBe(true);
        expect(manager.clusters.size).toBe(0);
        expect(manager.health().state).toBe("stopped");
    });

    test("shutdown during a slow start stops forking", async () => {
        const { manager, children } = setup({
            shardCount: 6,
            clusterCount: 6,
            spawnInterval: 10_000,
        });
        const starting = manager.spawn();
        await tick();
        expect(children).toHaveLength(1);
        await manager.shutdownAll();
        await starting;
        expect(children).toHaveLength(1);
    });

    test("can start again after shutdown, and repeated cycles leave no listeners", async () => {
        const { manager, children } = setup();
        for (let cycle = 0; cycle < 4; cycle++) {
            await manager.spawn();
            await readyAll(children.slice(-2));
            await manager.shutdownAll();
        }
        expect(children).toHaveLength(8);
        for (const child of children) {
            expect(child.listenerCount("message")).toBe(0);
            expect(child.kills).toEqual(["SIGTERM"]);
        }
        // Pending identify requests were rejected: a late request is denied.
        children.at(-1)!.control({ kind: "identify", id: 9, shardId: 0 });
        await tick();
        expect(manager.clusters.size).toBe(0);
    });

    test("killAll() does not trigger a restart", async () => {
        const { manager, children } = setup({ restartDelay: 1 });
        await manager.spawn();
        manager.killAll();
        await tick(20);
        expect(children).toHaveLength(2);
        expect(children.every((c) => c.kills.length === 1)).toBe(true);
    });

    test("force-kills a child that ignores SIGTERM", async () => {
        const { manager, children, onFork } = setup({ clusterCount: 1 });
        onFork((c) => (c.ignoreTerm = true));
        await manager.spawn();
        await manager.shutdownAll(10);
        expect(children[0]!.kills).toEqual(["SIGTERM", "SIGKILL"]);
    });

    test("respawn replaces the fleet with a new shard count", async () => {
        const { manager, children } = setup();
        await manager.spawn();
        await manager.respawn(6);
        expect(manager.shardCount).toBe(6);
        expect(children).toHaveLength(4);
        expect(children[2]!.env.SHARD_COUNT).toBe("6");
        expect([...manager.assignments().keys()].sort()).toEqual([
            0, 1, 2, 3, 4, 5,
        ]);
    });
});

describe("crash recovery", () => {
    test("restarts a crashed cluster with the same shards and counts restarts", async () => {
        const { manager, children } = setup();
        const log: string[] = [];
        manager.on("clusterExit", (c, code, _s, expected) =>
            log.push(`exit${c.id}:${code}:${expected}`),
        );
        manager.on("clusterRestart", (c, i) =>
            log.push(`restart${c.id}:#${i.attempt}`),
        );
        await manager.spawn();
        await readyAll(children);
        children[0]!.exit(1, null);
        expect(manager.clusters.has(0)).toBe(false);
        expect(manager.health().clusters[0]!.state).toBe("restarting");
        expect(manager.health().state).toBe("degraded");
        expect(manager.health().missingShards).toEqual([0, 2]);
        await tick(20);
        expect(children).toHaveLength(3);
        expect(children[2]!.env.SHARD_LIST).toBe("0,2");
        expect(manager.clusters.get(0)?.process).toBe(children[2] as never);
        expect(manager.clusters.get(0)?.restarts).toBe(1);
        expect(log).toEqual(["exit0:1:false", "restart0:#1"]);
        children[2]!.ready();
        await tick();
        expect(manager.health().state).toBe("ready");
        expect(manager.health().clusters[0]).toMatchObject({
            restarts: 1,
            state: "ready",
        });
    });

    test("backoff, jitter-free delays and the restart limit", async () => {
        const { manager, children } = setup({
            clusterCount: 1,
            shardCount: 1,
            supervisor: {
                restartDelay: 5,
                backoff: 2,
                maxRestarts: 2,
                window: 60_000,
            },
        });
        const delays: number[] = [];
        const unstable: number[] = [];
        let gaveUp = 0;
        manager.on("clusterRestart", (_c, i) => delays.push(i.delay));
        manager.on("clusterUnstable", (_c, i) => unstable.push(i.attempt));
        manager.on("clusterGiveUp", () => gaveUp++);
        await manager.spawn();
        children[0]!.exit(1, null);
        await tick(15);
        children[1]!.exit(1, null);
        await tick(25);
        children[2]!.exit(1, null);
        await tick(10);
        expect(delays).toEqual([5, 10]);
        expect(gaveUp).toBe(1);
        expect(children).toHaveLength(3);
        expect(manager.health().clusters[0]!.state).toBe("failed");
        expect(unstable).toEqual([]);
    });

    test("repeated restarts raise clusterUnstable", async () => {
        const { manager, children } = setup({
            clusterCount: 1,
            shardCount: 1,
            restartDelay: 1,
        });
        const unstable: number[] = [];
        manager.on("clusterUnstable", (_c, i) => unstable.push(i.attempt));
        await manager.spawn();
        for (let i = 0; i < 3; i++) {
            children.at(-1)!.exit(1, null);
            await tick(10);
        }
        expect(unstable).toEqual([3]);
    });

    test("restartOnExit: false leaves the cluster failed", async () => {
        const { manager, children } = setup({ restartOnExit: false });
        await manager.spawn();
        children[0]!.exit(1, null);
        await tick(15);
        expect(children).toHaveLength(2);
        expect(manager.health().clusters[0]!.state).toBe("failed");
    });

    test("a crash before the cluster was ready is recovered the same way", async () => {
        const { manager, children } = setup({ clusterCount: 1, shardCount: 2 });
        await manager.spawn();
        children[0]!.exit(137, null);
        await tick(15);
        expect(children).toHaveLength(2);
        expect(manager.clusters.get(0)?.state).toBe("starting");
    });

    test("a stale process's late messages and exit are ignored after restart", async () => {
        const { manager, children } = setup({ clusterCount: 1, shardCount: 2 });
        await manager.spawn();
        children[0]!.exit(1, null);
        await tick(15);
        children[0]!.ready();
        children[0]!.emit("exit", 1, null);
        await tick();
        expect(manager.clusters.get(0)?.state).toBe("starting");
        expect(children).toHaveLength(2);
    });

    test("a transient problem in one shard does not restart a healthy cluster", async () => {
        const { manager, children } = setup();
        await manager.spawn();
        await readyAll(children);
        children[0]!.control({
            kind: "health",
            report: {
                shards: [
                    { id: 0, state: "reconnect", ping: -1, status: "unstable" },
                    { id: 2, state: "dispatch", ping: 20, status: "ready" },
                ],
                reportedAt: 5,
            },
        });
        await tick(20);
        expect(children).toHaveLength(2);
        expect(children[0]!.kills).toEqual([]);
        expect(manager.health().clusters[0]!.shards[0]!.status).toBe(
            "unstable",
        );
        expect(manager.health().state).toBe("ready");
    });

    test("consumer callbacks may throw without breaking supervision", async () => {
        const { manager, children } = setup({
            clusterCount: 1,
            shardCount: 1,
            supervisor: { maxRestarts: 0 },
            onClusterExit: () => {
                throw new Error("x");
            },
            onGiveUp: () => {
                throw new Error("y");
            },
        });
        manager.on("clusterExit", () => {
            throw new Error("listener");
        });
        await manager.spawn();
        children[0]!.exit(1, null);
        expect(manager.health().clusters[0]!.state).toBe("failed");
    });
});

describe("IDENTIFY coordination across clusters", () => {
    const identify = (child: FakeChild, id: number, shardId: number) =>
        child.control({ kind: "identify", id, shardId });
    const grants = (child: FakeChild) =>
        child.controlFrames("identify-grant").map((f) => f.id);

    test("one IDENTIFY per key per interval, whichever cluster asks", async () => {
        const { manager, children } = setup({
            maxConcurrency: 1,
            identify: { interval: 30 },
        });
        await manager.spawn();
        identify(children[0]!, 1, 0);
        identify(children[1]!, 1, 1);
        identify(children[0]!, 2, 2);
        await tick();
        expect(grants(children[0]!)).toEqual([1]);
        expect(grants(children[1]!)).toEqual([]);
        children[0]!.control({ kind: "identify-done", shardId: 0 });
        await tick(15);
        expect(grants(children[1]!)).toEqual([]);
        await tick(25);
        expect(grants(children[1]!)).toEqual([1]);
        children[1]!.control({ kind: "identify-done", shardId: 1 });
        await tick(40);
        expect(grants(children[0]!)).toEqual([1, 2]);
    });

    test("max_concurrency lets different keys IDENTIFY together", async () => {
        const { manager, children } = setup({ maxConcurrency: 2 });
        await manager.spawn();
        identify(children[0]!, 1, 0);
        identify(children[1]!, 1, 1);
        await tick();
        expect(grants(children[0]!)).toEqual([1]);
        expect(grants(children[1]!)).toEqual([1]);
    });

    test("a request for a shard the cluster does not own is denied", async () => {
        const { manager, children } = setup();
        await manager.spawn();
        identify(children[0]!, 7, 1);
        await tick();
        expect(children[0]!.controlFrames("identify-deny")[0]).toMatchObject({
            id: 7,
            error: expect.stringMatching(/does not belong to cluster 0/),
        });
    });

    test("a crashed cluster's slot and queue are released for the others", async () => {
        const { manager, children } = setup({
            maxConcurrency: 1,
            identify: { interval: 5 },
        });
        await manager.spawn();
        identify(children[0]!, 1, 0);
        identify(children[1]!, 1, 1);
        await tick();
        expect(grants(children[1]!)).toEqual([]);
        children[0]!.exit(1, null); // dies holding the slot
        await tick(30);
        expect(grants(children[1]!)).toEqual([1]);
    });

    test("coordinate: false tells workers to pace themselves and denies requests", async () => {
        const { manager, children } = setup({
            identify: { coordinate: false },
        });
        await manager.spawn();
        expect(children[0]!.env.LUNIBEE_IDENTIFY).toBe("local");
        identify(children[0]!, 1, 0);
        await tick();
        expect(children[0]!.controlFrames("identify-deny")[0]!.error).toMatch(
            /coordination is off/,
        );
    });

    test("waits for the budget to reset and announces it", async () => {
        const { manager, children } = setup({
            shardCount: "auto",
            maxConcurrency: 2,
        });
        const original = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(
                JSON.stringify({
                    shards: 4,
                    session_start_limit: {
                        total: 1000,
                        remaining: 1,
                        reset_after: 60,
                        max_concurrency: 16,
                    },
                }),
                { status: 200 },
            )) as never;
        const waits: number[] = [];
        manager.on("identifyWait", (w) => waits.push(w.shardId));
        try {
            await manager.spawn();
            identify(children[0]!, 1, 0);
            identify(children[1]!, 1, 1);
            await tick();
            expect(grants(children[0]!)).toEqual([1]);
            expect(grants(children[1]!)).toEqual([]);
            expect(waits).toEqual([1]);
            await tick(90);
            expect(grants(children[1]!)).toEqual([1]);
        } finally {
            globalThis.fetch = original;
        }
    });

    test("shutdown rejects waiting IDENTIFY requests", async () => {
        const { manager, children } = setup({ maxConcurrency: 1 });
        await manager.spawn();
        identify(children[0]!, 1, 0);
        identify(children[1]!, 1, 1);
        await tick();
        await manager.shutdownAll();
        await tick();
        expect(grants(children[1]!)).toEqual([]);
    });
});

describe("routing and requests", () => {
    const message = (
        source: number,
        target: number | null,
        extra: Record<string, unknown> = {},
    ) => ({ source, target, type: "ping", data: 1, id: "m", ...extra });

    test("a shard-targeted message reaches only the owning cluster", async () => {
        const { manager, children } = setup({ shardCount: 6, clusterCount: 3 });
        await manager.spawn();
        children[0]!.bus(message(0, 4)); // shard 4 lives on cluster 1
        await tick();
        expect(children[1]!.busFrames()).toHaveLength(1);
        expect(children[2]!.busFrames()).toHaveLength(0);
        expect(children[0]!.busFrames()).toHaveLength(0);
    });

    test("a broadcast reaches every other cluster, not the sender", async () => {
        const { manager, children } = setup({ shardCount: 6, clusterCount: 3 });
        await manager.spawn();
        children[1]!.bus(message(1, null));
        await tick();
        expect(children.map((c) => c.busFrames().length)).toEqual([1, 0, 1]);
    });

    test("a message to a shard whose cluster is down fails fast with a peer-down notice", async () => {
        const { manager, children } = setup({ restartOnExit: false });
        await manager.spawn();
        children[1]!.exit(1, null);
        children[0]!.bus(message(0, 1));
        await tick();
        expect(children[0]!.peerDown().at(-1)).toEqual([1]);
        // Unknown shards and malformed messages are dropped quietly.
        children[0]!.bus(message(0, 99));
        children[0]!.bus({ type: 5 });
        children[0]!.bus({ ...message(0, 1.5) });
        children[0]!.emit("message", { [BUS_FRAME]: null });
        await tick();
        // One notice from the crash itself, one from the failed delivery.
        expect(children[0]!.peerDown()).toEqual([[1, 3], [1]]);
    });

    test("request() reaches the right cluster and returns the handler's result", async () => {
        const { manager, children } = setup({ shardCount: 6, clusterCount: 3 });
        await manager.spawn();
        const result = await manager.request<{ shard: number; echo: number }>(
            4,
            "stats",
            7,
        );
        expect(result).toEqual({ shard: 4, echo: 7 });
        expect(children[1]!.busFrames()).toHaveLength(1);
        expect(children[0]!.busFrames()).toHaveLength(0);
        expect(children[1]!.busFrames()[0]).toMatchObject({
            source: -1,
            target: 4,
            type: "stats",
            expectsReply: true,
        });
    });

    test("request() failures: handler error, timeout, unknown shard, down cluster, abort", async () => {
        const { manager, children, onFork } = setup({ restartOnExit: false });
        onFork((c) => {
            c.behavior.errorShards = new Set([0]);
            c.behavior.silentShards = new Set([3]);
        });
        await manager.spawn();
        await expect(manager.request(0, "x", null)).rejects.toThrow(
            "shard 0 failed",
        );
        await expect(
            manager.request(3, "x", null, { timeoutMs: 15 }),
        ).rejects.toThrow(/did not reply to "x" in time/);
        await expect(manager.request(42, "x", null)).rejects.toThrow(
            RangeError,
        );
        const controller = new AbortController();
        const aborted = manager.request(3, "x", null, {
            signal: controller.signal,
            timeoutMs: 10_000,
        });
        controller.abort();
        await expect(aborted).rejects.toThrow(/in time/);
        children[1]!.exit(1, null);
        await expect(manager.request(1, "x", null)).rejects.toThrow(
            /Shard 1 is down/,
        );
    });

    test("a cluster dying mid-request settles the request with an error", async () => {
        const { manager, children, onFork } = setup({ restartOnExit: false });
        onFork((c) => (c.behavior.silentShards = new Set([1])));
        await manager.spawn();
        const pending = manager.request(1, "x", null, { timeoutMs: 10_000 });
        await tick();
        children[1]!.exit(1, null);
        await expect(pending).rejects.toThrow(/Cluster 1 exited/);
    });

    test("an answer from a cluster that does not own the shard is ignored", async () => {
        const { manager, children, onFork } = setup();
        onFork((c) => (c.behavior.silentShards = new Set([0, 1, 2, 3])));
        await manager.spawn();
        const pending = manager.request(1, "x", null, { timeoutMs: 30 });
        await tick();
        const id = (children[1]!.busFrames()[0] as { id: string }).id;
        children[0]!.bus({
            source: 1,
            target: -1,
            type: "__lunibee:reply",
            id: "spoof",
            data: { requestId: id, result: "spoofed" },
        });
        await expect(pending).rejects.toThrow(/in time/);
    });

    test("broadcast() aggregates replies and reports missing shards", async () => {
        const { manager, children, onFork } = setup({
            shardCount: 6,
            clusterCount: 3,
            restartOnExit: false,
        });
        onFork((c) => {
            c.behavior.silentShards = new Set([5]);
            c.behavior.errorShards = new Set([2]);
        });
        await manager.spawn();
        children[0]!.exit(1, null); // shards 0 and 3 are down
        const result = await manager.broadcast<{ shard: number; echo: null }>(
            "stats",
            null,
            { timeoutMs: 40 },
        );
        const byShard = Object.fromEntries(
            result.replies.map((r) => [r.shardId, r]),
        );
        expect(Object.keys(byShard).sort()).toEqual(["1", "2", "4"]);
        expect(byShard[1]!.result).toEqual({ shard: 1, echo: null });
        expect(byShard[2]!.error).toBe("shard 2 failed");
        expect(result.missing).toEqual([0, 3, 5]);
    });

    test("broadcast() settles as soon as every shard answered", async () => {
        const { manager } = setup();
        await manager.spawn();
        const started = Date.now();
        const result = await manager.broadcast("stats", 1, { timeoutMs: 5000 });
        expect(Date.now() - started).toBeLessThan(500);
        expect(result.replies).toHaveLength(4);
        expect(result.missing).toEqual([]);
    });

    test("requestCluster() reaches a worker, with failure paths", async () => {
        const { manager, children, onFork } = setup({ restartOnExit: false });
        onFork((c) => {
            c.behavior.failRequests = new Map([["boom", "no way"]]);
            c.behavior.ignoreRequests = new Set(["hang"]);
        });
        await manager.spawn();
        expect(
            await manager.requestCluster<unknown>(1, "echo", { a: 1 }),
        ).toEqual({
            type: "echo",
            data: { a: 1 },
            cluster: "1",
        });
        await expect(manager.requestCluster(0, "boom", null)).rejects.toThrow(
            "no way",
        );
        await expect(
            manager.requestCluster(0, "hang", null, { timeoutMs: 15 }),
        ).rejects.toThrow(/did not reply/);
        await expect(manager.requestCluster(9, "x", null)).rejects.toThrow(
            RangeError,
        );
        children[0]!.exit(1, null);
        await expect(manager.requestCluster(0, "x", null)).rejects.toThrow(
            /Cluster 0 is/,
        );
    });

    test("pending requests are bounded and freed when they time out", async () => {
        const { manager, onFork } = setup({ maxPendingRequests: 2 });
        onFork((c) => (c.behavior.silentShards = new Set([0, 1, 2, 3])));
        await manager.spawn();
        const first = manager.request(0, "x", null, { timeoutMs: 20 });
        const second = manager.request(1, "x", null, { timeoutMs: 20 });
        const settled = Promise.allSettled([first, second]);
        await expect(manager.request(2, "x", null)).rejects.toThrow(/Too many/);
        expect((await settled).map((r) => r.status)).toEqual([
            "rejected",
            "rejected",
        ]);
        // Both slots were freed by the timeout.
        const third = manager.request(2, "x", null, { timeoutMs: 10 });
        await expect(third).rejects.toThrow(/in time/);
    });

    test("shutdown settles requests that are still waiting", async () => {
        const { manager, onFork } = setup();
        onFork((c) => (c.behavior.silentShards = new Set([0, 1, 2, 3])));
        await manager.spawn();
        const pending = manager.request(0, "x", null, { timeoutMs: 10_000 });
        const failure = pending.catch((error: Error) => error.message);
        await manager.shutdownAll();
        expect(await failure).toMatch(/in time/);
    });
});

describe("health", () => {
    test("reports lifecycle, uptime, pid and the last worker report", async () => {
        const { manager, children } = setup();
        expect(manager.health()).toMatchObject({ state: "idle", clusters: [] });
        await manager.spawn();
        await readyAll(children);
        const health = manager.health();
        expect(health).toMatchObject({
            state: "ready",
            totalShards: 4,
            readyClusters: 2,
            missingShards: [],
        });
        expect(health.clusters[0]).toMatchObject({
            id: 0,
            state: "ready",
            pid: children[0]!.pid,
            shardIds: [0, 2],
            restarts: 0,
        });
        expect(health.clusters[0]!.uptimeMs).toBeGreaterThanOrEqual(0);
        expect(health.clusters[0]!.lastReadyAt).toBeDefined();
        expect(health.clusters[0]!.shards).toEqual([]);
    });

    test("refreshHealth() asks each worker, with optional metrics", async () => {
        const { manager, children } = setup();
        await manager.spawn();
        await readyAll(children);
        const health = await manager.refreshHealth({ metrics: true });
        expect(health.clusters[1]!.shards.map((s) => s.id)).toEqual([1, 3]);
        expect(health.clusters[1]!.metrics).toEqual({
            rssBytes: 1,
            heapUsedBytes: 2,
            cpuUserMicros: 3,
            cpuSystemMicros: 4,
        });
        expect(health.clusters[1]!.reportedAt).toBe(123);
        const plain = await manager.refreshHealth();
        expect(plain.clusters[0]!.metrics).toBeUndefined();
    });

    test("a worker that does not answer keeps its last report", async () => {
        const { manager, children } = setup();
        await manager.spawn();
        await readyAll(children);
        await manager.refreshHealth();
        children[0]!.behavior.answerHealth = false;
        const health = await manager.refreshHealth({ timeoutMs: 15 });
        expect(health.clusters[0]!.shards).toHaveLength(2);
        expect(health.state).toBe("ready");
    });
});

describe("recovery by reassignment", () => {
    test("moves a failed cluster's shards to the cluster with the fewest, once it confirms", async () => {
        const { manager, children } = setup({
            shardCount: 5,
            clusterCount: 3,
            restartOnExit: true,
            supervisor: { maxRestarts: 0 },
            reassignOnGiveUp: true,
        });
        const moved: unknown[] = [];
        manager.on("shardsReassigned", (info) => moved.push(info));
        await manager.spawn();
        await readyAll(children);
        // Cluster 0 owns 0,3 (2 shards); clusters 1 and 2 own 1,4 and 2.
        children[0]!.exit(1, null);
        await tick(20);
        expect(moved).toEqual([{ shardIds: [0, 3], from: 0, to: 2 }]);
        expect(children[2]!.controlFrames("request")[0]).toMatchObject({
            type: "__lunibee:assign",
            data: { shardIds: [0, 3] },
        });
        expect(manager.clusterForShard(0)?.id).toBe(2);
        expect(manager.clusterForShard(3)?.id).toBe(2);
        expect(manager.health().clusters[0]).toMatchObject({
            state: "failed",
            shardIds: [],
        });
        // No shard has two owners.
        const owners = new Map<number, number>();
        for (const cluster of manager.health().clusters)
            for (const shard of cluster.shardIds) {
                expect(owners.has(shard)).toBe(false);
                owners.set(shard, cluster.id);
            }
        expect([...owners.keys()].sort()).toEqual([0, 1, 2, 3, 4]);
        // A later request for a moved shard goes to the new owner.
        await manager.request(0, "x", null);
        expect(children[2]!.busFrames().at(-1)).toMatchObject({ target: 0 });
    });

    test("without a ready cluster, or when the target refuses, ownership does not change", async () => {
        const a = setup({
            clusterCount: 1,
            shardCount: 2,
            supervisor: { maxRestarts: 0 },
            reassignOnGiveUp: true,
        });
        await a.manager.spawn();
        a.children[0]!.exit(1, null);
        await tick(10);
        expect(a.errors[0]!.message).toMatch(/No ready cluster/);
        expect(a.manager.clusterForShard(0)?.id).toBe(0);

        const b = setup({
            supervisor: { maxRestarts: 0 },
            reassignOnGiveUp: true,
        });
        b.onFork(
            (c) =>
                (c.behavior.failRequests = new Map([
                    ["__lunibee:assign", "no room"],
                ])),
        );
        await b.manager.spawn();
        await readyAll(b.children);
        b.children[0]!.exit(1, null);
        await tick(20);
        expect(b.errors[0]!.message).toMatch(
            /could not take over shards \[0,2\].*no room/,
        );
        expect(b.manager.clusterForShard(0)?.id).toBe(0);
        expect(b.manager.clusterForShard(2)?.id).toBe(0);
    });

    test("without reassignOnGiveUp a failed cluster's shards stay down", async () => {
        const { manager, children } = setup({ supervisor: { maxRestarts: 0 } });
        await manager.spawn();
        await readyAll(children);
        children[0]!.exit(1, null);
        await tick(20);
        expect(children[1]!.controlFrames("request")).toHaveLength(0);
        expect(manager.health().missingShards).toEqual([0, 2]);
    });
});

describe("payload limits", () => {
    const big = (n: number) => "x".repeat(n);

    test("an oversized shard-bus message from a worker is dropped, reported, and not relayed", async () => {
        const { manager, children, errors } = setup({ maxMessageBytes: 1000 });
        await manager.spawn();
        children[0]!.bus({
            source: 0,
            target: 1,
            type: "t",
            data: big(2000),
            id: "m1",
        });
        children[0]!.bus({
            source: 0,
            target: null,
            type: "t",
            data: { blob: big(2000) },
            id: "m2",
        });
        children[0]!.bus({
            source: 0,
            target: 1,
            type: "t",
            data: big(500),
            id: "m3",
        });
        await tick();
        expect(children[1]!.busFrames().map((m) => m.id)).toEqual(["m3"]);
        expect(errors).toHaveLength(2);
        expect(errors[0]!.message).toMatch(
            /more than 1000 bytes; it was not relayed/,
        );
    });

    test("only the documented envelope is relayed, and bad envelopes are dropped", async () => {
        const { manager, children } = setup({ maxMessageBytes: 1000 });
        await manager.spawn();
        const base = { source: 0, target: 1, type: "t", data: 1, id: "ok" };
        children[0]!.bus({ ...base, extra: big(900) } as never);
        children[0]!.bus({ ...base, id: "x".repeat(300) });
        children[0]!.bus({ ...base, type: "t".repeat(300) });
        children[0]!.bus({ ...base, source: 1.5 });
        await tick();
        const got = children[1]!.busFrames();
        expect(got.map((m) => m.id)).toEqual(["ok"]);
        expect(got[0]).not.toHaveProperty("extra");
    });

    test("a request waiting for an oversized answer settles at once", async () => {
        const { manager, children } = setup({ maxMessageBytes: 1000 });
        await manager.spawn();
        children[0]!.behavior.ignoreRequests = new Set(["huge"]);
        const pending = manager.requestCluster(0, "huge", null, {
            timeoutMs: 10_000,
        });
        await tick();
        const id = (children[0]!.controlFrames("request")[0] as { id: string })
            .id;
        const started = Date.now();
        children[0]!.control({ kind: "reply", id, result: big(5000) });
        await expect(pending).rejects.toThrow(
            /answered with more than 1000 bytes/,
        );
        expect(Date.now() - started).toBeLessThan(500);
    });

    test("an oversized health report is ignored and a cyclic payload counts as oversized", async () => {
        const { manager, children, errors } = setup({ maxMessageBytes: 1000 });
        await manager.spawn();
        children[0]!.control({
            kind: "health",
            report: {
                shards: [
                    {
                        id: 0,
                        state: "dispatch",
                        ping: 1,
                        status: "ready",
                        pad: big(3000),
                    },
                ],
                reportedAt: 1,
            },
        });
        expect(manager.health().clusters[0]!.shards).toEqual([]);
        expect(errors[0]!.message).toMatch(/health report/);
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        children[0]!.bus({
            source: 0,
            target: 1,
            type: "t",
            data: cycle,
            id: "c",
        });
        await tick();
        expect(children[1]!.busFrames()).toHaveLength(0);
    });

    test("requests this process sends are checked against the same limit", async () => {
        const { manager } = setup({ maxMessageBytes: 1000 });
        await manager.spawn();
        await expect(manager.request(0, "t", big(2000))).rejects.toThrow(
            RangeError,
        );
        await expect(manager.broadcast("t", { a: big(2000) })).rejects.toThrow(
            /maxMessageBytes/,
        );
        await expect(manager.requestCluster(0, "t", big(2000))).rejects.toThrow(
            RangeError,
        );
        expect(await manager.request(0, "t", big(900))).toBeDefined();
        expect(() => setup({ maxMessageBytes: 0 })).toThrow(RangeError);
    });

    test("a flood of oversized messages leaves nothing pending and the cluster running", async () => {
        const { manager, children, errors } = setup({ maxMessageBytes: 500 });
        await manager.spawn();
        for (let i = 0; i < 500; i++)
            children[0]!.bus({
                source: 0,
                target: 1,
                type: "t",
                data: big(600),
                id: `f${i}`,
            });
        await tick();
        expect(errors).toHaveLength(500);
        expect(children[1]!.busFrames()).toHaveLength(0);
        expect(children[0]!.kills).toEqual([]);
        expect(await manager.request(1, "t", null)).toBeDefined();
    });
});

describe("limits are counted in UTF-8 bytes", () => {
    // 3 bytes per CJK character, 4 per emoji, 1 per ASCII letter.
    const cjk = (n: number) => "漢".repeat(n);
    const emoji = (n: number) => "🙂".repeat(n);
    const relayed = async (data: string) => {
        const { manager, children, errors } = setup({ maxMessageBytes: 1000 });
        await manager.spawn();
        children[0]!.bus({ source: 0, target: 1, type: "t", data, id: "m" });
        await tick();
        return {
            delivered: children[1]!.busFrames().length === 1,
            errors: errors.length,
        };
    };

    test("a string is measured as it travels, not by its length", async () => {
        expect(await relayed("a".repeat(1000))).toEqual({
            delivered: true,
            errors: 0,
        });
        expect(await relayed("a".repeat(1001))).toEqual({
            delivered: false,
            errors: 1,
        });
        // 333 characters = 999 bytes fits; 334 characters = 1002 bytes does not.
        expect(await relayed(cjk(333))).toEqual({ delivered: true, errors: 0 });
        expect(await relayed(cjk(334))).toEqual({
            delivered: false,
            errors: 1,
        });
        // 250 emoji = 1000 bytes (500 code units) fits; 251 does not.
        expect(await relayed(emoji(250))).toEqual({
            delivered: true,
            errors: 0,
        });
        expect(await relayed(emoji(251))).toEqual({
            delivered: false,
            errors: 1,
        });
    });

    test("an object is measured as its JSON text in bytes", async () => {
        const { manager, children, errors } = setup({ maxMessageBytes: 1000 });
        await manager.spawn();
        // {"a":"…"} costs 8 bytes around the value.
        children[0]!.bus({
            source: 0,
            target: 1,
            type: "t",
            data: { a: cjk(330) },
            id: "ok",
        });
        children[0]!.bus({
            source: 0,
            target: 1,
            type: "t",
            data: { a: cjk(331) },
            id: "big",
        });
        await tick();
        expect(children[1]!.busFrames().map((m) => m.id)).toEqual(["ok"]);
        expect(errors).toHaveLength(1);
        await expect(manager.request(0, "t", { a: cjk(331) })).rejects.toThrow(
            RangeError,
        );
        // Within the limit, the request is sent (the fake worker stays silent so only the sending is checked).
        children[0]!.behavior.silentShards = new Set([0]);
        const sent = manager
            .request(0, "t", { a: cjk(330) }, { timeoutMs: 20 })
            .catch((error: Error) => error);
        await tick(5);
        expect(children[0]!.busFrames()).toHaveLength(1);
        expect(((await sent) as Error).message).toMatch(/in time/);
    });
});

describe("worker process errors", () => {
    test("an asynchronous send failure is reported, not thrown, and the cluster is restarted by its exit", async () => {
        const { manager, children, errors } = setup({
            clusterCount: 1,
            shardCount: 2,
        });
        await manager.spawn();
        children[0]!.ready();
        await tick();
        // Node emits this after send() returned, when the channel dies mid-write.
        const failure = Object.assign(new Error("write EPIPE"), {
            code: "EPIPE",
        });
        expect(() => children[0]!.emit("error", failure)).not.toThrow();
        expect(errors).toHaveLength(1);
        expect(errors[0]!.message).toBe("Cluster 0 process error: write EPIPE");
        expect(errors[0]!.cause).toBe(failure);
        // Nothing else changed: the exit that follows does the recovery.
        expect(manager.clusters.get(0)!.state).toBe("ready");
        children[0]!.exit(1, null);
        await tick(30);
        expect(children).toHaveLength(2);
    });

    test("a worker that errors repeatedly never stops the manager", async () => {
        const { manager, children, errors } = setup();
        await manager.spawn();
        for (let i = 0; i < 20; i++)
            children[i % 2]!.emit("error", new Error(`boom ${i}`));
        expect(errors).toHaveLength(20);
        expect(await manager.request(0, "t", null)).toBeDefined();
    });
});
