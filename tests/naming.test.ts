import { expect, test } from "bun:test";
import * as lunibee from "../packages/lunibee/src/index.js";

// 0.2.2 naming: builders are `CreateX`, `…Style` became `…Type`, `…Type` became `…Enum`.
// The old names stay as deprecated aliases of the same values until 0.3.0.
// Every deprecated alias is listed, so none can disappear or drift before then.
const renamed: Record<string, string> = {
    ActionRowBuilder: "CreateActionRow",
    ApplicationCommandOptionType: "ApplicationCommandOptionEnum",
    ApplicationCommandType: "ApplicationCommandEnum",
    AttachmentBuilder: "CreateAttachment",
    AttachmentOptionBuilder: "CreateAttachmentOption",
    BooleanOptionBuilder: "CreateBooleanOption",
    ButtonBuilder: "CreateButton",
    ButtonStyle: "ButtonType",
    ChannelOptionBuilder: "CreateChannelOption",
    ChannelSelectMenuBuilder: "CreateChannelSelectMenu",
    ChannelType: "ChannelEnum",
    CommandOptionBuilder: "CreateCommandOption",
    ComponentType: "ComponentEnum",
    ContainerBuilder: "CreateContainer",
    ContentInventoryEntryBuilder: "CreateContentInventoryEntry",
    ContextMenuCommandBuilder: "CreateContextMenuCommand",
    EmbedBuilder: "CreateEmbed",
    EntitySelectBuilder: "CreateEntitySelect",
    FileComponentBuilder: "CreateFileComponent",
    IntegerOptionBuilder: "CreateIntegerOption",
    InteractionResponseType: "InteractionResponseEnum",
    InteractionType: "InteractionEnum",
    MediaGalleryBuilder: "CreateMediaGallery",
    MentionableOptionBuilder: "CreateMentionableOption",
    MentionableSelectMenuBuilder: "CreateMentionableSelectMenu",
    MessageCommandBuilder: "CreateMessageCommand",
    ModalBuilder: "CreateModal",
    NumberOptionBuilder: "CreateNumberOption",
    PermissionOverwriteType: "PermissionOverwriteEnum",
    RoleOptionBuilder: "CreateRoleOption",
    RoleSelectMenuBuilder: "CreateRoleSelectMenu",
    SectionBuilder: "CreateSection",
    SeparatorBuilder: "CreateSeparator",
    SlashCommandBuilder: "CreateSlashCommand",
    StickerFormatType: "StickerFormatEnum",
    StickerType: "StickerEnum",
    StringOptionBuilder: "CreateStringOption",
    StringSelectBuilder: "CreateStringSelect",
    StringSelectMenuBuilder: "CreateStringSelectMenu",
    SubcommandBuilder: "CreateSubcommand",
    SubcommandGroupBuilder: "CreateSubcommandGroup",
    TextDisplayBuilder: "CreateTextDisplay",
    TextInputBuilder: "CreateTextInput",
    TextInputStyle: "TextInputType",
    ThumbnailBuilder: "CreateThumbnail",
    UserCommandBuilder: "CreateUserCommand",
    UserOptionBuilder: "CreateUserOption",
    UserSelectMenuBuilder: "CreateUserSelectMenu",
    WebhookType: "WebhookEnum",
};

test("new names are exported and the removed names are gone", () => {
    const exports = lunibee as unknown as Record<string, unknown>;
    for (const [old, current] of Object.entries(renamed)) {
        expect(exports[current]).toBeDefined();
        expect(exports[old]).toBeUndefined();
    }
});
