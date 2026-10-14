---
title: Error Handling & Retries
description: Inspecting REST errors, Discord error codes, and handling rate limits.
---


Lunibee provides structured `RESTError` types with Discord API details.

## Inspecting `RESTError`

```ts
import { RESTError } from "lunibee";
try {
  await client.channels.send("123456789012345678", { content: "Hello!" }); // a channel that does not exist
} catch (error) {
  if (error instanceof RESTError) {
    console.error(`HTTP Status: ${error.status}`);
    console.error(`Discord Code: ${error.code}`);
    console.error(`Endpoint: ${error.method} ${error.path}`);
    console.error(`Details:`, error.errors);
  } else {
    console.error("Unknown error:", error);
  }
}
```

A malformed ID (not a snowflake) throws a `TypeError` before any request is sent, not a `RESTError`.

## Common Discord Error Codes

- `10003`: Unknown Channel
- `10008`: Unknown Message
- `50001`: Missing Access
- `50013`: Missing Permissions
- `50035`: Invalid Form Body
