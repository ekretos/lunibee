---
title: "@lunibee/sharding"
description: Gateway ShardManager and cross-shard communication bus.
---

The `@lunibee/sharding` package helps large Discord bots split Gateway connections across multiple shards and communicate between them.

## Installation

```bash
bun add @lunibee/sharding @lunibee/types
```

## `ShardManager`

```ts
import { ShardManager } from "@lunibee/sharding";
import { IntentBits } from "@lunibee/types";

const manager = new ShardManager({
  token: process.env.DISCORD_TOKEN!,
  intents: IntentBits.guilds | IntentBits.guildMessages,
  shardCount: "auto",
});

await manager.connect();
```

Use automatic shard counts unless you have a reason to control the count yourself.

### Shard start pacing

Discord permits one IDENTIFY every 5 seconds, so `spawnDelay` defaults to
`ShardManager.IDENTIFY_INTERVAL` (5000 ms). An *N*-shard bot therefore takes about
`(N - 1) × 5s` to finish connecting; starting shards faster earns close code `4008`
and invalid-session churn. Pass `spawnDelay: 0` only when something else already
paces your handshakes.

## `ClusterManager`

For multi-process deployments, `ClusterManager` distributes shards across child
processes and supervises them: a cluster that exits unexpectedly is re-forked with
the same shard assignment after `restartDelay` (5000 ms by default), and
`onClusterExit` reports every exit.

```ts
import { ClusterManager } from "@lunibee/sharding";

const cluster = new ClusterManager({
  token: process.env.DISCORD_TOKEN!,
  script: "./dist/bot.js",
  shardCount: "auto",
  onClusterExit: (info, code) => console.warn(`cluster ${info.id} exited`, code),
});

await cluster.spawn();
```

Clustering needs Node's `child_process.fork()`, so run the manager under Node.js
rather than Bun. See the [ShardManager reference](/reference/shard-manager/) for the
full option list.

## `ShardBus`

Use `ShardBus` when shards need to send application-level messages to each other.

```ts
import { ShardBus } from "@lunibee/sharding";

const bus = new ShardBus(0, "lunibee-bot");

bus.on("RELOAD_CONFIG", (message) => {
  console.log("Reload requested by shard", message.source);
});

bus.broadcast("RELOAD_CONFIG", { reason: "admin_request" });
```

## When do I need sharding?

A small bot normally starts with a single `Client`. Sharding becomes useful when the bot grows enough that Discord requires multiple Gateway sessions or when you want to distribute Gateway work across processes.
