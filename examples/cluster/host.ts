// Run on each extra machine: bun examples/cluster/host.ts
// The coordinator (manager.ts with a `remote` option) places clusters here.
import { ClusterHost } from "lunibee";

const secret = process.env.CLUSTER_SECRET;
const url = process.env.COORDINATOR_URL;
if (!secret || !url) throw new Error("CLUSTER_SECRET and COORDINATOR_URL are required");

const host = new ClusterHost({
    url, // e.g. wss://coordinator.example.com:7070
    secret,
    id: process.env.HOST_ID ?? "host-1",
    script: new URL("./worker.ts", import.meta.url).pathname,
});

host.on("clusterSpawn", cluster => console.log(`cluster ${cluster} started here`));
host.on("clusterExit", (cluster, code, signal) => console.warn(`cluster ${cluster} exited (${code ?? signal})`));
host.on("disconnected", ({ code, reason }) => console.warn(`coordinator link lost (${code} ${reason}); workers were stopped`));
host.on("error", error => console.error(error));

await host.connect();

for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => void host.close().then(() => process.exit(0)));
