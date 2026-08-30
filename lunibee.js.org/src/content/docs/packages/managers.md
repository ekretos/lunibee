---
title: "@lunibee/managers"
description: Resource Managers for Channels, Messages, Members, Roles, and Guilds.
---

The `@lunibee/managers` package provides structured managers for caching and performing REST operations on Discord resources.

## Installation

```bash
bun add @lunibee/managers @lunibee/rest
```

---

## `ChannelManager`

```ts
import { ChannelManager } from "@lunibee/managers";
import { REST } from "@lunibee/rest";

const rest = new REST({ token: process.env.DISCORD_TOKEN! });
const channels = new ChannelManager(rest);

// Sending messages
const message = await channels.send("123456789012345678", {
  content: "Hello from ChannelManager!",
});

// Editing messages
await channels.editMessage(channelId, messageId, { content: "Edited text" });

// Deleting messages
await channels.deleteMessage(channelId, messageId);

// Bulk delete (2 to 100 messages)
await channels.bulkDeleteMessages(channelId, [msg1, msg2, msg3]);

// Pins
await channels.pinMessage(channelId, messageId);
await channels.unpinMessage(channelId, messageId);
const pins = await channels.fetchPinnedMessages(channelId);
```

---

## `GuildMemberManager`

```ts
import { GuildMemberManager } from "@lunibee/managers";

const members = new GuildMemberManager(guildId, rest);

// Moderation
await members.kick(userId, "Rule violation");
await members.ban(userId, { reason: "Severe spamming", deleteMessageSeconds: 86400 });
await members.unban(userId);
await members.timeout(userId, 600_000, "10-minute mute");

// Roles
await members.addRole(userId, roleId);
await members.removeRole(userId, roleId);
```
