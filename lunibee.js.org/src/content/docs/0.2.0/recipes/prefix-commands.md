---
title: Prefix Commands
description: Message commands with typed arguments and permission checks,
  sharing definitions with slash commands.
slug: 0.2.0/recipes/prefix-commands
---

Slash commands are the main way to build commands, but many bots also answer a prefix such as `!`. Lunibee gives prefix commands the same tools: typed arguments, the author's member with permissions, and the same member actions.

## Reading a command

```ts
import { Client, GatewayIntentBits, parsePrefixArgs } from "lunibee";

const client = new Client({
  token: process.env.DISCORD_TOKEN!,
  intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent,
});
const PREFIX = "!";

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  const [name = "", ...rest] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  if (name.toLowerCase() !== "timeout") return;

  // The author's roles come with the message; permissions are computed from the cached roles.
  if (!message.member?.permissions.has("ModerateMembers"))
    return message.reply("You need **Timeout Members**.");

  const args = parsePrefixArgs(rest.join(" "), [
    { name: "user", type: "user", required: true },
    { name: "minutes", type: "integer", min: 1, max: 40320 },
    { name: "reason", type: "rest", maxLength: 500 },
  ]);
  if (!args.ok) return message.reply(`\`${args.arg}\` ${args.error}. Usage: \`!timeout @user [minutes] [reason]\``);

  const { user, minutes = 10, reason } = args.values as { user: string; minutes?: number; reason?: string };
  await client.guilds.members(message.guildId!).timeout(user, minutes * 60_000, reason);
  await message.reply(`Timed out <@${user}> for ${minutes} minutes.`);
});
```

## One definition for both

`argsFromCommandOptions` turns a slash command's options into argument specs, so a command is defined once:

```ts
import { argsFromCommandOptions, parsePrefixArgs } from "lunibee";

const timeout = {
  name: "timeout",
  description: "Time a member out",
  options: [
    { name: "user", description: "Who", type: 6, required: true },
    { name: "minutes", description: "How long", type: 4, min_value: 1, max_value: 40320 },
    { name: "reason", description: "Why", type: 3, max_length: 500 },
  ],
};

const specs = argsFromCommandOptions(timeout.options, true); // the reason takes the rest of the message
const args = parsePrefixArgs(text, specs);
```

## Buttons after a prefix command

Messages can wait for their own components, and the wait always ends:

```ts
const prompt = await message.reply({ content: "Confirm?", components: [row.toJSON()] });
const click = await prompt.awaitComponent({ filter: (i) => i.user?.id === message.author.id, time: 30_000 }).catch(() => null);
if (!click) return prompt.edit({ content: "Timed out.", components: [] });
await click.update({ content: "Done.", components: [] });
```
