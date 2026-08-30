---
title: "@lunibee/core"
description: Complete guide for the Lunibee Client, event dispatching, collectors, and bot lifecycle.
---

# `@lunibee/core`

`@lunibee/core` is the primary orchestrator that connects the WebSocket Gateway, REST API, Managers, and Interaction handling into a cohesive, production-ready Discord bot client.

## Installation

```bash
bun add @lunibee/core
```

---

## `Client`

The `Client` is the main entrypoint for your bot application.

```ts
import { Client, IntentBits, GatewayIntentBits } from "lunibee";

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
  console.log(`Bot is in ${client.guilds.size} guilds.`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content === "!ping") {
    await message.reply({ content: "🏓 Pong!" });
  }
});

await client.login();
```

### Client Properties

- **`client.user`**: `ClientUser | undefined` — Authenticated bot user.
- **`client.guilds`**: `GuildManager` — Cache and resource manager for Discord guilds.
- **`client.channels`**: `ChannelManager` — Cache and resource manager for channels and messages.
- **`client.users`**: `UserManager` — Cache and resource manager for users.
- **`client.rest`**: `REST` — REST client for direct Discord HTTP calls.
- **`client.ws`**: `Gateway` — Low-level WebSocket gateway connection.
- **`client.uptime`**: `number | null` — Time in milliseconds since the bot became ready.
- **`client.isReady()`**: `boolean` — Returns true if the client is connected and ready.
- **`client.destroy()`**: `void` — Closes Gateway connections, aborts pending REST requests, and releases all resources.

### Client Gateway Events

| Event | Payload | Description |
|---|---|---|
| `"ready"` | `ClientUser` | Emitted when Gateway finishes handshake and initial cache sync. |
| `"messageCreate"` | `Message` | Emitted when a new message is posted in a channel. |
| `"messageUpdate"` | `Message` | Emitted when a message is edited. |
| `"messageDelete"` | `APIMessageDeleteEvent` | Emitted when a message is deleted. |
| `"messageDeleteBulk"` | `APIMessageDeleteBulkEvent` | Emitted when multiple messages are bulk deleted. |
| `"guildCreate"` | `Guild` | Emitted when the bot joins a guild or becomes available. |
| `"guildUpdate"` | `Guild` | Emitted when guild settings change. |
| `"guildDelete"` | `{ id: string; unavailable?: boolean }` | Emitted when the bot leaves or is kicked from a guild. |
| `"interactionCreate"` | `Interaction` | Emitted when a slash command, button, select menu, or modal is submitted. |
| `"channelCreate"` | `Channel` | Emitted when a channel is created. |
| `"channelUpdate"` | `Channel` | Emitted when a channel is updated. |
| `"channelDelete"` | `APIChannel` | Emitted when a channel is deleted. |

---

## `Collector<T>`

`Collector` gathers items (such as messages or interaction responses) over a period of time matching a filter.

```ts
import { Collector } from "@lunibee/core";

// Collect up to 5 messages from a user within 30 seconds
const collector = new Collector<Message>(emitter, "messageCreate", {
  filter: (msg) => msg.author.id === userId,
  max: 5,
  time: 30_000,
});

collector.on("collect", (msg) => {
  console.log("Collected message:", msg.content);
});

collector.on("end", (collected, reason) => {
  console.log(`Collected ${collected.length} messages. Reason: ${reason}`);
});

// Or await the next single item with async/await
const nextMessage = await collector.next();
```
