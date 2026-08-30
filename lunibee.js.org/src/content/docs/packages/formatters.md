---
title: "@lunibee/formatters"
description: Helpers for Discord text mentions, markdown styling, and timestamp formatting.
---

The `@lunibee/formatters` package provides zero-dependency helpers for formatting Discord text mentions, localized markdown timestamps, and markdown text styles.

## Installation

```bash
bun add @lunibee/formatters
```

---

## Mentions

```ts
import {
  userMention,
  channelMention,
  roleMention,
} from "@lunibee/formatters";

console.log(userMention("123456789012345678"));    // "<@123456789012345678>"
console.log(channelMention("123456789012345678")); // "<#123456789012345678>"
console.log(roleMention("123456789012345678"));    // "<@&123456789012345678>"
```

---

## Discord Timestamps

```ts
import { timestamp } from "@lunibee/formatters";

const now = new Date();

console.log(timestamp(now));      // "<t:1700000000:f>"
console.log(timestamp(now, "R")); // "<t:1700000000:R>" (Relative)
console.log(timestamp(now, "F")); // "<t:1700000000:F>" (Full date and time)
```
