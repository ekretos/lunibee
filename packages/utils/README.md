# @lunibee/utils

> Tiny shared utilities.

```bash
bun add @lunibee/utils
```

```ts
import { sleep, randomInt, isSnowflake } from "@lunibee/utils";

await sleep(250);
const roll = randomInt(1, 6);
isSnowflake("123456789012345678"); // true
console.log(roll);
```

| Function | Description |
|---|---|
| `sleep(ms)` | Resolves after `ms` milliseconds. |
| `randomInt(min, max)` | Random integer between `min` and `max`. |
| `isSnowflake(value)` | Whether a string is a Discord snowflake. |
