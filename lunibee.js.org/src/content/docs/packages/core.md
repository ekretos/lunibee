---
title: "@lunibee/core"
description: Main Client coordinator, event emitter, and lifecycle state management.
---

The `@lunibee/core` package is the main place to start when building a Lunibee bot. It connects the Gateway, REST client, resource managers, and event system.

## Installation

```bash
bun add lunibee
```

## Create a Client

```ts
import { Client, GatewayIntentBits } from "lunibee";

const client = new Client({
  token: process.env.DISCORD_TOKEN!,
  intents:
    GatewayIntentBits.Guilds |
    GatewayIntentBits.GuildMessages |
    GatewayIntentBits.MessageContent,
});

client.on("ready", (user) => {
  console.log(`Logged in as ${user.username}!`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content === "!ping") {
    await message.reply("🏓 Pong!");
  }
});

await client.login();
```

## Constructor Options

| Option | Type | Default | Description |
|---|---|---|---|
| `token` | `string` | Required | Discord bot token. |
| `intents` | `number[] \| number \| string[]` | Required | Gateway intents to subscribe to. |
| `rest` | `RESTOptions` | `{}` | REST configuration. |
| `ws` | `GatewayOptions` | `{}` | Gateway configuration. |

## Useful Client Properties

- `client.user` — The authenticated bot user after login.
- `client.guilds` — Guild resources and cache.
- `client.channels` — Channel resources and cache.
- `client.users` — User resources and cache.
- `client.rest` — Low-level REST escape hatch.
- `client.ws` — Gateway connection.
- `client.uptime` — Ready uptime in milliseconds.
- `client.isReady()` — Whether the client is ready.

## Commands

Lunibee command registration is built around Discord's application-command REST endpoints. Build your command payload with `@lunibee/builders`, then register it through the command/application registration API exposed by your client or REST layer. If you need an endpoint that is not covered by a high-level helper, use `client.rest` with the corresponding route.

```ts
import { SlashCommandBuilder } from "lunibee";

const command = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Replies with Pong!");

const payload = command.toJSON();
```

> **Tip:** Keep command definitions separate from your event handlers. This makes it easier to deploy commands once while handling interactions every time the bot starts.

## Events

Use `client.on()` to listen for Gateway and client lifecycle events.

```ts
client.on("messageCreate", async (message) => {
  // Handle a new message.
});

client.on("interactionCreate", async (interaction) => {
  // Handle a button, select menu, modal, or command interaction.
});

client.on("ready", (user) => {
  // The client is ready.
});
```

Always check the required Gateway intent for events that depend on privileged or optional data.

## Lifecycle

```ts
await client.login();

// Later, when shutting down:
client.destroy();
```

`login()` establishes the Gateway connection and prepares REST access. `destroy()` closes the connection and cleans up pending work.

---

## `Collector<T>`

Collectors gather matching events for a period of time or until a limit is reached.

```ts
import { Collector } from "@lunibee/core";

const collector = new Collector(client, "messageCreate", {
  filter: (message) => message.author.id === targetUserId,
  max: 5,
  time: 30_000,
});

collector.on("collect", (message) => {
  console.log("Collected:", message.content);
});

collector.on("end", (collected, reason) => {
  console.log(`Finished: ${collected.length} items (${reason}).`);
});
```

## When to use `client.rest`

Prefer resource methods when Lunibee already provides them:

```ts
await message.edit({ content: "Updated" });
await message.channel.send({ content: "Hello" });
await message.channel.editName("support");
```

Use `client.rest` when you need direct control over a Discord endpoint that does not yet have a resource helper.
