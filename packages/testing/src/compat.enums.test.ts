/**
 * Wire-compatibility for enum values. Discord's gateway/REST reject payloads whose
 * numeric type/style/intent values do not match the documented protocol, so these
 * values MUST equal Discord's — regardless of Lunibee's own naming conventions.
 */
import { describe, expect, test } from "bun:test";
import {
    ComponentEnum as TypesComponentType,
    ButtonType as TypesButtonStyle,
    ChannelEnum,
    GatewayIntentBits,
    InteractionResponseEnum,
    TextInputType,
} from "@lunibee/types";
import {
    ComponentEnum as BuildersComponentType,
    ButtonType as BuildersButtonStyle,
} from "@lunibee/builders";

describe("Enum wire values — ComponentEnum", () => {
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
    test("builders ComponentEnum does not drift from the canonical types ComponentEnum", () => {
        for (const key of Object.keys(TypesComponentType) as Array<
            keyof typeof TypesComponentType
        >)
            expect(BuildersComponentType[key]).toBe(TypesComponentType[key]);
    });
});

describe("Enum wire values — ButtonType", () => {
    test("match Discord's documented button style numbers", () => {
        expect(TypesButtonStyle.Primary).toBe(1);
        expect(TypesButtonStyle.Secondary).toBe(2);
        expect(TypesButtonStyle.Success).toBe(3);
        expect(TypesButtonStyle.Danger).toBe(4);
        expect(TypesButtonStyle.Link).toBe(5);
        expect(TypesButtonStyle.Premium).toBe(6);
    });
    // @lunibee/builders' ButtonType must not drift from @lunibee/types (e.g. `Premium: 6`),
    // or .setStyle(ButtonType.Premium) would build an invalid Discord payload.
    test("builders ButtonType does not drift from the canonical types ButtonType", () => {
        for (const key of Object.keys(TypesButtonStyle) as Array<
            keyof typeof TypesButtonStyle
        >)
            expect(BuildersButtonStyle[key]).toBe(TypesButtonStyle[key]);
    });
});

describe("Enum wire values — ChannelEnum", () => {
    test("match Discord's documented channel type numbers", () => {
        expect(ChannelEnum.GuildText).toBe(0);
        expect(ChannelEnum.DM).toBe(1);
        expect(ChannelEnum.GuildVoice).toBe(2);
        expect(ChannelEnum.GroupDM).toBe(3);
        expect(ChannelEnum.GuildCategory).toBe(4);
        expect(ChannelEnum.GuildAnnouncement).toBe(5);
        expect(ChannelEnum.AnnouncementThread).toBe(10);
        expect(ChannelEnum.PublicThread).toBe(11);
        expect(ChannelEnum.PrivateThread).toBe(12);
        expect(ChannelEnum.GuildStageVoice).toBe(13);
        expect(ChannelEnum.GuildForum).toBe(15);
        expect(ChannelEnum.GuildMedia).toBe(16);
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

describe("Enum wire values — InteractionResponseEnum & TextInputType", () => {
    test("interaction response callback types match Discord numbers", () => {
        // Discord names differ (ChannelMessageWithSource, UpdateMessage, ...),
        // but the wire numbers must match exactly.
        expect(InteractionResponseEnum.Pong).toBe(1);
        expect(InteractionResponseEnum.ChannelMessage).toBe(4);
        expect(InteractionResponseEnum.DeferredChannelMessage).toBe(5);
        expect(InteractionResponseEnum.DeferredMessageUpdate).toBe(6);
        expect(InteractionResponseEnum.MessageUpdate).toBe(7);
        expect(InteractionResponseEnum.Autocomplete).toBe(8);
        expect(InteractionResponseEnum.Modal).toBe(9);
    });
    test("text input styles match Discord numbers", () => {
        expect(TextInputType.Short).toBe(1);
        expect(TextInputType.Paragraph).toBe(2);
    });
});
