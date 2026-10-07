---
title: Buttons & Select Menus
description: Interactive components, custom IDs, and component interaction callbacks.
slug: 0.2.4/recipes/buttons-and-selects
---

Discord components allow users to trigger bot actions directly from message attachments.

## Sending Buttons

```ts
import { CreateActionRow, CreateButton, ButtonType } from "lunibee";
client.on("messageCreate", async (message) => {
  if (message.content === "!buttons") {
    const accept = new CreateButton()
      .setCustomId("btn_accept")
      .setLabel("Accept")
      .setStyle(ButtonType.Success);
    const decline = new CreateButton()
      .setCustomId("btn_decline")
      .setLabel("Decline")
      .setStyle(ButtonType.Danger);
    const row = new CreateActionRow().addComponents(accept, decline);
    await message.reply({
      content: "Do you agree to the server rules?",
      components: [row],
    });
  }
});
```

## Handling Button Interactions

```ts
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "btn_accept") {
    await interaction.reply({
      content: "Thank you for accepting the rules! 🎉",
      ephemeral: true,
    });
  } else if (interaction.customId === "btn_decline") {
    await interaction.reply({
      content: "You declined the rules.",
      ephemeral: true,
    });
  }
});
```
