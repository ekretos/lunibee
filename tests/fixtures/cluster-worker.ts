// A cluster worker for the real-process test: a real ShardManager and ShardBus,
// with the Gateway sockets replaced so no Discord token is needed.
import {
    ClusterWorker,
    ShardBus,
    ShardManager,
    threadEndpoint,
} from "../../packages/sharding/src/index.ts";
import { Gateway } from "../../packages/ws/src/index.ts";

Gateway.prototype.connect = async function () {
    // A forked worker reports through process.send, a thread through its port.
    (process.send?.bind(process) ?? threadEndpoint()?.send)?.({
        fixture: "connect",
        at: Date.now(),
        pid: process.pid,
    });
    setTimeout(() => this.emit("ready"), 5);
};

const manager = new ShardManager({
    token: "fixture",
    intents: [],
    handshakeTimeout: 1,
});
const worker = ClusterWorker.current()!;
for (const id of manager.shardIds) {
    new ShardBus(id, "fixture").respond("whoami", () => ({
        shard: id,
        pid: process.pid,
        cluster: worker.context.clusterId,
    }));
}
worker.onRequest("pid", () => process.pid);
await manager.connect();
