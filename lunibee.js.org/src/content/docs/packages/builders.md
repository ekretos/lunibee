---
title: "@lunibee/builders"
description: Fluent builders for Slash Commands, Rich Embeds, Components, Modals, and Attachments.
---

The `@lunibee/builders` package provides fluent builders for creating Discord UI components, Slash Commands, Rich Embeds, Modals, and binary File Attachments with built-in parameter validation.

## Installation

```bash
bun add @lunibee/builders
```

---

## `EmbedBuilder`

```ts
import { EmbedBuilder } from "@lunibee/builders";

const embed = new EmbedBuilder()
  .setTitle("Server Moderation Log")
  .setDescription("A member was banned from the server.")
  .setColor(0xed4245)
  .setURL("https://example.com/logs/123")
  .setAuthor({
    name: "ModBot",
    iconURL: "https://example.com/bot-avatar.png",
  })
  .setThumbnail("https://example.com/target-avatar.png")
  .setImage("https://example.com/evidence.png")
  .setFooter({
    text: "Action ID #5821",
    iconURL: "https://example.com/guild-icon.png",
  })
  .setTimestamp(new Date())
  .addFields(
    { name: "Target User", value: "<@123456789012345678>", inline: true },
    { name: "Moderator", value: "<@987654321098765432>", inline: true },
    { name: "Reason", value: "Breaking Rule 4: Spamming channels" }
  );

const payload = embed.toJSON();
```

---

## `SlashCommandBuilder`

```ts
import { SlashCommandBuilder } from "@lunibee/builders";

const command = new SlashCommandBuilder()
  .setName("ban")
  .setDescription("Bans a member from the server")
  .addUserOption(option =>
    option
      .setName("target")
      .setDescription("The user to ban")
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName("reason")
      .setDescription("Reason for the ban")
      .setMaxLength(512)
      .addChoices(
        { name: "Spamming", value: "spam" },
        { name: "Inappropriate Behavior", value: "toxicity" }
      )
  );

const payload = command.toJSON();
```

---

## Message Components

```ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectBuilder,
} from "@lunibee/builders";

const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId("btn_accept")
    .setLabel("Accept")
    .setStyle(ButtonStyle.Success)
    .setEmoji({ name: "✅" }),
  new ButtonBuilder()
    .setCustomId("btn_cancel")
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Danger)
);

const selectRow = new ActionRowBuilder<StringSelectBuilder>().addComponents(
  new StringSelectBuilder()
    .setCustomId("select_roles")
    .setPlaceholder("Choose notification roles")
    .setMinValues(1)
    .setMaxValues(3)
    .addOptions(
      { label: "Announcements", value: "announcements" },
      { label: "Updates", value: "updates" }
    )
);
```

---

## `ModalBuilder` & `TextInputBuilder`

```ts
import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "@lunibee/builders";

const modal = new ModalBuilder()
  .setCustomId("modal_ticket")
  .setTitle("Create Support Ticket")
  .addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("ticket_subject")
        .setLabel("Subject")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
    )
  );
```

---

## `AttachmentBuilder`

```ts
import { AttachmentBuilder } from "@lunibee/builders";

const file = new AttachmentBuilder(imageBuffer, {
  name: "welcome.png",
  description: "Custom welcome banner",
});
```
