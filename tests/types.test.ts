import { describe, expect, test } from "bun:test";
import {
    GatewayIntentBits,
    IntentBits,
    resolveGatewayIntents,
    ChannelEnum,
    MessageFlags,
    ApplicationCommandOptionEnum,
    ApplicationCommandEnum,
} from "../packages/types/src/index.ts";

describe("Types & Intent Resolvers", () => {
    test("resolveGatewayIntents resolves arrays and rejects everything else", () => {
        expect(resolveGatewayIntents([GatewayIntentBits.Guilds])).toBe(1);
        expect(resolveGatewayIntents(["Guilds", "guildMembers"])).toBe(3);
        expect(resolveGatewayIntents(["Guilds", "GuildMessages"])).toBe(
            1 | 512,
        );
        expect(
            resolveGatewayIntents([
                GatewayIntentBits.Guilds,
                GatewayIntentBits.MessageContent,
            ]),
        ).toBe(1 | 32768);
        expect(resolveGatewayIntents([])).toBe(0);
        expect(resolveGatewayIntents(["unknown_intent_string"])).toBe(0);
        // @ts-expect-error a single number is not accepted
        expect(() => resolveGatewayIntents(GatewayIntentBits.Guilds)).toThrow(
            TypeError,
        );
        // @ts-expect-error an OR-ed bitfield is not accepted
        expect(() => resolveGatewayIntents(1 | 512)).toThrow(TypeError);
        // @ts-expect-error a single name is not accepted
        expect(() => resolveGatewayIntents("Guilds")).toThrow(TypeError);
    });

    test("ChannelEnum enum constants", () => {
        expect(ChannelEnum.GuildText).toBe(0);
        expect(ChannelEnum.DM).toBe(1);
        expect(ChannelEnum.GuildVoice).toBe(2);
        expect(ChannelEnum.PublicThread).toBe(11);
        expect(ChannelEnum.PrivateThread).toBe(12);
    });

    test("MessageFlags enum constants", () => {
        expect(MessageFlags.Crossposted).toBe(1);
        expect(MessageFlags.SuppressEmbeds).toBe(4);
        expect(MessageFlags.Ephemeral).toBe(64);
    });

    test("ApplicationCommand types and options", () => {
        expect(ApplicationCommandEnum.ChatInput).toBe(1);
        expect(ApplicationCommandOptionEnum.String).toBe(3);
        expect(ApplicationCommandOptionEnum.Integer).toBe(4);
        expect(ApplicationCommandOptionEnum.Boolean).toBe(5);
    });
});
