# @lunibee/builders

> Fluent, validated builders for embeds, components, modals, commands and attachments.

```bash
bun add @lunibee/builders
```

```ts
import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    SlashCommandBuilder,
} from "@lunibee/builders";

const embed = new EmbedBuilder()
    .setTitle("Welcome")
    .setDescription("Pick a role below.")
    .setColor(0xf5c542)
    .addFields([{ name: "Server", value: "Lunibee" }]);

const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("yes").setLabel("Yes").setStyle(ButtonStyle.Success),
);

const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
        .setCustomId("role")
        .addOptions({ label: "Developer", value: "dev" }),
);

const ping = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with pong")
    .addStringOption((option) => option.setName("message").setDescription("Echo text"));

console.log(embed.toJSON(), buttons.toJSON(), menu.toJSON(), ping.toJSON());
```

## Builders

| Area | Builders |
|---|---|
| Embeds | `EmbedBuilder` |
| Buttons & rows | `ButtonBuilder`, `ActionRowBuilder` |
| Select menus | `StringSelectBuilder` (alias `StringSelectMenuBuilder`), `EntitySelectBuilder`, `UserSelectMenuBuilder`, `RoleSelectMenuBuilder`, `ChannelSelectMenuBuilder`, `MentionableSelectMenuBuilder` |
| Modals | `ModalBuilder`, `TextInputBuilder` |
| Slash commands | `SlashCommandBuilder`, `SubcommandBuilder`, `SubcommandGroupBuilder`, option builders |
| Context menus | `ContextMenuCommandBuilder` (`setType(2 \| 3)`), `UserCommandBuilder`, `MessageCommandBuilder` |
| Components V2 | `ContainerBuilder`, `SectionBuilder`, `TextDisplayBuilder`, `MediaGalleryBuilder`, `FileComponentBuilder`, `SeparatorBuilder`, `ThumbnailBuilder` |
| Files | `AttachmentBuilder` |

Every builder validates Discord's limits as you set values and serialises with `toJSON()`.

Docs: https://lunibee.js.org/core-concepts/builders/
