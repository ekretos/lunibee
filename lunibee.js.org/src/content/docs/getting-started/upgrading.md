---
title: Upgrading
description: Code changes needed when upgrading from 0.1.8 to 0.2.0, and from 0.2.0 to 0.2.1.
---

## 0.2.1 → 0.2.2

**One behaviour change:** `interaction.isChatInputCommand()` is now true for slash
commands only, not for user and message context-menu commands. If you used it to
catch every application command, use `isCommand()`; for context menus use
`isContextMenuCommand()` (see [Context Menus](/recipes/context-menus/)).

**Remove workarounds:** if you set `zombieTimeout: Infinity` because healthy
connections kept reconnecting, remove it; that bug is fixed.

The old names keep working until 2.0. To move to the new names, rename imports and uses:

| Before | Now |
|---|---|
| `ButtonBuilder`, `EmbedBuilder`, `ModalBuilder`, `SlashCommandBuilder`… (every `XBuilder`) | `CreateButton`, `CreateEmbed`, `CreateModal`, `CreateSlashCommand`… (`CreateX`) |
| `ButtonStyle`, `TextInputStyle` | `ButtonType`, `TextInputType` |
| `ChannelType`, `ComponentType`, `InteractionType`, `InteractionResponseType` | `ChannelEnum`, `ComponentEnum`, `InteractionEnum`, `InteractionResponseEnum` |
| `ApplicationCommandType`, `ApplicationCommandOptionType` | `ApplicationCommandEnum`, `ApplicationCommandOptionEnum` |
| `StickerType`, `StickerFormatType`, `WebhookType`, `PermissionOverwriteType` | `StickerEnum`, `StickerFormatEnum`, `WebhookEnum`, `PermissionOverwriteEnum` |
| *(new)* | `ActivityEnum` (`Playing`, `Streaming`, `Listening`, `Watching`, `Custom`, `Competing`) |

```ts
// before
import { ButtonBuilder, ButtonStyle, ChannelType } from "lunibee";
new ButtonBuilder().setStyle(ButtonStyle.Primary);

// now
import { CreateButton, ButtonType, ChannelEnum } from "lunibee";
new CreateButton().setStyle(ButtonType.Primary);
```

## 0.2.0 → 0.2.1

0.2.1 adds APIs and needs no code changes, with two things to know:

- **`GuildMember.permissions` is computed.** Members that did not come with
  permissions from Discord (from the Gateway, the member cache or a fetch)
  used to report `0`. They now report their guild-level permissions from the
  cached roles, read fresh each time. If you relied on `0` meaning "unknown",
  check `client.guilds.roles(guildId).size` instead. Interaction members still
  report Discord's value.
- **`CreateModal.toJSON()`** is typed with a required `custom_id` and `title`
  (it already required them at runtime).

See the [changelog](/getting-started/changelog/) for the new APIs.

## 0.1.8 → 0.2.0

Most bots need no changes. Check each item below that applies to you.

## Message cache is opt-in

Messages are no longer cached. If you read old message content on
`messageUpdate` / `messageDelete`, or call `channels.messages(id).resolve()`
expecting a cache hit, enable a bounded cache:

```ts
const client = new Client({
  token,
  intents,
  messageCache: { maxSize: 200, ttl: 30 * 60_000 },
});

client.on("messageUpdate", (message, previous) => {
  // previous: the cached version before the edit, if it was still cached
});
client.on("messageDelete", (data, message) => {
  // message: the cached message that was deleted, if any
});
```

With the cache enabled, messages from `MESSAGE_CREATE` and REST are cached.
The previous version is only available for messages that arrived while the
client was running and are still within the cache's `maxSize` and `ttl`.

## Builders throw on incomplete components

`toJSON()` now rejects components Discord would reject. Typical fixes:

```ts
// Before: accepted locally, rejected by Discord
new CreateButton().setCustomId("ok");
// After: give it a label or an emoji
new CreateButton().setCustomId("ok").setLabel("OK");

// A select must be alone in its action row, and needs a custom ID.
new CreateActionRow().addComponents(
  new CreateStringSelect().setCustomId("pick").addOptions({ label: "A", value: "a" }),
);
```

## `bulkDeleteMessages()`

- A single ID is now allowed (it becomes a normal delete); an empty list throws.
- Messages older than 14 days throw a `RangeError` before any request. Delete
  those one by one with `deleteMessage()`.

## Cached objects are updated in place

Updates from the Gateway and `upsert()` modify the object you already hold
instead of swapping in a new one. By the time a `guildUpdate` (or member,
role, channel) handler runs, the cached object already has the new values, so
copying fields inside the handler cannot recover the old state. If you need a
before/after comparison, keep your own snapshot of the fields you care about
(for example when you first see the resource) and compare against it in the
handler. Messages are the exception: `messageUpdate` receives the previous
cached message as its second argument.

## `RESTError.path` is redacted

Webhook and interaction tokens in `error.path` (and REST hook contexts) are
replaced with `:token`. Log `error.path` freely; if you parsed the token out
of it, keep the token from where you created the request instead.
