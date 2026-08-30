---
title: REST & Rate Limits
description: Bucket-aware Discord REST client with exponential backoff, rate limiting, and cancellation.
---

# REST & Rate Limits

`@lunibee/rest` provides a type-safe HTTP client specifically tuned for Discord API v10.

## Bucket-Aware Rate Limiting

Discord groups routes into rate-limit buckets. `@lunibee/rest` tracks bucket headers (`X-RateLimit-Bucket`, `X-RateLimit-Remaining`, `X-RateLimit-Reset-After`) on every response.

- **Non-blocking queues**: Requests targeting different buckets execute concurrently.
- **Sublimit protection**: Requests waiting on a shared bucket automatically pause until the bucket resets.
- **Global rate limits**: Pauses all REST queues transparently if a `429 Too Many Requests` global limit is encountered.

## Example Requests

```ts
import { REST, Routes } from "@lunibee/rest";

const rest = new REST({ token: process.env.DISCORD_TOKEN! });

// Fetch current bot user
const me = await rest.get(Routes.user("@me"));

// Send a message
const message = await rest.post(Routes.channelMessages("123456789012345678"), {
  body: {
    content: "Hello from Lunibee REST!",
  },
});
```

## AbortSignal Support & Cancellation

Every REST method accepts standard `fetch` options, including `AbortSignal`:

```ts
const controller = new AbortController();

const timeout = setTimeout(() => controller.abort(), 5000);

try {
  const result = await rest.get(Routes.guild("123456789012345678"), {
    signal: controller.signal,
  });
} catch (error) {
  if (error.name === "AbortError") {
    console.warn("Request timed out or was cancelled.");
  }
} finally {
  clearTimeout(timeout);
}
```
