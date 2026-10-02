---
title: "@lunibee/builders"
description: Fluent builders for Slash Commands, Rich Embeds, Components,
  Modals, and Attachments.
slug: 0.2.2/packages/builders
---

The `@lunibee/builders` package helps you build Discord payloads without manually remembering every field and validation rule.

## Installation

```bash
bun add @lunibee/builders
```

## Embeds

```ts
import { CreateEmbed } from "@lunibee/builders";

const embed = new CreateEmbed()
  .setTitle("Server Moderation Log")
  .setDescription("A member was banned from the server.")
  .setColor(0xed4245)
  .setTimestamp();

await channel.send({ embeds: [embed] });
```

You can add authors, footers, thumbnails, images, URLs, and fields as needed.

## Slash Commands

```ts
import { CreateSlashCommand } from "@lunibee/builders";

const command = new CreateSlashCommand()
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
  CreateActionRow,
  CreateButton,
  ButtonType,
} from "@lunibee/builders";

const row = new CreateActionRow<CreateButton>().addComponents(
  new CreateButton()
    .setCustomId("ticket_close")
    .setLabel("Close ticket")
    .setStyle(ButtonType.Danger),
);

await channel.send({
  content: "Ticket controls",
  components: [row],
});
```

## Select Menus

```ts
import {
  CreateActionRow,
  CreateStringSelect,
} from "@lunibee/builders";

const row = new CreateActionRow<CreateStringSelect>().addComponents(
  new CreateStringSelect()
    .setCustomId("select_roles")
    .setPlaceholder("Choose a role")
    .addOptions(
      { label: "Announcements", value: "announcements" },
      { label: "Updates", value: "updates" },
    ),
);
```

Entity pickers: `CreateUserSelectMenu`, `CreateRoleSelectMenu`,
`CreateChannelSelectMenu`, `CreateMentionableSelectMenu`. `CreateStringSelectMenu` is an
alias of `CreateStringSelect`. Context menu commands: `CreateContextMenuCommand`
(`setType(2 | 3)`), `CreateUserCommand`, `CreateMessageCommand`.

## Modals

```ts
import {
  CreateModal,
  CreateActionRow,
  CreateTextInput,
  TextInputType,
} from "@lunibee/builders";

const modal = new CreateModal()
  .setCustomId("modal_ticket")
  .setTitle("Create Support Ticket")
  .addComponents(
    new CreateActionRow<CreateTextInput>().addComponents(
      new CreateTextInput()
        .setCustomId("ticket_subject")
        .setLabel("Subject")
        .setStyle(TextInputType.Short)
        .setRequired(true),
    ),
  );
```

## Attachments

```ts
import { CreateAttachment } from "@lunibee/builders";

const file = new CreateAttachment(imageBuffer, {
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

## What's New in 0.2.0

`toJSON()` validates whole components; `CreateButton.setSKUId()` and style-aware field clearing.
