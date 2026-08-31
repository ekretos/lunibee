---
title: "@lunibee/utils"
description: Utility functions for snowflakes, async delays, and random numbers.
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
