---
title: Sharding
description: Multi-process and multi-gateway connection sharding with ShardManager and ShardBus.
---

# Sharding

For bots in more than 2,500 guilds, Discord requires sharding. `@lunibee/sharding` manages multiple Gateway instances, automated scaling, and cross-shard communication.

## Setting Up ShardManager

```ts
import { ShardManager } from "@lunibee/sharding";

const shards = new ShardManager({
  token: process.env.DISCORD_TOKEN!,
  intents: 513,
  shardCount: "auto", // Automatically queries Discord for recommended count
});

shards.on("shardReady", (shardId) => {
  console.log(`Shard #${shardId} connected!`);
});

await shards.connect();
```

## Cross-Shard Message Bus (`ShardBus`)

`ShardBus` allows shards to broadcast messages or send targeted requests to specific shard IDs:

```ts
import { ShardBus } from "@lunibee/sharding";

const bus = new ShardBus();

// Broadcast a message to all shards
bus.broadcast("SYNC_CACHE", { timestamp: Date.now() });

// Send a targeted event to Shard 0
bus.send(0, "RELOAD_CONFIG", { reason: "Admin update" });
```

## Graceful Destruction

```ts
// Cleanly terminates all open WebSocket connections across all shards
await shards.destroy();
```
