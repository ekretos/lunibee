---
title: "@lunibee/formatters"
description: Helpers for Discord text mentions, markdown styling, and timestamp formatting.
---

The `@lunibee/formatters` package provides small, dependency-free helpers for creating Discord mentions, timestamps, and markdown text.

## Installation

```bash
bun add @lunibee/formatters
```

## Mentions

```ts
import {
  userMention,
  channelMention,
  roleMention,
} from "@lunibee/formatters";

console.log(userMention("123456789012345678"));
console.log(channelMention("123456789012345678"));
console.log(roleMention("123456789012345678"));
```

Use these helpers instead of manually assembling mention strings when you already have a Discord ID.

## Discord Timestamps

```ts
import { timestamp } from "@lunibee/formatters";

const now = new Date();

console.log(timestamp(now));
console.log(timestamp(now, "R"));
console.log(timestamp(now, "F"));
```

Discord renders the timestamp according to each user's locale and timezone.

## Markdown Helpers

The formatter package also provides helpers for common Discord markdown styles. Prefer these when building long messages dynamically so formatting stays readable in your source code.

## Putting it together

```ts
await channel.send({
  content: `${userMention(userId)} — your ticket was created ${timestamp(new Date(), "R")}.`,
});
```
