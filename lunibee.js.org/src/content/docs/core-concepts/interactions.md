---
title: Interactions & Commands
description: Slash command interactions, button callbacks, select menus, and modal dialogs.
---

# Interactions & Slash Commands

Interactions represent user actions from Slash Commands, Buttons, Select Menus, Context Menus, and Modal forms.

## Handling Slash Commands

```ts
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply({
      content: "Pong from slash command! 🏓",
      ephemeral: true, // Only visible to the caller
    });
  }
});
```

## Acknowledgement Lifecycle

Discord interactions must be acknowledged within 3 seconds. Lunibee supports the complete response lifecycle:

```ts
if (interaction.isChatInputCommand()) {
  // 1. Defer the reply if processing takes time
  await interaction.deferReply();

  // Do some slow async work...
  const stats = await generateBotStats();

  // 2. Edit the deferred reply
  await interaction.editReply({
    content: `Stats calculated: ${stats}`,
  });

  // 3. Send follow-up messages if needed
  await interaction.followUp({
    content: "Need help? Type /help!",
  });
}
```

## Type Guards for Interactions

- `interaction.isChatInputCommand()`: Application slash commands
- `interaction.isButton()`: Message button clicks
- `interaction.isStringSelectMenu()`: String drop-down selections
- `interaction.isModalSubmit()`: Modal form submissions
- `interaction.isUserContextMenuCommand()`: User right-click app commands
- `interaction.isMessageContextMenuCommand()`: Message right-click app commands
