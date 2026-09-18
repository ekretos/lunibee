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
// Every dispatch, with its event name: emitted as "RAW".
gateway.on("RAW", ({ event, data }) => console.log("Received event:", event));
// Or listen for one Discord event by name.
gateway.on("MESSAGE_CREATE", (message) => console.log(message.content));

await gateway.connect();
```

### Constructor Options (`GatewayOptions`)

| Option | Type | Default | Description |
|---|---|---|---|
| `token` | `string` | Required | Discord Bot Authentication Token. |
| `intents` | `GatewayIntentResolvable` | Required | Gateway intent bitfield or resolvable. |
| `shardId` | `number` | `0` | Zero-based shard ID. |
| `shardCount` | `number` | `1` | Total number of shards. |
| `reconnect` | `boolean` | `true` | Automatically reconnect on network drops. |
| `maxReconnectAttempts` | `number` | `Infinity` | Maximum consecutive reconnection attempts. |
| `reconnectBaseDelay` | `number` | `1000` | First reconnect delay, doubled per attempt. |
| `reconnectMaxDelay` | `number` | `30000` | Ceiling for the reconnect backoff. |
| `heartbeatAckTimeout` | `number` | `10000` | How long to wait for a heartbeat ACK before reconnecting. |
| `zombieTimeout` | `number` | `30000` | Silence after which the connection is treated as dead. Must exceed `heartbeatAckTimeout`. |
| `compress` | `boolean` | `false` | Enable `zlib-stream` transport compression. |
| `properties` | `GatewayProperties` | Android defaults | Identify properties (`os`, `browser`, `device`). |
| `presence` | `GatewayPresence` | `online` | Initial presence sent with IDENTIFY. |

## Transport compression

`compress: true` appends `compress=zlib-stream` to the Gateway URL and decodes
frames with a persistent inflate stream, flushing on Discord's `Z_SYNC_FLUSH`
boundary (`00 00 FF FF`). Payloads split across several WebSocket frames are
buffered until that boundary arrives, and frames are decoded strictly in arrival
order.

```ts
const gateway = new Gateway({
  token: process.env.DISCORD_TOKEN!,
  intents: IntentBits.guilds,
  compress: true,
});
```

## Session lifecycle

`Gateway` delegates session identity to a `GatewaySession`, which owns the session
id, the last sequence number, the resume host, and the IDENTIFY-vs-RESUME decision.
It is exported for inspection and testing:

```ts
import { GatewaySession } from "@lunibee/ws";

const session = new GatewaySession();
const token = session.beginConnection();
session.recordSequence(1, token);
session.activate({ session_id: "abc", resume_gateway_url: "wss://resume" }, token);

session.canResume;      // true
session.handshake();    // { type: "resume", sessionId, sequence, resumeURL }
```

Each connection takes a **generation token**. Mutations must present it, so a socket
the Gateway has replaced cannot advance the live session's sequence or overwrite its
session id — including a compressed frame that finishes decoding after the swap.

`connect()` is idempotent: calling it on an already-connected Gateway returns without
opening a second socket, and it cancels any pending reconnect rather than racing it.
