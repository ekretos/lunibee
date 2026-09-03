---
title: "@lunibee/managers"
description: Resource Managers for Channels, Messages, Members, Roles, and Guilds.
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
const guild = client.guilds.get(guildId);
if (!guild) throw new Error("Guild not cached");
const members = guild.members;

await members.kick(userId, "Rule violation");
await members.ban(userId, {
  reason: "Severe spamming",
  deleteMessageSeconds: 86400,
});
await members.unban(userId);
await members.timeout(userId, 600_000, "10-minute mute");

await members.addRole(userId, roleId);
await members.removeRole(userId, roleId);
```

## `EmojiManager`

Provides methods for fetching, creating, editing, and deleting emojis in a guild.

```ts
const emojis = guild.emojis;

// Create a new emoji
await emojis.create({
  name: "lunibee",
  image: "data:image/png;base64,...",
});

// Edit an emoji
await emojis.edit(emojiId, {
  name: "new_name",
});

// Delete an emoji
await emojis.delete(emojiId);
```

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
