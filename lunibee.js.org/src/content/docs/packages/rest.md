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
const user = await rest.get(Routes.currentUser());
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
  await rest.get(Routes.currentUser());
} catch (error) {
  console.error("Discord request failed:", error);
}
```

When your application owns an `AbortSignal`, pass it through the REST request options to cancel work that is no longer needed.
