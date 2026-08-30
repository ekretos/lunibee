---
title: "@lunibee/core"
description: Main Client coordinator, event emitter, and lifecycle state management.
---

The `@lunibee/core` package is the primary coordinator for Lunibee bots. It integrates the WebSocket Gateway, REST HTTP client, Resource Managers, and interaction dispatching into a cohesive client.

## Installation

```bash
bun add @lunibee/core @lunibee/types
```

---

## `Client` Class

```ts
import { Client } from "@lunibee/core";
import { IntentBits } from "@lunibee/types";

const client = new Client({
  token: process.env.DISCORD_TOKEN!,
  intents: [
    IntentBits.guilds,
    IntentBits.guildMessages,
    IntentBits.messageContent,
  ],
});

client.on("ready", (user) => {
  console.log(`Logged in as ${user.username}#${user.discriminator}!`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content === "!ping") {
    await message.reply({ content: "🏓 Pong!" });
  }
});

await client.login();
```

### Constructor Options (`ClientOptions`)

| Option | Type | Default | Description |
|---|---|---|---|
| `token` | `string` | Required | Discord Bot Authentication Token. |
| `intents` | `number[] \| number \| string[]` | Required | Gateway Intents to subscribe to. |
| `rest` | `RESTOptions` | `{}` | Custom REST configuration. |
| `ws` | `GatewayOptions` | `{}` | Custom Gateway configuration. |

### Properties

- **`client.user`**: `ClientUser | undefined` — The authenticated bot user once connected.
- **`client.guilds`**: `GuildManager` — Cache and resource manager for Discord guilds.
- **`client.channels`**: `ChannelManager` — Cache and resource manager for Discord channels and messages.
- **`client.users`**: `UserManager` — Cache and resource manager for Discord users.
- **`client.rest`**: `REST` — Low-level REST client for Discord API HTTP requests.
- **`client.ws`**: `Gateway` — Low-level WebSocket Gateway connection.
- **`client.uptime`**: `number | null` — Time in milliseconds since the client established the ready state.
- **`client.isReady()`**: `boolean` — Returns true if the client is currently connected and ready.

### Methods

- **`login(token?: string): Promise<string>`**: Logs into Discord and establishes Gateway and REST connections.
- **`destroy(): void`**: Gracefully closes WebSocket connections, cancels pending REST requests, and cleans up event listeners.

---

## `Collector<T>` Class

Gathers events over a time window or until a condition is met.

```ts
import { Collector } from "@lunibee/core";

const collector = new Collector(client, "messageCreate", {
  filter: (msg) => msg.author.id === targetUserId,
  max: 5,
  time: 30_000,
});

collector.on("collect", (msg) => console.log("Collected:", msg.content));
collector.on("end", (collected, reason) => console.log(`Finished: ${collected.length} items.`));
```
