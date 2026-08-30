---
title: Client & Lifecycle
description: The main application entry point, state machine, and presence management in Lunibee.
---

# Client & Lifecycle

The `Client` class is the central orchestrator in Lunibee. It coordinates WebSocket connections, the REST client, event dispatchers, presence updates, and resource managers.

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
  intents:
    GatewayIntentBits.Guilds |
    GatewayIntentBits.GuildMessages |
    GatewayIntentBits.MessageContent,
  gateway: {
    properties: {
      os: "Android",
      browser: "Discord Android",
      device: "Discord Android",
    },
    presence: {
      status: "online",
      activities: [
        {
          name: "Custom Status",
          type: 4,
          state: "Build on Lunibee 🐝🐝",
        },
      ],
    },
  },
  rest: {
    timeout: 15_000,
    retries: 3,
  },
});
```

## Gateway Intents & Privileged Intents

Discord Gateway requires bitfield intents to receive specific event payloads:

- `GatewayIntentBits.Guilds` (`1 << 0`)
- `GatewayIntentBits.GuildMembers` (`1 << 1`) *(Privileged)*
- `GatewayIntentBits.GuildPresences` (`1 << 8`) *(Privileged - required to receive member presence updates)*
- `GatewayIntentBits.GuildMessages` (`1 << 9`)
- `GatewayIntentBits.MessageContent` (`1 << 15`) *(Privileged)*

## Managing Bot Presence & Status

You can dynamically update your bot's presence or custom status after login:

```ts
// Update presence at runtime
client.setPresence({
  status: "dnd",
  activities: [
    {
      name: "Custom Status",
      type: 4,
      state: "Buzzing fast! ⚡",
    },
  ],
});
```

## Key Properties & Methods

- `client.login()`: Connects to the Discord Gateway and authenticates.
- `client.destroy()`: Closes the WebSocket, halts heartbeat timers, and releases cached resources cleanly.
- `client.setPresence(presence)`: Sends an `Opcode 3 (Presence Update)` to Discord Gateway.
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
