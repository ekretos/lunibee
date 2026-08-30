---
title: Client & Lifecycle
description: The main application entry point and state machine in Lunibee.
---

# Client & Lifecycle

The `Client` class is the central orchestrator in Lunibee. It coordinates WebSocket connections, the REST client, event dispatchers, and resource managers.

## Lifecycle State Machine

Lunibee clients follow a deterministic lifecycle:

```text
  ┌──────────────┐
  │     IDLE     │ ─── client.login() ───┐
  └──────────────┘                       │
         ▲                               ▼
         │                      ┌────────────────┐
     reconnect                  │   CONNECTING   │
         │                      └────────────────┘
         │                               │
         │                         WebSocket OPEN
         │                         & READY packet
         │                               │
         │                               ▼
  ┌──────────────┐              ┌────────────────┐
  │  DESTROYED   │ ◄── destroy ─│     READY      │
  └──────────────┘              └────────────────┘
```

## Initializing the Client

```ts
import { Client, GatewayIntentBits } from "lunibee";

const client = new Client({
  token: process.env.DISCORD_TOKEN!,
  intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
  rest: {
    timeout: 15_000,
    retries: 3,
  },
});
```

## Key Properties & Methods

- `client.login()`: Connects to the Discord Gateway and authenticates.
- `client.destroy()`: Closes the WebSocket, halts heartbeat timers, and releases cached resources cleanly.
- `client.isReady()`: TypeScript type guard checking if `client.user` is defined.
- `client.rest`: Access to the underlying `@lunibee/rest` HTTP client.
- `client.users`, `client.channels`, `client.guilds`: Resource managers with integrated caching.

## Event Handling

```ts
client.on("ready", (user) => {
  console.log(`Ready as ${user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await interaction.reply({ content: "Command received!" });
  }
});
```
