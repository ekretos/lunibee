---
title: Quick Start
description: Build your first Discord bot in 2 minutes with Lunibee.
---

Let's build a small, useful Discord bot with Lunibee and Bun.

## 1. Create the project

```bash
mkdir my-bot
cd my-bot
bun init
bun add lunibee
```

## 2. Add your token

Create a `.env` file:

```sh
DISCORD_TOKEN="your-bot-token-here"
```

Never commit your real bot token to Git.

## 3. Create `src/index.ts`

```ts
import { Client, IntentBits } from "lunibee";

const client = new Client({
  token: process.env.DISCORD_TOKEN!,
  intents:
    IntentBits.guilds |
    IntentBits.guildMessages |
    IntentBits.messageContent,
});

client.on("ready", (user) => {
  console.log(`🐝 Logged in as ${user.username} (${user.id})`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content === "!ping") {
    await message.reply("Pong! 🏓");
  }
});

await client.login();
```

## 4. Run it

```bash
bun run src/index.ts
```

During development:

```bash
bun --watch src/index.ts
```

Send `!ping` in a channel the bot can access.

## What next?

Once the bot is running, these are the most useful next steps:

```ts
// Send a message
await channel.send({ content: "Hello!" });

// Edit a message
await message.edit({ content: "Updated!" });

// Get a message's channel
const channel = message.channel;

// Rename a channel
await channel.editName("support");

// Reply to an interaction
await interaction.reply({ content: "Done!" });
```

For slash commands, build the command with `SlashCommandBuilder`, register its payload through the application-command API, and handle it with `interactionCreate`. See the **Builders** and **Interactions** guides for the command payload and interaction lifecycle.
