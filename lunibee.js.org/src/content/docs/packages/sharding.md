---
title: "@lunibee/sharding"
description: Gateway ShardManager and cross-shard communication bus.
---

The `@lunibee/sharding` package provides multi-shard management and inter-process messaging for large-scale Discord bots.

## Installation

```bash
bun add @lunibee/sharding @lunibee/types
```

---

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

---

## `ShardBus`

```ts
import { ShardBus } from "@lunibee/sharding";

const bus = new ShardBus();

bus.on("RELOAD_CONFIG", (msg) => {
  console.log("Received reload config request from shard:", msg.sourceShardId);
});

bus.broadcast({ type: "RELOAD_CONFIG" });
```
