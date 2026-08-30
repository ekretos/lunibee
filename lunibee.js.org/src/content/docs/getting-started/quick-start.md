---
title: Quick Start
description: Build your first Discord bot in 2 minutes with Lunibee.
---

# Quick Start

Let's build a fast, responsive Discord bot with Lunibee and Bun!

## 1. Set Up Environment Variables

Create a `.env` file in the root of your project:

```sh
DISCORD_TOKEN="your-bot-token-here"
```

Bun automatically loads variables from `.env` files with zero configuration!

## 2. Create `src/index.ts`

```ts
import { Client, GatewayIntentBits } from "lunibee";

const client = new Client({
  token: process.env.DISCORD_TOKEN!,
  intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent,
});

// Fired when the Gateway WebSocket connection is fully established
client.on("ready", (user) => {
  console.log(`🐝 Bot ready! Logged in as ${user.username} (${user.id})`);
});

// Fired on new message dispatch
client.on("messageCreate", async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  if (message.content === "!ping") {
    await message.reply({ content: "Pong! 🏓" });
  }
});

// Connect to Discord
await client.login();
```

## 3. Run the Bot

Start the bot with Bun:

```bash
bun run src/index.ts
```

Or run with hot-reloading during development:

```bash
bun --watch src/index.ts
```

Send `!ping` in any channel where the bot has access, and you should see an instant `Pong! 🏓` response!
