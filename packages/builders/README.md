# @lunibee/builders

> Fluent, validated builders for embeds, components, modals, commands and attachments.

```bash
bun add @lunibee/builders
```

```ts
import {
    CreateEmbed,
    CreateActionRow,
    CreateButton,
    ButtonType,
    CreateStringSelectMenu,
    CreateSlashCommand,
} from "@lunibee/builders";

const embed = new CreateEmbed()
    .setTitle("Welcome")
    .setDescription("Pick a role below.")
    .setColor(0xf5c542)
    .addFields([{ name: "Server", value: "Lunibee" }]);

const buttons = new CreateActionRow().addComponents(
    new CreateButton().setCustomId("yes").setLabel("Yes").setStyle(ButtonType.Success),
);

const menu = new CreateActionRow().addComponents(
    new CreateStringSelectMenu()
        .setCustomId("role")
        .addOptions({ label: "Developer", value: "dev" }),
);

const ping = new CreateSlashCommand()
    .setName("ping")
    .setDescription("Replies with pong")
    .addStringOption((option) => option.setName("message").setDescription("Echo text"));

console.log(embed.toJSON(), buttons.toJSON(), menu.toJSON(), ping.toJSON());
```

## Builders

| Area | Builders |
|---|---|
| Embeds | `CreateEmbed` |
| Buttons & rows | `CreateButton`, `CreateActionRow` |
| Select menus | `CreateStringSelect` (alias `CreateStringSelectMenu`), `CreateEntitySelect`, `CreateUserSelectMenu`, `CreateRoleSelectMenu`, `CreateChannelSelectMenu`, `CreateMentionableSelectMenu` |
| Modals | `CreateModal`, `CreateTextInput` |
| Slash commands | `CreateSlashCommand`, `CreateSubcommand`, `CreateSubcommandGroup`, option builders |
| Context menus | `CreateContextMenuCommand` (`setType(2 \| 3)`), `CreateUserCommand`, `CreateMessageCommand` |
| Components V2 | `CreateContainer`, `CreateSection`, `CreateTextDisplay`, `CreateMediaGallery`, `CreateFileComponent`, `CreateSeparator`, `CreateThumbnail` |
| Files | `CreateAttachment` |

Every builder validates Discord's limits as you set values and serialises with `toJSON()`.

## What's new in 0.2.1

- `CreateModal.addTextInputs(...inputs)` wraps each text input in its own row.
- `componentsV2Message(components, options?)` builds a Components V2 message with the required flag.
- `CreateEmbed` setters (`setTitle`, `setDescription`, `setURL`, `setThumbnail`, `setImage`) clear the field with `null`.
- `TextInputType` and `ComponentEnum` are usable as types; `CreateModal.toJSON()` is typed with a required `custom_id` and `title`.

## What's new in 0.2.0

`toJSON()` validates whole components (required fields, value bounds, action-row rules, button field exclusivity); `CreateButton.setSKUId()` for premium buttons.

Docs: https://lunibee.js.org/core-concepts/builders/
