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

## `Message`

```ts
import { Message } from "@lunibee/structures";

// Reply directly to a message
await message.reply({ content: "Pong!" });

// Edit message
await message.edit({ content: "Updated content" });

// Delete message
await message.delete();

// Add reactions
await message.react("👍");

// Pin message
await message.pin();
```

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
