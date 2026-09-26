---
title: "@lunibee/rest"
description: Rate-limit aware HTTP client, route builders, and Webhook client for Discord REST API.
---

The `@lunibee/rest` package is Lunibee's low-level HTTP layer. Most bots should use resource methods such as `message.edit()` or `channel.editName()` first. Use REST directly when you need an endpoint that does not have a higher-level helper yet.

## Installation

```bash
bun add @lunibee/rest
```

## Create a REST Client

```ts
import { REST, Routes } from "@lunibee/rest";

const rest = new REST({
  token: process.env.DISCORD_TOKEN!,
});
```

## GET

```ts
const user = await rest.get(Routes.user());
```

## POST

```ts
await rest.post(Routes.channelMessages(channelId), {
  content: "Hello via REST!",
});
```

## PATCH / PUT / DELETE

The same request methods are available when an endpoint requires them:

```ts
await rest.patch(route, payload);
await rest.put(route, payload);
await rest.delete(route);
```

The REST client handles Discord response errors, route-aware rate limits, retries, and request cancellation. Let the resulting error propagate or catch it when your application needs to recover.

## Rate limits

Limits are keyed by Discord's `(bucket hash, major parameter)` pair, so two channels
using the same endpoint never share a counter, while two routes Discord maps onto one
bucket hash do. Requests are serialised per bucket, and a request that queued before
its route's bucket hash was known joins the shared queue once it is.

State lives in a `RateLimitStore`. The default keeps it in memory, which is correct
for a single process.

### Sharing limits across workers

Several processes hitting Discord with the same token share one allowance. Give them
a shared store:

```ts
import { REST, RedisRateLimitStore } from "@lunibee/rest";
import Redis from "ioredis";

const rest = new REST({
  token: process.env.DISCORD_TOKEN!,
  store: new RedisRateLimitStore({
    client: new Redis(process.env.REDIS_URL!),
    onError: (operation, error) => console.warn("redis", operation, error),
  }),
});
```

**Use a client that exposes `eval`.** With it, the store reserves allowance with an
atomic Lua script: one unit is handed to exactly one worker. Without it, workers only
*observe* `remaining`, so several can read the same value and all send — the store
still works, but the fleet relies on 429 feedback instead of avoiding the collision.

```ts
const store = new RedisRateLimitStore({ client });
store.supportsReservation; // true when the client can reserve atomically
```

If Redis becomes unreachable, every write is mirrored in-process and reads fall back
to that mirror, so a Redis outage does not silently drop the fleet to unlimited
sending. `store.isHealthy()` reports whether the last operation succeeded.

### Observing limits

```ts
const rest = new REST({
  token: process.env.DISCORD_TOKEN!,
  hooks: {
    onRateLimit: ({ path, retryAfterMs, global }) =>
      console.warn(`rate limited on ${path} for ${retryAfterMs}ms`, { global }),
    onRetry: ({ path, attempt, status }) =>
      console.warn(`retrying ${path} (attempt ${attempt}, status ${status})`),
  },
});
```

Hooks run in isolation from the request path — a throwing hook cannot fail a request —
but they still share the event loop, so keep them cheap.

### Concurrent buckets

`new REST({ token, concurrentBuckets: true })` runs requests on a known bucket in
parallel, up to its remaining allowance. It's off by default so per-bucket order is
kept. See [REST & Rate Limits](/core-concepts/rest/#concurrent-buckets-opt-in).

## Routes

Use `Routes` rather than hand-writing Discord URLs whenever a route helper exists.

```ts
const route = Routes.channelMessages(channelId);
await rest.post(route, { content: "Hello!" });
```

This keeps IDs and endpoint paths consistent and makes raw REST calls easier to read.

## Resource API vs REST

Prefer this:

```ts
await message.edit({ content: "Updated" });
await message.channel.send({ content: "Hello" });
await message.channel.editName("support");
```

Instead of this, when a resource method already exists:

```ts
await client.rest.patch(`/channels/${channelId}`, { name: "support" });
```

The raw REST client is an escape hatch, not something you need for every Discord operation.

---

## `WebhookClient`

```ts
import { WebhookClient } from "@lunibee/rest";
import { EmbedBuilder } from "@lunibee/builders";

const webhook = new WebhookClient({
  url: "https://discord.com/api/webhooks/123456789/abcdef...",
});

await webhook.send({
  content: "Deployment Notification",
  embeds: [
    new EmbedBuilder()
      .setTitle("Release v1.0")
      .setColor(0x57f287),
  ],
});
```

## Errors and cancellation

REST requests reject when Discord returns an unsuccessful response. Catch errors when you need custom handling:

```ts
try {
  await rest.get(Routes.user());
} catch (error) {
  console.error("Discord request failed:", error);
}
```

When your application owns an `AbortSignal`, pass it through the REST request options to cancel work that is no longer needed.
