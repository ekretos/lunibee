// Runs a real ClusterManager whose clusters are worker threads (threadFork)
// and prints what happened.
import {
    ClusterManager,
    threadFork,
} from "../../packages/sharding/src/index.ts";

const out = (key: string, value: unknown) =>
    console.log(JSON.stringify({ key, value }));
const worker = new URL("./cluster-worker.ts", import.meta.url).pathname;
const connects: number[] = [];

const manager = new ClusterManager({
    token: "fixture",
    script: worker,
    shardCount: 4,
    clusterCount: 2,
    maxConcurrency: 1,
    identify: { interval: 100 },
    spawnInterval: 0,
    waitForReady: true,
    restartDelay: 50,
    shutdownTimeout: 3000,
    fork: threadFork(),
});
manager.on("clusterSpawn", (c) =>
    c.process.on("message", (frame) => {
        const f = frame as { fixture?: string; at: number };
        if (f?.fixture === "connect") connects.push(f.at);
    }),
);
manager.on("error", (e) => out("error", e.message));

await manager.spawn();
out("health", manager.health());
out(
    "gaps",
    connects.slice(1).map((at, i) => at - connects[i]!),
);
const all = await manager.broadcast<{ shard: number; cluster: number }>(
    "whoami",
    null,
    { timeoutMs: 3000 },
);
out(
    "broadcast",
    all.replies.map((r) => [r.result!.shard, r.result!.cluster]).sort(),
);
out(
    "pid",
    (await manager.requestCluster<number>(1, "pid", null)) === process.pid,
);

const recovered = new Promise<void>((resolve) => {
    const done = (): void => {
        manager.off("ready", done);
        resolve();
    };
    manager.on("ready", done);
});
manager.clusters.get(0)!.process.kill("SIGKILL");
await recovered;
out("restarts", manager.health().clusters[0]!.restarts);
out(
    "again",
    (await manager.broadcast("whoami", null, { timeoutMs: 3000 })).replies
        .length,
);
await manager.shutdownAll();
out("left", manager.clusters.size);
