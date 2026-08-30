---
title: Buttons & Select Menus
description: Interactive components, custom IDs, and component interaction callbacks.
---


Discord components allow users to trigger bot actions directly from message attachments.

## Sending Buttons

```ts
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "lunibee";
client.on("messageCreate", async (message) => {
  if (message.content === "!buttons") {
    const accept = new ButtonBuilder()
      .setCustomId("btn_accept")
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success);
    const decline = new ButtonBuilder()
      .setCustomId("btn_decline")
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder().addComponents(accept, decline);
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
