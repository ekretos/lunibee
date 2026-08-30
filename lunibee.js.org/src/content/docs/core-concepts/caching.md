---
title: Caching & Structures
description: Canonical caching patterns, memory bounds, and structure identity in Lunibee.
---

# Caching & Structures

Lunibee manages Discord resources (Users, Guilds, Channels, Roles, Messages) using **Canonical Identity Caching**.

## Canonical Identity Guarantee

When a resource is received via Gateway event or fetched via REST, the resource manager checks if an existing instance already exists in memory.

If it exists, Lunibee mutates the existing structure in place and returns the same object reference. This prevents subtle desynchronization bugs where two parts of your application hold different versions of the same guild or user.

```ts
const userA = client.users.cache.get("123456789012345678");
const userB = await client.users.fetch("123456789012345678");

console.log(userA === userB); // true! Exact same instance
```

## Bounded Memory & TTL Eviction

`@lunibee/collection` provides a high-performance `Cache` with optional bounds and Time-To-Live (TTL):

```ts
import { Cache } from "@lunibee/collection";

const messageCache = new Cache<string, Message>({
  maxSize: 1000,     // Keeps memory predictable
  ttl: 60 * 1000,    // Evicts unreferenced entries after 60s
});
```

## Structure Resource Methods

Structures like `Message`, `Guild`, and `Channel` expose intuitive helper methods that automatically route through the manager's REST client:

```ts
client.on("messageCreate", async (message) => {
  // Directly edit the message
  await message.edit({ content: "Updated content!" });

  // Or delete it
  await message.delete();
});
```
