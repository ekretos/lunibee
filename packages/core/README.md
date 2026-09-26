# @lunibee/core

> The Lunibee `Client`: gateway lifecycle, event dispatch, caches, permissions and collectors.

```bash
bun add @lunibee/core
```

```ts
import { Client, IntentsBitField, Events } from "@lunibee/core";

const client = new Client({
    token: process.env.DISCORD_TOKEN!,
    intents: new IntentsBitField(["Guilds", "GuildMessages", "MessageContent"]),
});

client.on(Events.Ready, (user) => console.log(`Ready as ${user.username}`));
client.on("interactionCreate", async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === "ping")
        await interaction.reply({ content: "Pong!" });
});

await client.login();
```

## What's inside

| Export | Purpose |
|---|---|
| `Client` | Connects to the gateway, emits typed events, owns `rest`, `users`, `guilds`, `channels`, `stageInstances`, `application.commands`. |
| `ClientEvent` / `Events` | Event names (`Events` is the discord.js-familiar alias). `ClientEvents` types every payload. |
| `PermissionSet` / `PermissionsBitField` | Bigint permission bitfields: `has`, `any`, `add`, `remove`, `toArray`. |
| `Collector` | Collects items until `time`, `max` or `maxProcessed` is reached. |
| `GatewayIntentBits`, `IntentBits`, `IntentsBitField`, `resolveGatewayIntents` | Intents in every accepted form. |

Utility methods on the client include `generateInvite()`, `fetchInvite()`,
`fetchWebhook()`, `fetchVoiceRegions()`, `fetchSticker()`, `setPresence()` and
`requestGuildMembers()`. Call `client.destroy()` on shutdown.

Docs: https://lunibee.js.org/core-concepts/client/
