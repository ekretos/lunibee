---
title: Modals & Form Inputs
description: Building and handling modal pop-up forms.
---

# Modals & Form Inputs

Modals allow bots to present interactive pop-up forms with text inputs.

## Presenting a Modal

```ts
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "lunibee";

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "feedback") {
    const titleInput = new TextInputBuilder()
      .setCustomId("feedback_title")
      .setLabel("Subject")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const bodyInput = new TextInputBuilder()
      .setCustomId("feedback_body")
      .setLabel("Details")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const row1 = new ActionRowBuilder().addComponents(titleInput);
    const row2 = new ActionRowBuilder().addComponents(bodyInput);

    const modal = new ModalBuilder()
      .setCustomId("feedback_modal")
      .setTitle("Submit Feedback")
      .addComponents(row1, row2);

    await interaction.showModal(modal);
  }
});
```

## Handling Submissions

```ts
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isModalSubmit()) return;

  if (interaction.customId === "feedback_modal") {
    const title = interaction.fields.getTextInputValue("feedback_title");
    const body = interaction.fields.getTextInputValue("feedback_body");

    await interaction.reply({
      content: `Thanks for your feedback: **${title}**\n>${body}`,
      ephemeral: true,
    });
  }
});
```
