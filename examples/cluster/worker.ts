// Started by manager.ts. Inside a cluster the ShardManager owns only this
// cluster's shards, takes every IDENTIFY slot from the parent and tells it
// when all of them are ready.
import { GatewayIntentBits, ShardBus, ShardManager } from "lunibee";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("DISCORD_TOKEN is required");

const shards = new ShardManager({ token, intents: [GatewayIntentBits.Guilds] });

shards.on("shardReady", id => console.log(`shard ${id} ready`));
shards.on("shardDisconnect", (id, { code }) => console.warn(`shard ${id} closed: ${code}`));

// Answer the manager's request()/broadcast() for each shard this worker owns.
for (const id of shards.shardIds) new ShardBus(id, "cluster-example").respond("guildCount", () => 0);

await shards.connect();
