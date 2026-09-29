import { expect, test } from "bun:test";
import * as lunibee from "../packages/lunibee/src/index.js";

// 0.2.2 naming: builders are `CreateX`, `…Style` became `…Type`, `…Type` became `…Enum`.
// The old names stay as deprecated aliases of the same values until 2.0.
const renamed: Record<string, string> = {
    ActionRowBuilder: "CreateActionRow",
    AttachmentBuilder: "CreateAttachment",
    ButtonBuilder: "CreateButton",
    ContainerBuilder: "CreateContainer",
    EmbedBuilder: "CreateEmbed",
    ModalBuilder: "CreateModal",
    SlashCommandBuilder: "CreateSlashCommand",
    StringSelectMenuBuilder: "CreateStringSelectMenu",
    TextInputBuilder: "CreateTextInput",
    ButtonStyle: "ButtonType",
    TextInputStyle: "TextInputType",
    ChannelType: "ChannelEnum",
    ComponentType: "ComponentEnum",
    ApplicationCommandType: "ApplicationCommandEnum",
    ApplicationCommandOptionType: "ApplicationCommandOptionEnum",
    InteractionType: "InteractionEnum",
    InteractionResponseType: "InteractionResponseEnum",
    StickerType: "StickerEnum",
    StickerFormatType: "StickerFormatEnum",
    WebhookType: "WebhookEnum",
    PermissionOverwriteType: "PermissionOverwriteEnum",
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
