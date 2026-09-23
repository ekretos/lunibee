# @lunibee/sharding

> Run many gateway shards in one process (`ShardManager`), across child processes
> (`ClusterManager`), and message between them (`ShardBus`).

```bash
bun add @lunibee/sharding
```

```ts
import { ShardManager, ShardBus } from "@lunibee/sharding";
import { GatewayIntentBits } from "@lunibee/types";

const manager = new ShardManager({
    token: process.env.DISCORD_TOKEN!,
    intents: GatewayIntentBits.Guilds,
    shardCount: "auto", // Discord's recommended count
});
await manager.connect(); // starts shards 5 s apart (spawnDelay)
console.log(manager.getShardIdForGuild("123456789012345678"));

const bus = new ShardBus(0, "my-bot");
bus.respond("guildCount", () => 42);
bus.onError((error, message) => console.error(message.type, error));
const replies = await bus.broadcastRequest<number>("guildCount", null, {
    expected: 3,
    timeoutMs: 5_000,
});
console.log(replies.reduce((sum, reply) => sum + (reply.result ?? 0), 0));
```

## What's inside

- **`ShardManager`** (alias `ShardingManager`): one `Gateway` per shard, IDENTIFY pacing,
  optional auto-scaling (`autoScaleInterval`), `getShardIdForGuild()`, `destroy()`.
- **`ClusterManager`**: forks a worker script per cluster with `SHARD_LIST`,
  `SHARD_COUNT` and `CLUSTER_ID` env vars, restarts crashed clusters (`restartOnExit`,
  `restartDelay`, `onClusterExit`), and shuts down gracefully. Runs under **Node.js**
  (it relies on `child_process.fork`).
- **`ShardBus`**: `send`, `broadcast`, `on`/`off`, `onError`, and request/reply with
  `respond`, `request` and `broadcastRequest`. This replaces discord.js's
  `broadcastEval` without evaluating received code.

Docs: https://lunibee.js.org/core-concepts/sharding/
