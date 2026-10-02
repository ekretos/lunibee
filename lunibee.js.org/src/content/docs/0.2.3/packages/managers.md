---
title: "@lunibee/managers"
description: Resource Managers for Channels, Messages, Members, Roles, and Guilds.
slug: 0.2.3/packages/managers
---

Managers are the lower-level resource and cache layer behind Lunibee's high-level client APIs. They are useful when you need to fetch, cache, or operate on resources by ID.

## Installation

```bash
bun add lunibee
```

> For most bot code, prefer `client.guilds`, `client.channels`, `message.channel`, and other resource objects. Use managers directly when you need ID-based operations or custom integrations.

## `ChannelManager`

```ts
const channels = client.channels;

const message = await channels.send(channelId, {
  content: "Hello from ChannelManager!",
});

await channels.editMessage(channelId, message.id, {
  content: "Edited text",
});

await channels.deleteMessage(channelId, message.id);
```

### Messages and pins

```ts
await channels.bulkDeleteMessages(channelId, [msg1, msg2, msg3]);
await channels.pinMessage(channelId, messageId);
await channels.unpinMessage(channelId, messageId);
const pins = await channels.fetchPinnedMessages(channelId);
```

## `ApplicationCommandManager`

Use this manager to register, fetch, replace, edit, and delete slash/application commands.

```ts
const commands = new ApplicationCommandManager(
  client.rest,
  applicationId,
);

await commands.create({
  name: "ping",
  description: "Replies with Pong!",
});
```

### Register multiple commands at once

```ts
await commands.set([
  {
    name: "ping",
    description: "Replies with Pong!",
  },
  {
    name: "help",
    description: "Shows help information.",
  },
]);
```

### Guild commands

Guild commands are useful during development because they are scoped to one guild.

```ts
await commands.createGuild(guildId, {
  name: "ping",
  description: "Replies with Pong!",
});
```

The manager also provides `fetch()`, `edit()`, `delete()`, `fetchGuild()`, `setGuild()`, `editGuild()`, and `deleteGuild()`.

## `GuildMemberManager`

```ts
const members = client.guilds.members(guildId);

await members.kick(userId, "Rule violation");
await members.ban(userId, {
  reason: "Severe spamming",
  deleteMessageSeconds: 86400,
});
await members.unban(userId, "Appeal accepted");
await members.timeout(userId, 600_000, "10-minute mute");

await members.addRole(userId, roleId);
await members.removeRole(userId, roleId);
```

## `EmojiManager`

Provides methods for fetching, creating, editing, and deleting emojis in a guild.

```ts
const emojis = client.guilds.emojis(guildId);

// Create a new emoji
await emojis.create({
  name: "lunibee",
  image: "data:image/png;base64,...",
  reason: "Server mascot",
});

// Edit an emoji
await emojis.edit(emojiId, {
  name: "new_name",
});

// Delete an emoji on Discord
await emojis.remove(emojiId, "No longer used");
```

`emojis.delete(emojiId)` only drops the emoji from the cache; use `remove()` to delete it on Discord.

## Audit-log reasons

Every manager follows one rule, so the reason is always in the same place:

* If the method takes an options object, the reason goes in it: `roles.create({ name, reason })`, `channels.edit(id, { name, reason })`, `members.ban(userId, { reason })`.
* Otherwise it is the last argument: `roles.remove(roleId, reason)`, `members.kick(userId, reason)`, `members.unban(userId, reason)`.

Lunibee sends it as the `X-Audit-Log-Reason` header, never in the request body. To delete something on Discord, managers use `remove()`; `delete()` only drops an entry from the cache.

| Deprecated (removed in 0.3.0) | Use |
|---|---|
| `roles.deleteRole(id)` | `roles.remove(id, reason?)` |
| `emojis.deleteEmoji(id)` | `emojis.remove(id, reason?)` |
| `channels.deleteChannel(id)` | `channels.remove(id, reason?)` |
| `guilds.deleteGuild(id)` | `guilds.remove(id)` |
| `channels.sendMessage(id, payload)`, `channel.sendMessage(payload)` | `channels.send(id, payload)`, `channel.send(payload)` |
| `members.edit(id, options, reason)` | `members.edit(id, { ...options, reason })` |

