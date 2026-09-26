# lunibee

> A lightweight, Bun-first Discord API library for TypeScript.

`packages/lunibee` is the source of the top-level `lunibee` barrel: it re-exports every
`@lunibee/*` package, so applications need a single import. It is built into the root
package's `dist/` and published as `lunibee`.

```bash
bun add lunibee
```

```ts
import { Client, GatewayIntentBits, EmbedBuilder } from "lunibee";

const client = new Client({
    token: process.env.DISCORD_TOKEN!,
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
});

client.on("messageCreate", async (message) => {
    if (message.content === "!ping")
        await message.channel.send({
            embeds: [new EmbedBuilder().setTitle("Pong!").toJSON()],
        });
});

await client.login();
```

Name clashes between packages resolve as **builders > structures > types**. Subpath
exports (`lunibee/rest`, `lunibee/ws`, …) expose each package on its own.

Docs: https://lunibee.js.org
