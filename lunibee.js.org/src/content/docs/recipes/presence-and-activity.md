---
title: Presence & Activity
description: Set what the bot is playing, watching or saying, rotate it, and clear it.
---

`bot.setActivity()` (0.3.0) sets the line under the bot's name. It wraps `bot.setPresence()`, which stays available for anything richer.

```ts
import { ActivityEnum, Client, IntentBits } from "lunibee";

const bot = new Client({ token: process.env.DISCORD_TOKEN!, intents: [IntentBits.guilds] });

bot.once("ready", () => {
  bot.setActivity("chess");                                         // Playing chess
  bot.setActivity("the logs", { type: ActivityEnum.Watching });      // Watching the logs
  bot.setActivity("lo-fi", { type: ActivityEnum.Listening, status: "idle" });
  bot.setActivity("Running on Bun", { type: ActivityEnum.Custom });  // a custom status
  bot.setActivity("live now", {                                      // Streaming needs a Twitch or YouTube url
    type: ActivityEnum.Streaming,
    url: "https://twitch.tv/lunibee",
  });
});

await bot.login();
```

| Option | Meaning |
| --- | --- |
| `type` | An `ActivityEnum`: `Playing` (default), `Streaming`, `Listening`, `Watching`, `Custom`, `Competing`. |
| `status` | `"online"` (default), `"idle"`, `"dnd"`, `"invisible"`. |
| `url` | Only used by `Streaming`. |
| `state` | The text of a `Custom` status. It defaults to `name`. |

It returns `false` when the Gateway is not connected, so call it from `ready` (or later). The activity is remembered and sent again when the shard reconnects.

## Rotate it

```ts
const lines = ["with Bun", "/help", () => `${bot.guilds.cache.size} servers`] as const;
let i = 0;
setInterval(() => {
  const line = lines[i++ % lines.length]!;
  bot.setActivity(typeof line === "function" ? line() : line);
}, 60_000);
```

Discord rate-limits presence updates (5 per 20 seconds per shard), and Lunibee's own send budget refuses sends past its limit, so keep the interval long.

## Clear it

```ts
bot.setActivity(null);                      // no activity, still online
bot.setActivity(null, { status: "dnd" });   // no activity, do not disturb
```

## When you need more

`bot.setPresence({ status, activities, afk, since })` takes Discord's whole presence object, including several activities at once.
