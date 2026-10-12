// Runs a real ClusterManager over real forked processes and prints what happened.
import { ClusterManager } from "../../packages/sharding/src/index.ts";

const out = (key: string, value: unknown) =>
    console.log(JSON.stringify({ key, value }));
const worker = new URL("./cluster-worker.ts", import.meta.url).pathname;
const connects: { pid: number; at: number }[] = [];
const events: string[] = [];

const manager = new ClusterManager({
    token: "fixture",
    script: worker,
    shardCount: 4,
    clusterCount: 2,
    maxConcurrency: 1,
    identify: { interval: 150 },
    spawnInterval: 0,
    waitForReady: true,
    restartDelay: 50,
    shutdownTimeout: 3000,
});
manager.on("clusterSpawn", (c) => {
    c.process.on("message", (frame) => {
        const f = frame as { fixture?: string; at: number; pid: number };
        if (f?.fixture === "connect") connects.push({ pid: f.pid, at: f.at });
    });
});
manager.on("clusterRestart", (c) => events.push(`restart${c.id}`));
manager.on("clusterReady", (c) => events.push(`ready${c.id}`));
manager.on("error", (e) => events.push(`error:${e.message}`));

await manager.spawn();
out("health", manager.health());
out(
    "gaps",
    connects.slice(1).map((c, i) => c.at - connects[i]!.at),
);

const all = await manager.broadcast<{
    shard: number;
    pid: number;
    cluster: number;
}>("whoami", null, { timeoutMs: 3000 });
out("broadcast", all);
out("one", await manager.request(3, "whoami", null));

const before = await manager.requestCluster<number>(0, "pid", null);
const recovered = new Promise<void>((resolve) => {
    const done = (): void => {
        manager.off("ready", done);
        resolve();
    };
    manager.on("ready", done);
});
process.kill(before, "SIGKILL");
await recovered;
const after = await manager.requestCluster<number>(0, "pid", null);
out("restart", {
    before,
    after,
    restarts: manager.health().clusters[0]!.restarts,
});
out(
    "again",
    (await manager.broadcast("whoami", null, { timeoutMs: 3000 })).replies
        .length,
);
out("owners", [...manager.assignments()]);

const pids = [...manager.clusters.values()].map((c) => c.process.pid!);
await manager.shutdownAll();
await new Promise((resolve) => setTimeout(resolve, 50));
out(
    "alive",
    pids.filter((pid) => {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }),
);
out("events", events);
out("final", manager.health().state);
