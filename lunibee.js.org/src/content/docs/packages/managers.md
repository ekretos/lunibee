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

## `GuildMemberManager`

```ts
const members = client.guilds.get(guildId)?.members;

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
