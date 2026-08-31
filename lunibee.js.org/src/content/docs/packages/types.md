---
title: "@lunibee/types"
description: Complete TypeScript type definitions and enums for Discord API v10.
---

The `@lunibee/types` package contains the TypeScript types, enums, flags, event payloads, and constants used throughout Lunibee.

## Installation

```bash
bun add @lunibee/types
```

Most applications can import these from `lunibee` instead of installing this package directly.

## Common Constants

```ts
import {
  IntentBits,
  ChannelType,
  MessageFlags,
  ApplicationCommandType,
  ApplicationCommandOptionType,
  InteractionType,
} from "@lunibee/types";

const intents = IntentBits.guilds | IntentBits.guildMessages;
const channelType = ChannelType.GuildText;
const flags = MessageFlags.Ephemeral;
```

## Intents

Gateway intents control which events and data your bot receives. Only request the intents your bot needs.

```ts
const client = new Client({
  token: process.env.DISCORD_TOKEN!,
  intents: IntentBits.guilds | IntentBits.guildMessages,
});
```

Some intents are privileged and must also be enabled for your bot in the Discord Developer Portal.

## Channel Types

Use `ChannelType` when an API expects a Discord channel type rather than a string.

```ts
if (channel.type === ChannelType.GuildText) {
  console.log("Text channel");
}
```

## Message Flags

Flags describe special message behavior.

```ts
if ((message.flags & MessageFlags.Ephemeral) !== 0) {
  console.log("Ephemeral message");
}
```

## Interaction Types

`InteractionType` identifies the kind of Discord interaction being handled, while application-command option types describe command arguments.

Use the types package when you are writing lower-level integrations or need precise payload typing. For everyday bot code, Lunibee's structures, builders, and interaction classes are usually easier to work with.
