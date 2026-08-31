---
title: "@lunibee/builders"
description: Fluent builders for Slash Commands, Rich Embeds, Components, Modals, and Attachments.
---

The `@lunibee/builders` package helps you build Discord payloads without manually remembering every field and validation rule.

## Installation

```bash
bun add @lunibee/builders
```

## Embeds

```ts
import { EmbedBuilder } from "@lunibee/builders";

const embed = new EmbedBuilder()
  .setTitle("Server Moderation Log")
  .setDescription("A member was banned from the server.")
  .setColor(0xed4245)
  .setTimestamp();

await channel.send({ embeds: [embed] });
```

You can add authors, footers, thumbnails, images, URLs, and fields as needed.

## Slash Commands

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
  );

const payload = command.toJSON();
```

`toJSON()` gives you the payload that can be sent through the command registration API.

## Buttons

```ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "@lunibee/builders";

const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId("ticket_close")
    .setLabel("Close ticket")
    .setStyle(ButtonStyle.Danger),
);

await channel.send({
  content: "Ticket controls",
  components: [row],
});
```

## Select Menus

```ts
import {
  ActionRowBuilder,
  StringSelectBuilder,
} from "@lunibee/builders";

const row = new ActionRowBuilder<StringSelectBuilder>().addComponents(
  new StringSelectBuilder()
    .setCustomId("select_roles")
    .setPlaceholder("Choose a role")
    .addOptions(
      { label: "Announcements", value: "announcements" },
      { label: "Updates", value: "updates" },
    ),
);
```

## Modals

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
        .setRequired(true),
    ),
  );
```

## Attachments

```ts
import { AttachmentBuilder } from "@lunibee/builders";

const file = new AttachmentBuilder(imageBuffer, {
  name: "welcome.png",
  description: "Custom welcome banner",
});

await channel.send({ files: [file] });
```

## Builder workflow

The usual flow is:

```text
Builder → toJSON() → Client/resource/REST → Discord
```

Builders create and validate payloads; they do not send requests themselves.
