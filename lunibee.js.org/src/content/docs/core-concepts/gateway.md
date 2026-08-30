---
title: Gateway & WebSocket
description: Discord WebSocket connection handling, heartbeat tracking, and zombie connection recovery.
---

# Gateway & WebSocket

`@lunibee/ws` manages the low-level Discord WebSocket connection, opcode routing, sequence tracking, and session resumption.

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

## Heartbeat Acknowledgements & Zombie Detection

In unstable network conditions, a TCP socket may silently drop without emitting a close event. Lunibee actively monitors Heartbeat Acknowledgments (`Opcode 11`).

If Discord fails to acknowledge a heartbeat before the next one is due, Lunibee:
1. Marks the connection as unhealthy (`zombie`).
2. Immediately closes and destroys the stale socket.
3. Automatically attempts a session resume using the cached `resume_gateway_url` and session ID.

## Standalone Gateway Usage

You can use `@lunibee/ws` independently if you're building custom microservices:

```ts
import { Gateway } from "@lunibee/ws";

const gateway = new Gateway({
  token: process.env.DISCORD_TOKEN!,
  intents: 513,
});

gateway.on("dispatch", (packet) => {
  console.log(`Received event: ${packet.t}`, packet.d);
});

await gateway.connect();
```
