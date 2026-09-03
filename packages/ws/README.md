# @lunibee/ws

> Discord Gateway (WebSocket) connection manager for the lunibee ecosystem.

Lunibee uses a single-connection `Gateway` (not a shard-manager). It exposes a
Discord.js-*familiar* surface — matching opcodes, close codes and lifecycle — while keeping
Lunibee's canonical names.

## Basic use

```ts
import { Gateway, GatewayIntentBits } from "@lunibee/ws";

const gateway = new Gateway({
    token: process.env.TOKEN!,
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
});

gateway.on("ready", (data) => console.log("Ready", data));
gateway.on("resumed", () => console.log("Resumed"));
gateway.on("close", ({ code, action }) => console.log("Closed", code, action));
gateway.on("error", (err) => console.error(err));

await gateway.connect(); // resolves once the socket opens
```

## Exports

| Export | Kind | Notes |
|---|---|---|
| `Gateway` | class | Canonical connection manager. |
| `GatewayOpcodes` | const | Discord opcode names → values. |
| `GatewayCloseCodes` | const | Discord close-code names → values (`AuthenticationFailed = 4004`, `InvalidSeq = 4007`, …). |
| `GatewayState` | enum | Lunibee lifecycle states. |
| `Status` | alias | `discord.js`-familiar alias of `GatewayState`. Values stay Lunibee strings (not numeric). |
| `GatewayError` | class | Thrown/emitted on gateway failures. |
| `GatewayOptions` | interface | Connection config. |

## Lifecycle behaviour

- **Heartbeats** with initial jitter, ACK tracking, and a stale-ACK / zombie close guard.
- **Reconnect** with exponential backoff + jitter (`reconnectBaseDelay`, `reconnectMaxDelay`,
  `maxReconnectAttempts`).
- **Resume vs re-identify** is chosen from the close/opcode:
  - `INVALID_SESSION` with `d: true` → keeps the session and **RESUMEs**; `d: false` →
    clears it and **re-IDENTIFYs** against the main Gateway.
  - `4007`/`4009` → fresh IDENTIFY; `4004`/`4010`–`4014` → fatal, stops reconnecting.
- A successful `RESUMED` resets the reconnect backoff and emits `resumed`.
