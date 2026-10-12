// A coordinator and two host agents over real sockets, with real worker
// processes on the hosts. Everything runs on one machine; the sockets and
// processes are real.
import {
    ClusterHost,
    ClusterManager,
} from "../../packages/sharding/src/index.ts";

const out = (key: string, value: unknown) =>
    console.log(JSON.stringify({ key, value }));
const worker = new URL("./cluster-worker.ts", import.meta.url).pathname;
const secret = "fixture-secret-fixture-secret";
const connects: { pid: number; at: number }[] = [];
const events: string[] = [];

const manager = new ClusterManager({
    token: "fixture",
    script: "unused-for-remote-clusters.ts",
    shardCount: 4,
    clusterCount: 2,
    maxConcurrency: 1,
    identify: { interval: 150 },
    spawnInterval: 0,
    waitForReady: true,
    restartDelay: 50,
    shutdownTimeout: 3000,
    remote: {
        port: 0,
        hostname: "127.0.0.1",
        secret,
        hosts: ["east", "west"],
        lease: 600,
    },
});
manager.on("hostJoin", (id) => events.push(`join:${id}`));
manager.on("hostLeave", (id) => events.push(`leave:${id}`));
manager.on("clusterRestart", (c) => events.push(`restart${c.id}@${c.host}`));
manager.on("error", (e) => events.push(`error:${e.message}`));

const spawning = manager.spawn();
while (manager.remotePort === undefined)
    await new Promise((r) => setTimeout(r, 5));
const url = `ws://127.0.0.1:${manager.remotePort}`;
const hosts = new Map<string, ClusterHost>();
const connect = async (id: string): Promise<ClusterHost> => {
    const host = new ClusterHost({
        url,
        secret,
        id,
        script: worker,
        reconnectDelay: 50,
    });
    hosts.set(id, host);
    await host.connect();
    return host;
};
await Promise.all([connect("east"), connect("west")]);
await spawning;

for (const cluster of manager.clusters.values())
    cluster.process.on("message", (frame) => {
        const f = frame as { fixture?: string; at: number; pid: number };
        if (f?.fixture === "connect") connects.push({ pid: f.pid, at: f.at });
    });
out("health", manager.health());
out("hosts", manager.hosts());

const all = await manager.broadcast<{
    shard: number;
    cluster: number;
    pid: number;
}>("whoami", null, { timeoutMs: 3000 });
out("broadcast", all);
out("one", await manager.request(3, "whoami", null));

// Kill a worker on "west" (cluster 1): it comes back on the same host.
const before = await manager.requestCluster<number>(1, "pid", null);
const recovered = new Promise<void>((resolve) => {
    const done = (): void => {
        manager.off("ready", done);
        resolve();
    };
    manager.on("ready", done);
});
process.kill(before, "SIGKILL");
await recovered;
const after = await manager.requestCluster<number>(1, "pid", null);
out("restart", { before, after, host: manager.clusters.get(1)!.host });

// Lose the whole host: its workers die at once, and it rejoins.
const east = await manager.requestCluster<number>(0, "pid", null);
await hosts.get("east")!.close();
await new Promise((resolve) => setTimeout(resolve, 100));
let eastAlive = true;
try {
    process.kill(east, 0);
} catch {
    eastAlive = false;
}
out("fenced", { eastAlive, state: manager.health().state });
const rejoined = new Promise<void>((resolve) => {
    const done = (): void => {
        manager.off("ready", done);
        resolve();
    };
    manager.on("ready", done);
});
hosts.set("east", await connect("east"));
await rejoined;
out(
    "rejoined",
    (await manager.broadcast("whoami", null, { timeoutMs: 3000 })).replies
        .length,
);

const pids = [
    await manager.requestCluster<number>(0, "pid", null),
    await manager.requestCluster<number>(1, "pid", null),
];
await manager.shutdownAll();
for (const host of hosts.values()) await host.close();
await new Promise((resolve) => setTimeout(resolve, 100));
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
out(
    "gaps",
    connects
        .slice(1)
        .map((c, i) => c.at - connects[i]!.at)
        .slice(0, 3),
);
out("events", events);
