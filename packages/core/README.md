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

## What's new in 0.2.1

- Members built by the client can act on themselves and compute their permissions from the cached roles (see `@lunibee/structures`).
- `client.resourceContext` is shared with structures from interactions.
- Files in interaction replies (`reply`, `editReply`, `followUp`, `update`) are uploaded.
- Renamed permission names (`ManageEmojisAndStickers`, `ManageEmojis`, `UseSlashCommands`) still resolve.

## What's new in 0.2.0

`messageCache` and `cache` client options, `client.permissionsFor()`, `client.createCollector()`, `client.monetization`, `computePermissions()`, `PermissionSet.missing()`, collector `idle`/`signal`/async iteration, entitlement and soundboard events, and the previous/deleted message on `messageUpdate`/`messageDelete`/`messageDeleteBulk`.

Docs: https://lunibee.js.org/core-concepts/client/
