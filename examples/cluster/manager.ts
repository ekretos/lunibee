// bun examples/cluster/manager.ts
// One bot as several processes: the ClusterManager forks workers, hands out
// IDENTIFY slots and routes requests; each worker runs its shards.
import { ClusterManager } from "lunibee";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required");

const clusters = new ClusterManager({
    token,
    script: new URL("./worker.ts", import.meta.url).pathname,
    shardCount: "auto",
    shardsPerCluster: 2,
    waitForReady: true,
    startTimeout: 180_000,
    supervisor: { restartDelay: 1000, backoff: 2, jitter: 0.2, maxRestarts: 5 },
    reassignOnGiveUp: true,
});

clusters.on("clusterReady", cluster => console.log(`cluster ${cluster.id} ready (shards ${cluster.shards})`));
clusters.on("clusterRestart", (cluster, { delay, attempt }) => console.warn(`cluster ${cluster.id} restarts in ${delay}ms (#${attempt})`));
clusters.on("clusterGiveUp", cluster => console.error(`cluster ${cluster.id} keeps crashing`));
clusters.on("identifyWait", ({ shardId, waitMs }) => console.warn(`shard ${shardId} waits ${Math.ceil(waitMs / 1000)}s for the session budget`));
clusters.on("error", error => console.error(error));

await clusters.spawn();

// Ask every shard, then one shard.
const { replies, missing } = await clusters.broadcast<number>("guildCount", null, { timeoutMs: 5000 });
console.log(`guilds: ${replies.reduce((sum, reply) => sum + (reply.result ?? 0), 0)}, silent shards: [${missing}]`);
console.log("shard 0:", await clusters.request<number>(0, "guildCount", null));
console.log(JSON.stringify(await clusters.refreshHealth({ metrics: true }), null, 2));

for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => void clusters.shutdownAll().then(() => process.exit(0)));
