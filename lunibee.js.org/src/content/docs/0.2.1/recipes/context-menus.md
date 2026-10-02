---
title: Context Menus
description: User and message commands from the right-click menu, with the
  target user, member or message.
slug: 0.2.1/recipes/context-menus
---

Context-menu commands appear when someone right-clicks (or long-presses) a **user** or a **message** and opens *Apps*. They have a name and no options; what they act on is the target.

## Registering them

```ts
import { CreateMessageCommand, CreateUserCommand } from "lunibee";

const commands = [
  new CreateUserCommand()
    .setName("View Profile")          // mixed case and spaces are allowed
    .setContexts(0)                   // 0 guilds, 1 the bot's DMs, 2 other DMs
    .toJSON(),
  new CreateMessageCommand()
    .setName("Report Message")
    .setNameLocalizations({ "es-ES": "Reportar mensaje" })
    .setDefaultMemberPermissions(0n)  // hidden from everyone but admins by default
    .toJSON(),
];

await client.application.commands.set(commands);
```

## Handling them

```ts
client.on("interactionCreate", async (interaction) => {
  if (interaction.isUserContextMenuCommand()) {
    const user = interaction.targetUser;       // User
    const member = interaction.targetMember;   // GuildMember in a guild, with kick/ban/timeout...
    await interaction.reply({
      content: `${user?.username} joined ${member?.joinedAt?.toDateString() ?? "—"}`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.isMessageContextMenuCommand()) {
    const message = interaction.targetMessage; // Message
    await interaction.reply({ content: `Reported message ${message?.id}.`, ephemeral: true });
    return;
  }

  if (interaction.isChatInputCommand()) {
    // slash commands only
  }
});
```

| Guard | True for |
|---|---|
| `isCommand()` | Any application command (slash, user, message) |
| `isChatInputCommand()` | Slash commands only |
| `isContextMenuCommand()` | User and message commands |
| `isUserContextMenuCommand()` | User commands |
| `isMessageContextMenuCommand()` | Message commands |

`targetId` is the ID of what was right-clicked; `targetUser`, `targetMember` and `targetMessage` are `null` when Discord did not send that target (for example `targetMember` outside a guild).

:::caution[Changed in 0.2.2]
Before 0.2.2, `isChatInputCommand()` was true for context-menu commands too. If you relied on that, use `isCommand()`.
:::
