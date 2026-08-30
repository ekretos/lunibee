---
title: Graceful Shutdown
description: Safely stopping bot connections, clearing timers, and closing WebSockets.
---

# Graceful Shutdown

In production environments like Docker, Kubernetes, or VPS managers, your process will receive `SIGINT` or `SIGTERM` signals.

It is best practice to cleanly destroy the client:

```ts
import { Client, GatewayIntentBits } from "lunibee";

const client = new Client({
  token: process.env.DISCORD_TOKEN!,
  intents: GatewayIntentBits.Guilds,
});

await client.login();

async function handleShutdown(signal: string) {
  console.log(`\nReceived ${signal}. Shutting down Lunibee gracefully...`);
  
  // Closes WebSocket Gateway, clears heartbeat timers, and settles pending requests
  client.destroy();

  console.log("Client destroyed. Process exiting.");
  process.exit(0);
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
```
