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

## Prefix-command arguments (0.2.1)

`parsePrefixArgs(text, specs)` reads a prefix command's arguments as typed values (`string`, `integer`, `number`, `boolean`, `user`, `role`, `channel`, `mentionable`, `rest`) and returns `{ ok, values }` or `{ ok: false, arg, error }`. `tokenizeArgs()` splits text with quotes, `argsFromCommandOptions()` reuses a slash command's options, and `parseUserMention` / `parseRoleMention` / `parseChannelMention` / `parseMentionable` read mentions.

```ts
import { parsePrefixArgs } from "@lunibee/utils";

const result = parsePrefixArgs(`<@123456789012345678> 10 spam`, [
  { name: "user", type: "user", required: true },
  { name: "minutes", type: "integer", min: 1 },
  { name: "reason", type: "rest" },
]);
```

