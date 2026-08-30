---
title: Gateway & WebSocket
description: Discord WebSocket connection handling, presence updates, heartbeat tracking, and zombie recovery.
---

# Gateway & WebSocket

`@lunibee/ws` manages the low-level Discord WebSocket connection, opcode routing, sequence tracking, custom presence, and session resumption.

## The Gateway Protocol Loop

```text
CONNECT ──► HELLO (Opcode 10) ──► IDENTIFY / RESUME
                 │
                 ▼
        Start Heartbeat Timer
                 │
        HEARTBEAT ──► HEARTBEAT_ACK
                 │
                 ├── (Missed ACK detected) ──► TERMINATE & RECONNECT (Zombie defense)
                 └── (Opcode 7 / 9)       ──► RESUME or FULL RECONNECT
```

## Presence & Mobile Indicators

You can configure custom device properties and initial presence payloads directly on the Gateway:

```ts
import { Gateway } from "@lunibee/ws";

const gateway = new Gateway({
  token: process.env.DISCORD_TOKEN!,
  intents: 513,
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
});

// Update presence dynamically at any time
gateway.setPresence({
  status: "idle",
  activities: [{ name: "with Bun", type: 0 }],
});
```

## Privileged Presence Intent (`GuildPresences`)

To receive real-time presence update events (`PRESENCE_UPDATE`) for members in guilds, your bot must request the privileged **Guild Presences** intent:

```ts
import { GatewayIntentBits } from "lunibee";

const intents = GatewayIntentBits.Guilds | GatewayIntentBits.GuildPresences;
```

> Note: The **Guild Presences** intent must be toggled on in the Discord Developer Portal under your Application's **Bot** tab.

## Heartbeat Acknowledgements & Zombie Detection

In unstable network conditions, a TCP socket may silently drop without emitting a close event. Lunibee actively monitors Heartbeat Acknowledgments (`Opcode 11`).

If Discord fails to acknowledge a heartbeat before the next one is due, Lunibee:
1. Marks the connection as unhealthy (`zombie`).
2. Immediately closes and destroys the stale socket.
3. Automatically attempts a session resume using the cached `resume_gateway_url` and session ID.
