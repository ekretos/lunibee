---
title: "@lunibee/utils"
description: Utility functions for snowflakes, async delays, and random numbers.
slug: 0.2.4/packages/utils
---

The `@lunibee/utils` package contains small, dependency-free helpers used throughout Lunibee.

## Installation

```bash
bun add @lunibee/utils
```

## Sleep

```ts
import { sleep } from "@lunibee/utils";

await sleep(1000);
```

Useful for simple delays, retry loops, cooldowns, and test code.

## Random integers

```ts
import { randomInt } from "@lunibee/utils";

const diceRoll = randomInt(1, 6);
```

The range is inclusive.

## Snowflakes

```ts
import { isSnowflake } from "@lunibee/utils";

isSnowflake("123456789012345678"); // true
isSnowflake("abc"); // false
```

Use `isSnowflake()` when validating user-supplied Discord IDs before sending them to an API operation.

## Why these helpers are separate

Utilities are intentionally independent of the Discord client. You can use them in commands, scripts, workers, tests, or other parts of your application without creating a Lunibee client.

## Prefix-command arguments (0.2.1)

Read the text after a prefix command as typed values, the way slash-command options are read.

| Function | Description |
|---|---|
| `tokenizeArgs(text)` | Splits on whitespace; `"double"` or `'single'` quotes keep spaces; `\` escapes. |
| `parsePrefixArgs(text \| args, specs)` | Reads arguments by position. Returns `{ ok: true, values }` or `{ ok: false, arg, error }`, and never throws on user input. |
| `argsFromCommandOptions(options, restLast?)` | Specs from a slash command's `options`, so one definition serves `/command` and the prefix command. With `restLast`, the last string option takes the rest of the message. |
| `parseUserMention`, `parseRoleMention`, `parseChannelMention` | The ID in `<@id>` / `<@&id>` / `<#id>`, or a bare ID; `null` otherwise. |
| `parseMentionable(value)` | `{ id, type: "user" \| "role" }`; a bare ID reads as a user. |

A spec is `{ name, type, required?, min?, max?, maxLength?, choices? }` where `type` is `string`, `integer`, `number`, `boolean` (yes/no, on/off, true/false...), `user`, `role`, `channel`, `mentionable` or `rest` (everything left, one string; must be last).

```ts
import { parsePrefixArgs } from "lunibee";

const result = parsePrefixArgs(message.content.slice("!timeout".length), [
  { name: "user", type: "user", required: true },
  { name: "minutes", type: "integer", min: 1, max: 40320 },
  { name: "reason", type: "rest", maxLength: 500 },
]);
if (!result.ok) return message.reply(`\`${result.arg}\` ${result.error}.`);
const { user, minutes = 10, reason } = result.values;
```
