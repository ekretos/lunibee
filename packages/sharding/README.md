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
    intents: [GatewayIntentBits.Guilds],
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

- **`ShardManager`**: one `Gateway` per shard, IDENTIFY pacing,
  optional auto-scaling (`autoScaleInterval`), `getShardIdForGuild()`, `destroy()`.
- **`ClusterManager`**: orchestrates cluster processes (`child_process.fork`, Node and Bun). It
  assigns shards deterministically (`SHARD_LIST`, `SHARD_COUNT`, `CLUSTER_ID`, `CLUSTER_COUNT` env
  vars; a worker cannot start the fleet again), hands out IDENTIFY slots across all clusters,
  waits for readiness (`ready()`, `waitForReady`, `startTimeout`), restarts crashed clusters with
  backoff, routes `request()` / `broadcast()` / `requestCluster()` to the owning cluster, reports
  `health()`, and can move a failed cluster's shards to another cluster (`reassignOnGiveUp`).
  With `remote`, it is a coordinator for `ClusterHost` agents on other machines (authenticated WebSocket, fenced workers).
  Inside a worker, `ShardManager` owns only the cluster's shards and uses the parent for IDENTIFY.
- **`ShardBus`**: `send`, `broadcast`, `on`/`off`, `onError`, and request/reply with
  `respond`, `request` and `broadcastRequest`. This replaces discord.js's
  `broadcastEval` without evaluating received code.

## What's new in 0.2.0

Startup in rounds of `max_concurrency` paced by sent IDENTIFYs (`maxConcurrency`, `handshakeTimeout`), a session-start-limit check that keeps live shards, `fetchGatewayInfo()` and `health()`.

Docs: https://lunibee.js.org/core-concepts/sharding/

## What's new in 0.3.1

`ShardManager` and `ClusterManager` work as one system: one worker contract, one IPC channel, one
IDENTIFY authority, typed events, requests with timeouts, health and recovery. See
https://lunibee.js.org/core-concepts/sharding/ and `examples/cluster`.
