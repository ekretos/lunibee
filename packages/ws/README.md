# @lunibee/ws

> Discord Gateway (WebSocket) connection manager for the lunibee ecosystem.

Lunibee uses a single-connection `Gateway` (sharding lives in `@lunibee/sharding`). It
exposes a discord.js-*familiar* surface (opcodes, close codes, lifecycle) while keeping
Lunibee's canonical names.

```bash
bun add @lunibee/ws
```

## Basic use

```ts
import { Gateway } from "@lunibee/ws";
import { GatewayIntentBits } from "@lunibee/types";

const gateway = new Gateway({
    token: process.env.TOKEN!,
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
});

gateway.on("ready", (data) => console.log("Ready", data));
gateway.on("resumed", () => console.log("Resumed"));
gateway.on("close", (data) => console.log("Closed", data)); // { code, action }
gateway.on("error", (err) => console.error(err));

await gateway.connect(); // resolves once the socket opens
```

Every dispatch is also emitted under its Discord name (`READY`, `MESSAGE_CREATE`, …), plus
`RAW`, `open`, `close`, `error`, `stateChange`, `heartbeatAck`, `invalidSession` and `zombie`.

## Exports

| Export | Kind | Notes |
|---|---|---|
| `Gateway` | class | Canonical connection manager. |
| `GatewayOpcodes` | const | Discord opcode names → values. |
| `GatewayCloseCodes` | const | Discord close-code names → values (`AuthenticationFailed = 4004`, `InvalidSeq = 4007`, …). |
| `GatewayState` | enum | Lunibee lifecycle states. |
| `Status` | alias | discord.js-familiar alias of `GatewayState`. Values stay Lunibee strings. |
| `GatewayError` | class | Thrown/emitted on gateway failures. |
| `GatewayOptions` | interface | Connection config (`compress`, `shardId`/`shardCount`, reconnect tuning, `createSocket`). |

## Lifecycle behaviour

- **Heartbeats** with initial jitter, ACK tracking, and a stale-ACK / zombie close guard.
- **Reconnect** with exponential backoff + jitter (`reconnectBaseDelay`, `reconnectMaxDelay`,
  `maxReconnectAttempts`).
- **Resume vs re-identify** is chosen from the close/opcode:
  - `INVALID_SESSION` with `d: true` → keeps the session and **RESUMEs**; `d: false` →
    clears it and **re-IDENTIFYs** against the main Gateway.
  - `4007`/`4009` → fresh IDENTIFY; `4004`/`4010`–`4014` → fatal, stops reconnecting.
- A successful `RESUMED` resets the reconnect backoff and emits `resumed`.
- **Send budget**: application sends are capped at 115 per 60 s; heartbeats, IDENTIFY and
  RESUME always go out.
- **Compression**: `compress: true` decodes Discord's `zlib-stream` in arrival order.

Internally the gateway is split into transport, heartbeat, session, reconnect, protocol,
decoder and send-budget modules.
