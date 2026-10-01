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

test("new names are exported and old names alias them", () => {
    const exports = lunibee as unknown as Record<string, unknown>;
    for (const [old, current] of Object.entries(renamed)) {
        expect(exports[current]).toBeDefined();
        expect(exports[old]).toBe(exports[current]);
    }
});

test("old builder names build the same objects", () => {
    const button = new lunibee.ButtonBuilder()
        .setCustomId("a")
        .setLabel("A")
        .setStyle(lunibee.ButtonStyle.Primary);
    expect(button).toBeInstanceOf(lunibee.CreateButton);
    expect(button.toJSON()).toEqual(
        new lunibee.CreateButton()
            .setCustomId("a")
            .setLabel("A")
            .setStyle(lunibee.ButtonType.Primary)
            .toJSON(),
    );
});

test("ActivityEnum has Discord's activity types", () => {
    expect(lunibee.ActivityEnum).toEqual({
        Playing: 0,
        Streaming: 1,
        Listening: 2,
        Watching: 3,
        Custom: 4,
        Competing: 5,
    });
});
