---
title: "Sharding & Multi-Process Scaling"
description: Architectural guide to Discord Gateway sharding and horizontal scaling.
---

When a Discord bot joins more than **2,500 guilds**, Discord enforces Gateway Sharding. Each shard maintains its own independent WebSocket connection and handles a fraction of the bot's total servers.

---

## How Shard Allocation Works

Discord distributes guilds across shards using a deterministic snowflake formula:

$$\text{Shard ID} = (\text{Guild ID} \gg 22) \pmod{\text{Total Shards}}$$

Lunibee handles this calculation automatically via `manager.getShardIdForGuild(guildId)`.

```ts
import { ShardManager, IntentBits } from "lunibee";

const manager = new ShardManager({
  token: process.env.DISCORD_TOKEN!,
  intents: IntentBits.guilds | IntentBits.guildMessages,
  shardCount: "auto", // Automatically requests Discord's recommended shard count
});

await manager.connect();
```
