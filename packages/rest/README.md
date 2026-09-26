# @lunibee/rest

> Discord REST client with bucket-aware rate limiting, retries, cancellation and typed routes.

```bash
bun add @lunibee/rest
```

```ts
import { REST, Routes, DiscordAPIError } from "@lunibee/rest";

const rest = new REST({ token: process.env.DISCORD_TOKEN! });

const me = await rest.get<{ id: string; username: string }>(Routes.user());

try {
    await rest.post(
        Routes.channelMessages("123456789012345678"),
        { content: "Hello" },
        { reason: "greeting", signal: AbortSignal.timeout(5_000) },
    );
} catch (error) {
    if (error instanceof DiscordAPIError) console.error(error.status, error.message);
}
```

## Features

- Per-bucket queues keyed by Discord's bucket hash and major parameter, plus the global limit.
- Retries for 429s, 5xx and transport failures (`retries`, or a custom `retryPolicy`).
- `AbortSignal` support, including while queued.
- `concurrentBuckets: true` (opt-in) runs requests on a known bucket in parallel up to its
  remaining allowance. Off by default so per-bucket order is kept.
- Shared rate limits across processes with `RedisRateLimitStore`.
- `hooks` for `onRequest`, `onResponse`, `onRateLimit` and `onRetry`.
- `WebhookClient` for sending through webhook URLs without a bot token.

Both call styles work: `post(path, body, options)` and `post(path, { body, ...options })`.

Docs: https://lunibee.js.org/core-concepts/rest/
