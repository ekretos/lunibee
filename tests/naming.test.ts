import { expect, test } from "bun:test";
import * as lunibee from "../packages/lunibee/src/index.js";

// 0.2.2 naming: builders are `CreateX`, `…Style` became `…Type`, `…Type` became `…Enum`.
// The old names stay as deprecated aliases of the same values until 0.3.1.
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
    ChannelSelectMenuBuilder: "CreateChannelSelect",
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
    MentionableSelectMenuBuilder: "CreateMentionableSelect",
    MessageCommandBuilder: "CreateMessageCommand",
    ModalBuilder: "CreateModal",
    NumberOptionBuilder: "CreateNumberOption",
    PermissionOverwriteType: "PermissionOverwriteEnum",
    RoleOptionBuilder: "CreateRoleOption",
    RoleSelectMenuBuilder: "CreateRoleSelect",
    SectionBuilder: "CreateSection",
    SeparatorBuilder: "CreateSeparator",
    SlashCommandBuilder: "CreateSlashCommand",
    StickerFormatType: "StickerFormatEnum",
    StickerType: "StickerEnum",
    StringOptionBuilder: "CreateStringOption",
    StringSelectBuilder: "CreateStringSelect",
    StringSelectMenuBuilder: "CreateStringSelect",
    SubcommandBuilder: "CreateSubcommand",
    SubcommandGroupBuilder: "CreateSubcommandGroup",
    TextDisplayBuilder: "CreateTextDisplay",
    TextInputBuilder: "CreateTextInput",
    TextInputStyle: "TextInputType",
    ThumbnailBuilder: "CreateThumbnail",
    UserCommandBuilder: "CreateUserCommand",
    UserOptionBuilder: "CreateUserOption",
    UserSelectMenuBuilder: "CreateUserSelect",
    WebhookType: "WebhookEnum",
};

test("new names are exported and the removed names are gone", () => {
    const exports = lunibee as unknown as Record<string, unknown>;
    for (const [old, current] of Object.entries(renamed)) {
        expect(exports[current]).toBeDefined();
        expect(exports[old]).toBeUndefined();
    }
});

// 0.4.0 removed the compatibility aliases.
const removedIn040: Record<string, string> = {
    Events: "ClientEvent",
    CreateStringSelectMenu: "CreateStringSelect",
    CreateUserSelectMenu: "CreateUserSelect",
    CreateRoleSelectMenu: "CreateRoleSelect",
    CreateMentionableSelectMenu: "CreateMentionableSelect",
    CreateChannelSelectMenu: "CreateChannelSelect",
    CachedManager: "ResourceManager",
    DiscordAPIError: "RESTError",
    ShardingManager: "ShardManager",
    Intents: "IntentBits",
    SendBudget: "GatewaySendLimiter",
    Status: "GatewayState",
    IntentsBitField: "GatewayIntentBits",
};

test("the compatibility aliases removed in 0.4.0 are gone", () => {
    const exports = lunibee as unknown as Record<string, unknown>;
    for (const [old, current] of Object.entries(removedIn040)) {
        expect(exports[current]).toBeDefined();
        expect(exports[old]).toBeUndefined();
    }
});
