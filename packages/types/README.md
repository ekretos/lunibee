# @lunibee/types

> Discord API v10 payload types, enums and intent helpers shared by every Lunibee package.

```bash
bun add @lunibee/types
```

```ts
import {
    GatewayIntentBits,
    IntentsBitField,
    resolveGatewayIntents,
    ChannelEnum,
    MessageFlags,
    type APIMessage,
} from "@lunibee/types";

const intents = new IntentsBitField(["Guilds", "GuildMessages"]);
intents.add(GatewayIntentBits.MessageContent);
resolveGatewayIntents(["Guilds", "GuildMessages"]); // number bitfield

function isText(message: APIMessage, channelType: number): boolean {
    return channelType === ChannelEnum.GuildText && !(message.flags! & MessageFlags.Ephemeral);
}
```

## What's inside

- `API*` payload interfaces: messages, channels, guilds, members, roles, emoji, stickers,
  invites, webhooks, automod, audit logs, scheduled events, stage instances, application
  commands, interactions and every gateway event (`APIReadyEvent`, `APIGuildBanEvent`, …).
- Enums/consts: `ChannelEnum`, `ComponentEnum`, `ButtonType`, `MessageFlags`,
  `ApplicationCommandEnum`, `ApplicationCommandOptionEnum`,
  `InteractionResponseEnum`, `VerificationLevel`, `PremiumTier`, `StickerEnum`, …
- Intents: `GatewayIntentBits` (PascalCase), `IntentBits` / `Intents` (camelCase),
  `IntentsBitField`, `resolveGatewayIntents`, `GatewayIntentResolvable`.
- Gateway config types: `GatewayOptions`, `GatewayPresence`, `GatewayProperties`.

The package has no runtime dependencies.

## What's new in 0.2.1

- `ButtonType`, `TextInputType`, `ComponentEnum` and `MessageFlags` are usable as types.
- `APIMessage.member`: the author's guild member on Gateway messages.

