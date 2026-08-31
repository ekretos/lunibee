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
