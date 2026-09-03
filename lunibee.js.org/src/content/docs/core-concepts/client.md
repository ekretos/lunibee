---
title: Client & Gateway Lifecycle
description: Initializing the Lunibee Client, configuring intents, presence, and event dispatching.
---

The `Client` class in `lunibee` is the primary orchestrator that connects the REST API, Gateway WebSocket, caching layers, and event dispatchers into a cohesive bot interface.

## Initialization & Intents

Lunibee supports specifying intents as arrays or bitwise OR combinations. The public constants are:

- `IntentBits` — idiomatic camelCase constants.
- `GatewayIntentBits` — Discord-standard PascalCase constants.
- `Intents` — alias for `IntentBits`.

### Using `IntentBits` (Recommended)
```ts
import { Client, IntentBits } from "lunibee";

const client = new Client({
  token: process.env.DISCORD_TOKEN!,
  intents: [
    IntentBits.guilds,
    IntentBits.guildMessages,
    IntentBits.messageContent,
  ],
});
```

### Using `GatewayIntentBits`
```ts
import { Client, GatewayIntentBits } from "lunibee";

const client = new Client({
  token: process.env.DISCORD_TOKEN!,
  intents:
    GatewayIntentBits.Guilds |
    GatewayIntentBits.GuildMessages |
    GatewayIntentBits.MessageContent,
});
```

## Gateway Intents Reference

| PascalCase (`GatewayIntentBits`) | camelCase (`IntentBits`) | Bit Shift | Type |
| :--- | :--- | :--- | :--- |
| `Guilds` | `guilds` | `1 << 0` | Standard |
| `GuildMembers` | `guildMembers` | `1 << 1` | Privileged |
| `GuildModeration` | `guildModeration` | `1 << 2` | Standard |
| `GuildExpressions` | `guildExpressions` | `1 << 3` | Standard |
| `GuildIntegrations` | `guildIntegrations` | `1 << 4` | Standard |
| `GuildWebhooks` | `guildWebhooks` | `1 << 5` | Standard |
| `GuildInvites` | `guildInvites` | `1 << 6` | Standard |
| `GuildVoiceStates` | `guildVoiceStates` | `1 << 7` | Standard |
| `GuildPresences` | `guildPresences` | `1 << 8` | Privileged |
| `GuildMessages` | `guildMessages` | `1 << 9` | Standard |
| `GuildMessageReactions` | `guildMessageReactions` | `1 << 10` | Standard |
| `GuildMessageTyping` | `guildMessageTyping` | `1 << 11` | Standard |
| `DirectMessages` | `directMessages` | `1 << 12` | Standard |
| `DirectMessageReactions` | `directMessageReactions` | `1 << 13` | Standard |
| `DirectMessageTyping` | `directMessageTyping` | `1 << 14` | Standard |
| `MessageContent` | `messageContent` | `1 << 15` | Privileged |
| `GuildScheduledEvents` | `guildScheduledEvents` | `1 << 16` | Standard |
| `AutoModerationConfiguration` | `autoModerationConfiguration` | `1 << 20` | Standard |
| `AutoModerationExecution` | `autoModerationExecution` | `1 << 21` | Standard |
| `GuildMessagePolls` | `guildMessagePolls` | `1 << 24` | Standard |
| `DirectMessagePolls` | `directMessagePolls` | `1 << 25` | Standard |

## Privileged Intents

`GuildMembers`, `GuildPresences`, and `MessageContent` are privileged Gateway intents and must be enabled for the bot in the Discord Developer Portal before use.

## Managing Bot Presence

```ts
client.setPresence({
  status: "online",
  activities: [
    {
      name: "custom_status",
      state: "⚡ Running on Bun & Lunibee",
      type: 4,
    },
  ],
});
```

## Client Properties

### `ping`
Returns the current WebSocket ping in milliseconds. This value is updated continuously as heartbeats are exchanged with the gateway.

```ts
console.log(`Current ping: ${client.ping}ms`);
```

## Client Methods

### Utility Fetchers
The client exposes several top-level methods to fetch resources without needing a cached guild or channel:

- `fetchWebhook(id, token?)`: Fetches a webhook.
- `fetchGuildPreview(guildId)`: Fetches preview information for a guild.
- `fetchVoiceRegions()`: Returns an array of available voice regions.
- `generateInvite(options)`: Generates a bot invite link based on the provided permissions and scopes.
- `fetchInvite(code, options?)`: Fetches an invite by its code.
- `fetchSticker(id)`: Fetches a specific sticker by its ID.
- `fetchPremiumStickerPacks()`: Fetches the list of premium sticker packs.
- `fetchGuildTemplate(code)`: Fetches a guild template by its code.

### `setVoiceState`
Updates the client's voice state in a guild. Used to connect to, move between, or disconnect from voice channels.

```ts
client.setVoiceState(guildId, channelId, {
  selfDeaf: false,
  selfMute: true,
});
```

### `requestGuildMembers`
Requests offline or all members for a guild. This requires the `GuildMembers` intent.

```ts
client.requestGuildMembers(guildId, {
  query: "",
  limit: 0,
});
```

## Client Events

In addition to standard entity events (like `MessageCreate`), the client emits events related to the gateway session lifecycle:

- `Ready`: Emitted when the client connects and identifies successfully.
- `Resumed`: Emitted when the client successfully resumes a dropped WebSocket connection without needing to re-identify.
- `InvalidSession`: Emitted when the gateway rejects the session. Depending on the payload, the client will either attempt to resume or start a fresh session.
