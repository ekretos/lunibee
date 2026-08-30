---
title: "@lunibee/managers"
description: Complete API reference for Channel, Message, Member, Role, and Guild Resource Managers.
---

# `@lunibee/managers`

`@lunibee/managers` handles caching, resolving, and performing REST operations on Discord resources.

## Installation

```bash
bun add @lunibee/managers
```

---

## `ChannelManager`

Manages channels, message sending, reactions, pins, and threads.

```ts
// Sending a message with embed and components
const msg = await client.channels.send("123456789012345678", {
  content: "Welcome to the server!",
  embeds: [welcomeEmbed],
  components: [actionRow],
});

// Editing a message
await client.channels.editMessage(channelId, messageId, {
  content: "Updated message content",
});

// Deleting a message
await client.channels.deleteMessage(channelId, messageId);

// Bulk deleting messages (2 to 100 messages younger than 14 days)
await client.channels.bulkDeleteMessages(channelId, [msgId1, msgId2, msgId3]);

// Pinned messages
await client.channels.pinMessage(channelId, messageId);
await client.channels.unpinMessage(channelId, messageId);
const pins = await client.channels.fetchPinnedMessages(channelId);

// Reactions
await client.channels.addReaction(channelId, messageId, "👍");
await client.channels.removeOwnReaction(channelId, messageId, "👍");
await client.channels.removeReaction(channelId, messageId, "👍", userId);
await client.channels.removeAllReactions(channelId, messageId);

// Threads
const thread = await client.channels.createThreadFromMessage(channelId, messageId, {
  name: "Discussion Topic",
  autoArchiveDuration: 1440,
});
```

---

## `GuildMemberManager`

Manages members within a guild (fetching, kicking, banning, timeout, and role assignments).

```ts
const memberMgr = guild.members; // Or new GuildMemberManager(guildId, rest)

// Fetch member
const member = await memberMgr.fetch("123456789012345678");

// Kick member
await memberMgr.kick(userId, "Rule violation");

// Ban member (with delete message seconds)
await memberMgr.ban(userId, {
  reason: "Severe spamming",
  deleteMessageSeconds: 86400, // 24 hours
});

// Unban member
await memberMgr.unban(userId, "Appeal accepted");

// Time out member (mute)
await memberMgr.timeout(userId, 60 * 10 * 1000, "10 minute timeout");

// Add / Remove role
await memberMgr.addRole(userId, roleId, "Assigned verified role");
await memberMgr.removeRole(userId, roleId, "Removed role");
```

---

## `RoleManager`

Manages roles in a guild (creating, editing, deleting, permission updates).

```ts
const roleMgr = guild.roles; // Or new RoleManager(guildId, rest)

// Create a role
const newRole = await roleMgr.create({
  name: "Moderator",
  color: 0x3498db,
  hoist: true,
  mentionable: true,
  permissions: "8", // Administrator
  reason: "Staff role setup",
});

// Edit role
await roleMgr.edit(roleId, {
  name: "Senior Moderator",
  color: 0x2ecc71,
});

// Delete role
await roleMgr.delete(roleId, "No longer needed");
```
