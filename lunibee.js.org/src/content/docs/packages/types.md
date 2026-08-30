---
title: "@lunibee/types"
description: Complete TypeScript type definitions and enums for Discord API v10.
---

The `@lunibee/types` package provides complete TypeScript type definitions, Gateway event interfaces, and constants for the Discord API v10.

## Installation

```bash
bun add @lunibee/types
```

---

## Enums & Constants

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
