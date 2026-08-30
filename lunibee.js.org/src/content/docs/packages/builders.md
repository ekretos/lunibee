---
title: "@lunibee/builders"
description: Complete API reference for Slash Commands, Embeds, Buttons, Select Menus, Modals, and Attachments.
---

# `@lunibee/builders`

`@lunibee/builders` provides fluent builders for creating Discord UI components, Slash Commands, Rich Embeds, Modals, and binary File Attachments with built-in parameter validation.

## Installation

```bash
bun add @lunibee/builders
```

---

## `EmbedBuilder`

Constructs Discord Rich Embed objects.

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
    url: "https://example.com",
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

// Serializes to Discord API payload
const payload = embed.toJSON();
```

### Methods & Limits

| Method | Limits | Description |
|---|---|---|
| `setTitle(title)` | Max 256 chars | Sets embed title |
| `setDescription(description)` | Max 4096 chars | Sets embed description |
| `setColor(color)` | 0x000000 to 0xFFFFFF | Sets RGB color integer |
| `setURL(url)` | Valid URL | Sets title URL |
| `setAuthor({ name, url?, icon_url? })` | Name max 256 chars | Sets author info (supports `iconURL` alias) |
| `setFooter({ text, icon_url? })` | Text max 2048 chars | Sets footer info (supports `iconURL` alias) |
| `setThumbnail(url)` | Valid URL | Sets thumbnail image |
| `setImage(url)` | Valid URL | Sets main image |
| `setTimestamp(date?)` | Date / timestamp | Sets ISO8601 timestamp (defaults to `now`) |
| `addFields(...fields)` | Max 25 fields total | Adds `{ name, value, inline? }` fields |
| `setFields(fields)` | Max 25 fields | Replaces all fields |
| `spliceFields(index, count, ...fields)` | Max 25 fields | Splices existing fields |

---

## `SlashCommandBuilder`

Constructs Application (Slash) Commands with nested subcommands, options, choices, and permission requirements.

```ts
import { SlashCommandBuilder, PermissionFlagsBits } from "lunibee";

const banCommand = new SlashCommandBuilder()
  .setName("ban")
  .setDescription("Bans a member from the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .setDMPermission(false)
  .setNSFW(false)
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
      .setRequired(false)
      .setMaxLength(512)
      .addChoices(
        { name: "Spamming / Advertising", value: "spam" },
        { name: "Inappropriate Behavior", value: "toxicity" },
        { name: "Other", value: "other" }
      )
  )
  .addIntegerOption(option =>
    option
      .setName("days")
      .setDescription("Days of message history to delete")
      .setMinValue(0)
      .setMaxValue(7)
  );
```

### Option Types Available
- **`addStringOption(fn)`**: String inputs with `setMinLength`, `setMaxLength`, `addChoices`, and `setAutocomplete(true)`.
- **`addIntegerOption(fn)`**: Integer inputs with `setMinValue`, `setMaxValue`, `addChoices`, and `setAutocomplete(true)`.
- **`addNumberOption(fn)`**: Float/Number inputs with `setMinValue`, `setMaxValue`, `addChoices`, and `setAutocomplete(true)`.
- **`addBooleanOption(fn)`**: True/False boolean toggles.
- **`addUserOption(fn)`**: User / Member selector.
- **`addChannelOption(fn)`**: Channel selector with `addChannelTypes(...types)`.
- **`addRoleOption(fn)`**: Role selector.
- **`addMentionableOption(fn)`**: Users or Roles selector.
- **`addAttachmentOption(fn)`**: File upload input.
- **`addSubcommand(fn)`** & **`addSubcommandGroup(fn)`**: Nested subcommand structures.

---

## Message Components

### `ActionRowBuilder`
Containers that hold buttons, select menus, or text inputs.

```ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectBuilder,
} from "@lunibee/builders";

const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId("btn_accept")
    .setLabel("Accept")
    .setStyle(ButtonStyle.Success)
    .setEmoji({ name: "✅" }),
  new ButtonBuilder()
    .setCustomId("btn_cancel")
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Danger),
  new ButtonBuilder()
    .setLabel("Documentation")
    .setStyle(ButtonStyle.Link)
    .setURL("https://lunibee.js.org")
);

const row2 = new ActionRowBuilder<StringSelectBuilder>().addComponents(
  new StringSelectBuilder()
    .setCustomId("select_role")
    .setPlaceholder("Choose your notification roles")
    .setMinValues(1)
    .setMaxValues(3)
    .addOptions(
      { label: "Announcements", value: "role_announcements", emoji: { name: "📢" } },
      { label: "Updates", value: "role_updates", emoji: { name: "🔔" } },
      { label: "Events", value: "role_events", emoji: { name: "🎉" } }
    )
);
```

---

## `ModalBuilder` & `TextInputBuilder`

Constructs interactive pop-up modals for user data entry.

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
        .setPlaceholder("Brief summary of your issue")
        .setMinLength(5)
        .setMaxLength(100)
        .setRequired(true)
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("ticket_description")
        .setLabel("Detailed Description")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Describe what happened in detail...")
        .setMinLength(20)
        .setMaxLength(1000)
        .setRequired(true)
    )
  );
```

---

## `AttachmentBuilder`

Handles binary file uploads (images, buffers, blobs, files).

```ts
import { AttachmentBuilder } from "@lunibee/builders";

// From a Buffer or Uint8Array
const file = new AttachmentBuilder(imageBuffer, {
  name: "welcome.png",
  description: "Custom generated welcome banner",
});

// From a Blob or File
const blobFile = new AttachmentBuilder(new Blob(["Hello world"]), "log.txt");
```
