/**
 * Wire-compatibility for enum values. Discord's gateway/REST reject payloads whose
 * numeric type/style/intent values do not match the documented protocol, so these
 * values MUST equal Discord's — regardless of Lunibee's own naming conventions.
 */
import { describe, expect, test } from "bun:test";
import {
    ComponentType as TypesComponentType,
    ButtonStyle as TypesButtonStyle,
    ChannelType,
    GatewayIntentBits,
    InteractionResponseType,
    TextInputStyle,
} from "@lunibee/types";
import {
    ComponentType as BuildersComponentType,
    ButtonStyle as BuildersButtonStyle,
} from "@lunibee/builders";

describe("Enum wire values — ComponentType", () => {
    test("match Discord's documented component type numbers", () => {
        expect(TypesComponentType.ActionRow).toBe(1);
        expect(TypesComponentType.Button).toBe(2);
        expect(TypesComponentType.StringSelect).toBe(3);
        expect(TypesComponentType.TextInput).toBe(4);
        expect(TypesComponentType.UserSelect).toBe(5);
        expect(TypesComponentType.RoleSelect).toBe(6);
        expect(TypesComponentType.MentionableSelect).toBe(7);
        expect(TypesComponentType.ChannelSelect).toBe(8);
        expect(TypesComponentType.Section).toBe(9);
        expect(TypesComponentType.TextDisplay).toBe(10);
        expect(TypesComponentType.Thumbnail).toBe(11);
        expect(TypesComponentType.MediaGallery).toBe(12);
        expect(TypesComponentType.File).toBe(13);
        expect(TypesComponentType.Separator).toBe(14);
        expect(TypesComponentType.Container).toBe(17);
    });
    test("builders ComponentType does not drift from the canonical types ComponentType", () => {
        for (const key of Object.keys(TypesComponentType) as Array<
            keyof typeof TypesComponentType
        >)
            expect(BuildersComponentType[key]).toBe(TypesComponentType[key]);
    });
});

describe("Enum wire values — ButtonStyle", () => {
    test("match Discord's documented button style numbers", () => {
        expect(TypesButtonStyle.Primary).toBe(1);
        expect(TypesButtonStyle.Secondary).toBe(2);
        expect(TypesButtonStyle.Success).toBe(3);
        expect(TypesButtonStyle.Danger).toBe(4);
        expect(TypesButtonStyle.Link).toBe(5);
        expect(TypesButtonStyle.Premium).toBe(6);
    });
    // @lunibee/builders ships its OWN ButtonStyle constant (a duplicate of the one in
    // @lunibee/types) that is missing `Premium: 6`. A dev importing ButtonStyle from the
    // builders package and calling .setStyle(ButtonStyle.Premium) gets undefined → an
    // invalid Discord payload. The two definitions must not drift.
    test.failing(
        "builders ButtonStyle does not drift from the canonical types ButtonStyle",
        () => {
            for (const key of Object.keys(TypesButtonStyle) as Array<
                keyof typeof TypesButtonStyle
            >)
                expect(BuildersButtonStyle[key]).toBe(TypesButtonStyle[key]);
        },
    );
});

describe("Enum wire values — ChannelType", () => {
    test("match Discord's documented channel type numbers", () => {
        expect(ChannelType.GuildText).toBe(0);
        expect(ChannelType.DM).toBe(1);
        expect(ChannelType.GuildVoice).toBe(2);
        expect(ChannelType.GroupDM).toBe(3);
        expect(ChannelType.GuildCategory).toBe(4);
        expect(ChannelType.GuildAnnouncement).toBe(5);
        expect(ChannelType.AnnouncementThread).toBe(10);
        expect(ChannelType.PublicThread).toBe(11);
        expect(ChannelType.PrivateThread).toBe(12);
        expect(ChannelType.GuildStageVoice).toBe(13);
        expect(ChannelType.GuildForum).toBe(15);
        expect(ChannelType.GuildMedia).toBe(16);
    });
});

describe("Enum wire values — GatewayIntentBits", () => {
    test("match Discord's documented intent bit positions", () => {
        expect(GatewayIntentBits.Guilds).toBe(1 << 0);
        expect(GatewayIntentBits.GuildMembers).toBe(1 << 1);
        expect(GatewayIntentBits.GuildModeration).toBe(1 << 2);
        expect(GatewayIntentBits.GuildVoiceStates).toBe(1 << 7);
        expect(GatewayIntentBits.GuildPresences).toBe(1 << 8);
        expect(GatewayIntentBits.GuildMessages).toBe(1 << 9);
        expect(GatewayIntentBits.MessageContent).toBe(1 << 15);
        expect(GatewayIntentBits.GuildScheduledEvents).toBe(1 << 16);
        expect(GatewayIntentBits.AutoModerationConfiguration).toBe(1 << 20);
        expect(GatewayIntentBits.AutoModerationExecution).toBe(1 << 21);
    });
});

describe("Enum wire values — InteractionResponseType & TextInputStyle", () => {
    test("interaction response callback types match Discord numbers", () => {
        // Discord names differ (ChannelMessageWithSource, UpdateMessage, ...),
        // but the wire numbers must match exactly.
        expect(InteractionResponseType.Pong).toBe(1);
        expect(InteractionResponseType.ChannelMessage).toBe(4);
        expect(InteractionResponseType.DeferredChannelMessage).toBe(5);
        expect(InteractionResponseType.DeferredMessageUpdate).toBe(6);
        expect(InteractionResponseType.MessageUpdate).toBe(7);
        expect(InteractionResponseType.Autocomplete).toBe(8);
        expect(InteractionResponseType.Modal).toBe(9);
    });
    test("text input styles match Discord numbers", () => {
        expect(TextInputStyle.Short).toBe(1);
        expect(TextInputStyle.Paragraph).toBe(2);
    });
});
