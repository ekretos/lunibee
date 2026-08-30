---
title: "@lunibee/rest"
description: Rate-limit aware HTTP client, route builders, and Webhook client for Discord REST API.
---

The `@lunibee/rest` package provides a rate-limit aware HTTP client for Discord's REST API, snowflake-validated route helpers, and a standalone Webhook client.

## Installation

```bash
bun add @lunibee/rest
```

---

## `REST` Client

```ts
import { REST, Routes } from "@lunibee/rest";

const rest = new REST({ token: process.env.DISCORD_TOKEN! });

// Fetch current bot application user
const user = await rest.get(Routes.currentUser());

// Send message via raw REST
await rest.post(Routes.channelMessages("123456789012345678"), {
  content: "Hello via REST!",
});
```

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
  embeds: [new EmbedBuilder().setTitle("Release v1.0").setColor(0x57f287)],
});
```
