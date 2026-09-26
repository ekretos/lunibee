import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

/** Fake child process: records kills and exits on demand. */
class FakeChild extends EventEmitter {
    public exitCode: number | null = null;
    public signalCode: NodeJS.Signals | null = null;
    public readonly kills: (string | undefined)[] = [];
    public constructor(
        public readonly env: Record<string, string>,
        public ignoreTerm = false,
    ) {
        super();
    }
    public kill(signal?: string): boolean {
        this.kills.push(signal);
        if (signal === "SIGTERM" && this.ignoreTerm) return true;
        queueMicrotask(() => this.exit(null, (signal ?? "SIGTERM") as never));
        return true;
    }
    public exit(code: number | null, signal: NodeJS.Signals | null): void {
        this.exitCode = code;
        this.signalCode = signal;
        this.emit("exit", code, signal);
    }
}

const children: FakeChild[] = [];
let ignoreTerm = false;
mock.module("node:child_process", () => ({
    fork: (
        _script: string,
        _args: string[],
        options: { env: Record<string, string> },
    ) => {
        const child = new FakeChild(options.env, ignoreTerm);
        children.push(child);
        return child;
    },
}));
const { ClusterManager } = await import("../packages/sharding/src/cluster.ts");

const bunVersion = process.versions.bun;
const originalFetch = globalThis.fetch;
const setBun = (value: string | undefined) =>
    Object.defineProperty(process.versions, "bun", {
        value,
        configurable: true,
        writable: true,
    });

beforeAll(() => setBun(undefined));
afterAll(() => {
    setBun(bunVersion);
    globalThis.fetch = originalFetch;
});

const gatewayBot = (shards: unknown, status = 200) => {
    globalThis.fetch = (async () =>
        new Response(JSON.stringify({ shards }), { status })) as never;
};

describe("ClusterManager (mocked fork)", () => {
    test("refuses to spawn under Bun", async () => {
        setBun("1.3.11");
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 1,
        });
        await expect(manager.spawn()).rejects.toThrow(/Node.js runtime/);
        setBun(undefined);
    });

    test("distributes shards across clusters and shuts down gracefully", async () => {
        children.length = 0;
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 5,
            clusterCount: 3,
        });
        await manager.spawn();
        await manager.spawn(); // idempotent
        expect(children.map((c) => c.env.SHARD_LIST)).toEqual([
            "0,3",
            "1,4",
            "2",
        ]);
        expect(children.every((c) => c.env.SHARD_COUNT === "5")).toBe(true);
        expect(manager.shardCount).toBe(5);
        await manager.shutdownAll();
        expect(children.every((c) => c.kills[0] === "SIGTERM")).toBe(true);
        expect(manager.clusters.size).toBe(0);
    });

    test("restarts a crashed cluster with the same shards", async () => {
        children.length = 0;
        const exits: [number, number | null][] = [];
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 2,
            clusterCount: 1,
            restartDelay: 10,
            onClusterExit: (cluster, code) => {
                exits.push([cluster.id, code]);
                throw new Error("callback failure is isolated");
            },
        });
        await manager.spawn();
        children[0]!.exit(1, null);
        expect(exits).toEqual([[0, 1]]);
        expect(manager.clusters.size).toBe(0);
        await Bun.sleep(30);
        expect(children).toHaveLength(2);
        expect(children[1]!.env.SHARD_LIST).toBe("0,1");
        expect(manager.clusters.get(0)?.process).toBe(children[1] as never);
        manager.killAll();
        expect(manager.clusters.size).toBe(0);
    });

    test("does not restart when restartOnExit is false", async () => {
        children.length = 0;
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 1,
            clusterCount: 1,
            restartOnExit: false,
            restartDelay: 1,
        });
        await manager.spawn();
        children[0]!.exit(1, null);
        await Bun.sleep(10);
        expect(children).toHaveLength(1);
        manager.killAll();
    });

    test("force-kills a child that ignores SIGTERM", async () => {
        children.length = 0;
        ignoreTerm = true;
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 1,
            clusterCount: 1,
        });
        await manager.spawn();
        await manager.shutdownAll(10);
        expect(children[0]!.kills).toEqual(["SIGTERM", "SIGKILL"]);
        ignoreTerm = false;
    });

    test("auto shard count, validation, and auto-scale respawn", async () => {
        children.length = 0;
        gatewayBot(2);
        const errors: Error[] = [];
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: "auto",
            clusterCount: 1,
            onAutoScaleError: (error) => errors.push(error),
        });
        expect(await manager.fetchRecommendedShardCount()).toBe(2);
        await manager.spawn();
        expect(manager.shardCount).toBe(2);

        gatewayBot(2);
        await manager.checkAutoScale();
        expect(children).toHaveLength(1);

        gatewayBot(3);
        await manager.checkAutoScale();
        expect(manager.shardCount).toBe(3);
        expect(children).toHaveLength(2);
        expect(children[1]!.env.SHARD_LIST).toBe("0,1,2");

        gatewayBot(0);
        await manager.checkAutoScale();
        gatewayBot(1, 401);
        await manager.checkAutoScale();
        expect(errors.map((e) => e.message)).toEqual([
            "Gateway discovery returned an invalid shard count.",
            "Gateway discovery failed with status 401",
        ]);
        await manager.shutdownAll();
    });
});
