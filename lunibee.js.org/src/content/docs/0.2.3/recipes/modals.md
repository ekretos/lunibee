---
title: Modals & Form Inputs
description: Building and handling modal pop-up forms.
slug: 0.2.3/recipes/modals
---

Modals allow bots to present interactive pop-up forms with text inputs.

## Presenting a Modal

```ts
import { CreateModal, CreateTextInput, TextInputType, CreateActionRow } from "lunibee";
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "feedback") {
    const titleInput = new CreateTextInput()
      .setCustomId("feedback_title")
      .setLabel("Subject")
      .setStyle(TextInputType.Short)
      .setRequired(true);
    const bodyInput = new CreateTextInput()
      .setCustomId("feedback_body")
      .setLabel("Details")
      .setStyle(TextInputType.Paragraph)
      .setRequired(true);
    const row1 = new CreateActionRow().addComponents(titleInput);
    const row2 = new CreateActionRow().addComponents(bodyInput);
    const modal = new CreateModal()
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
    const title = interaction.getRequiredInputValue("feedback_title");
    const body = interaction.getRequiredInputValue("feedback_body");

    await interaction.reply({
      content: `Thanks for your feedback: **${title}**\n>${body}`,
      ephemeral: true,
    });
  }
});
```
