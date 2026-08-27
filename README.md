# Lunibee 🐝

A lightweight, Bun-first Discord API library for TypeScript.

## Goals

- Bun-native runtime
- Small dependency footprint
- Discord REST and Gateway support
- Reliable reconnect and resume handling
- TypeScript-first API
- Fast startup and low overhead

## Example

```ts
import { Client, GatewayIntentBits } from "lunibee";

const client = new Client({
    token: process.env.DISCORD_TOKEN!,
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages
});

client.on("ready", user => {
    console.log(`Ready as ${user.username}`);
});

await client.login();
```

## Status

Early development. The API is expected to change before the first stable release.