## From `Routes` to methods

`guilds` and `channels` are `client.guilds` and `client.channels`. Prefer a method over `client.rest` with `Routes`: it updates the cache, returns a structure, and takes the audit-log reason in the usual place.

| Instead of | Use |
|---|---|
| `rest.patch(Routes.guildMember(g, u), body)` | `guilds.members(g).edit(u, { ...body, reason })` |
| `rest.put` / `rest.delete(Routes.guildMemberRole(g, u, r))` | `guilds.members(g).addRole(u, r, reason)` / `members.removeRole(u, r, reason)` |
| `rest.put` / `rest.get` / `rest.delete(Routes.guildBan(g, u))` | `members.ban(u, { reason })`, `guilds.bans(g).fetch(u)`, `members.unban(u, reason)` |
| `rest.delete(Routes.guildMember(g, u))` | `members.kick(u, reason)` |
| `rest.post(Routes.guildRoles(g), body)` | `guilds.roles(g).create({ ...body, reason })` |
| `rest.patch(Routes.guildRoles(g), positions)` | `guilds.roles(g).setPositions(positions, reason)` |
| `rest.patch` / `rest.delete(Routes.guildRole(g, r))` | `roles.edit(r, { ...body, reason })` / `roles.remove(r, reason)` |
| `rest.patch(Routes.guild(g), body)` | `guilds.edit(g, { ...body, reason })` |
| `rest.get` / `rest.patch` / `rest.delete(Routes.channel(c))` | `channels.fetch(c)`, `channels.edit(c, { ...body, reason })`, `channels.remove(c, reason)` |
| `rest.post(Routes.channelMessages(c), body)` | `channels.send(c, body)` |
| `rest.delete(Routes.message(c, m))` | `channels.deleteMessage(c, m, reason)` |
| `rest.put` / `rest.delete(Routes.channelMessagesPin(c, m))` | `channels.pinMessage(c, m, reason)` / `channels.unpinMessage(c, m, reason)` |
| `rest.put` / `rest.delete(Routes.messageReactions(c, m, e))` | `channels.addReaction(c, m, e)` / `channels.removeAllReactions(c, m)` |
| `rest.post(Routes.messageThread(c, m), body)` | `channels.createThreadFromMessage(c, m, body)` |
| `rest.put(Routes.channelPermission(c, id), body)` | `channels.permissionOverwrites(c).edit(id, { ...body, reason })` |
| `rest.post(Routes.channelWebhooks(c), body)` | `channels.createWebhook(c, { ...body, reason })` |
| `rest.post(Routes.guildEmoji(g), body)` | `guilds.emojis(g).create({ ...body, reason })` |
| `rest.delete(Routes.guildSticker(g, s))` | `guilds.stickers(g).remove(s, reason)` |

## Guild resource managers

* `guilds.bans(guildId)`: `GuildBanManager` (`fetch`, `fetchAll`, `create`, `remove`)
* `guilds.scheduledEvents(guildId)`: `GuildScheduledEventManager`
* `channels.permissionOverwrites(channelId)`: `PermissionOverwriteManager`
* `client.stageInstances`: `StageInstanceManager`

See [Caching & Structures](/0.2.3/core-concepts/caching/#guild-resource-managers).

## When should I use a manager?

Use a manager when you already have IDs and want a direct operation:

```ts
await channels.deleteMessage(channelId, messageId);
```

Use a resource when you already have the object:

```ts
await message.delete();
```

Both approaches are valid. Resources are generally easier to read; managers are useful for bulk, lookup, or ID-based workflows.

## What's New in 0.2.0

Per-guild `members()`, `roles()`, `emojis()`, `stickers()`, `soundboard()`, `voiceStates()`, `autoModerationRules()` and `invites()`; `MonetizationManager`; fetch deduplication and stale-result protection; `iterateMessages()`, poll and soundboard helpers; opt-in message cache.
