# create-lunibee

> Scaffold a new Lunibee bot.

```bash
bun create lunibee my-bot
cd my-bot
bun install
DISCORD_TOKEN=your_token bun run src/index.ts
```

It writes a `package.json` (ESM, `start` script, `lunibee` dependency) and a
`src/index.ts` that logs in and prints `Ready!`. Omit the directory to scaffold into the
current folder.

Programmatic use:

```ts
import { createProject } from "create-lunibee";

const files = createProject({ directory: "my-bot", name: "my-bot" });
console.log(Object.keys(files)); // ["package.json", "src/index.ts"]
```
