---
title: "@lunibee/utils"
description: Utility functions for snowflakes, async delays, and random numbers.
---

The `@lunibee/utils` package provides zero-overhead utility functions used across Lunibee packages.

## Installation

```bash
bun add @lunibee/utils
```

---

## Utility Functions

```ts
import { sleep, randomInt, isSnowflake } from "@lunibee/utils";

// Asynchronous sleep
await sleep(1000); // Waits 1 second

// Random integer between min and max (inclusive)
const diceRoll = randomInt(1, 6);

// Validate Discord snowflake string
const valid = isSnowflake("123456789012345678"); // true
const invalid = isSnowflake("abc"); // false
```
