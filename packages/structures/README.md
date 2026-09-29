# @lunibee/structures

> Typed wrappers around Discord payloads: messages, channels, guilds, members, roles and interactions.

```bash
bun add @lunibee/structures
```

```ts
import { createChannel, ThreadChannel, GuildMember } from "@lunibee/structures";

const channel = createChannel({ id: "123456789012345678", type: 11 });
if (channel instanceof ThreadChannel) console.log(channel.archived, channel.messageCount);
channel.isThread(); // true

const member = new GuildMember({
    user: { id: "223456789012345678", username: "bee" },
    guild_id: "323456789012345678",
    roles: [],
});
console.log(member.displayName, member.displayAvatarURL());
```

## What's inside

- **Messages**: `Message` with `reply`, `edit`, `delete`, `react`, `pin`, flag getters and `createdTimestamp`.
- **Channels**: `Channel` plus `TextChannel`, `NewsChannel`, `DMChannel`, `VoiceChannel`,
  `StageChannel`, `CategoryChannel`, `ThreadChannel`, `ForumChannel`, `MediaChannel`.
  `createChannel(data)` picks the class from `type`; `isThread()`, `isTextBased()`,
  `isVoiceBased()`, `isDMBased()` narrow.
- **Guild entities**: `Guild`, `GuildMember`, `Role`, `Emoji`, `Invite`, `Webhook`,
  `AutoModerationRule`, `GuildWelcomeScreen`, `GuildOnboarding`, `AuditLog`.
- **Interactions**: `CommandInteraction`, `ComponentInteraction`, `ModalSubmitInteraction`,
  `AutocompleteInteraction`, built by `createInteraction()`. Guards include
  `isChatInputCommand()`, `isButton()`, `isStringSelectMenu()`, `isAnySelectMenu()`,
  `isModalSubmit()`, `isAutocomplete()`. `interaction.options` resolves options,
  including `getFocused()` for autocomplete.
- `PermissionsBitField` is re-exported from `@lunibee/core`.

Structures attached to a client (via a `ResourceContext`) can call Discord directly;
detached ones throw on those methods.

## What's new in 0.2.1

- `message.member`: the author as a guild member on guild messages.
- `GuildMember.permissions` is computed from the cached roles when Discord did not send it; `permissionsIn(channelId)`.
- `GuildMember` actions: `kick`, `ban`, `timeout`, `setNickname`, `addRole`, `removeRole`, `edit`.
- `channel.editPermissionOverwrite(id, { ViewChannel: true, SendMessages: false })`.
- `message.createComponentCollector()`, `message.awaitComponent()`, `interaction.awaitModalSubmit()`.
- `showModal()` takes a builder; `deferReply({ ephemeral })`; `options.getMentionableType()`; `ComponentInteraction.messageId`.

## What's new in 0.2.0

Interactions: single acknowledgement guard, `fetchReply()`, `editFollowUp()`, `deleteFollowUp()`, `user`, `member`, `expiresAt`/`isExpired`. Channels: typed `permissionOverwrites`.

Docs: https://lunibee.js.org/core-concepts/caching/
