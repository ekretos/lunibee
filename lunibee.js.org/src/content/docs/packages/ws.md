---
title: "@lunibee/ws"
description: Standalone Discord Gateway WebSocket client with automated heartbeats and session recovery.
---

The `@lunibee/ws` package provides a low-level, high-performance WebSocket client engineered for Discord's Gateway protocol.

## Installation

```bash
bun add @lunibee/ws @lunibee/types
```

---

## `Gateway` Class

```ts
import { Gateway } from "@lunibee/ws";
import { IntentBits } from "@lunibee/types";

const gateway = new Gateway({
  token: process.env.DISCORD_TOKEN!,
  intents: IntentBits.guilds | IntentBits.guildMessages,
  shardId: 0,
  shardCount: 1,
  reconnect: true,
  maxReconnectAttempts: 10,
});

gateway.on("open", () => console.log("WebSocket connection open."));
gateway.on("ready", (data) => console.log("Gateway ready:", data.user.username));
gateway.on("dispatch", ({ event, data }) => console.log("Received event:", event));

await gateway.connect();
```

### Constructor Options (`GatewayOptions`)

| Option | Type | Default | Description |
|---|---|---|---|
| `token` | `string` | Required | Discord Bot Authentication Token. |
| `intents` | `number` | Required | Gateway intent bitfield integer. |
| `shardId` | `number` | `0` | Zero-based shard ID. |
| `shardCount` | `number` | `1` | Total number of shards. |
| `reconnect` | `boolean` | `true` | Automatically reconnect on network drops. |
| `maxReconnectAttempts` | `number` | `10` | Maximum consecutive reconnection attempts. |
