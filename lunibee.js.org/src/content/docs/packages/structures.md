---
title: "@lunibee/structures"
description: Domain model classes wrapping raw Discord API JSON objects.
---

The `@lunibee/structures` package wraps raw Discord API JSON objects in rich, strongly-typed domain model classes with utility methods.

## Installation

```bash
bun add @lunibee/structures
```

---

## `Channel`

Channels expose Lunibee's resource-oriented API. You can perform common channel operations directly on the structure without reaching into `client.rest`.

```ts
// Send a message
const message = await channel.send({
  content: "Ticket created!",
});

// Edit channel properties
await channel.edit({ topic: "Support ticket" });

// Convenience helpers
await channel.editName("support-123");
await channel.editTopic("Support ticket");
await channel.editParent(categoryId);

// Delete the channel
await channel.delete();
```

`client.rest` remains available when you need direct access to an endpoint that is not represented by a resource method.

---

## `Message`

Messages provide their own resource operations and expose the originating channel through `message.channel`.

```ts
// Access the channel that contains the message
const channel = message.channel;

// Edit message
await message.edit({ content: "Updated content" });

// Update message using Lunibee's resource API
await message.update({ content: "Updated again" });

// Reply directly to a message
await message.reply({ content: "Pong!" });

// Delete message
await message.delete();

// Add reactions
await message.react("👍");

// Pin message
await message.pin();
```

### Resource context errors

Resource methods require the structure to be attached to a Lunibee client context. Calling a resource operation on a detached structure throws an `Error` rather than silently issuing a request without the required client context.

---

## `GuildMember`

```ts
import { GuildMember } from "@lunibee/structures";

console.log(member.displayName);
console.log(member.joinedAt);

if (member.permissions.administrator) {
  console.log("Member is an admin!");
}

await member.kick("Reason");
await member.ban({ reason: "Banned" });
await member.timeout(60_000);
```
