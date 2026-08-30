import { describe, expect, test } from "bun:test";
import {
  GatewayIntentBits,
  IntentBits,
  resolveGatewayIntents,
  ChannelType,
  MessageFlags,
  ApplicationCommandOptionType,
  ApplicationCommandType,
} from "../packages/types/src/index.ts";

describe("Types & Intent Resolvers", () => {
  test("resolveGatewayIntents resolves numbers, strings, enums, and arrays", () => {
    expect(resolveGatewayIntents(GatewayIntentBits.Guilds)).toBe(1);
    expect(resolveGatewayIntents("Guilds")).toBe(1);
    expect(resolveGatewayIntents("guilds")).toBe(1);
    expect(resolveGatewayIntents("guildMembers")).toBe(2);
    expect(resolveGatewayIntents("513" as any)).toBe(513);
    expect(resolveGatewayIntents(["Guilds", "GuildMessages"])).toBe(1 | 512);
    expect(
      resolveGatewayIntents([
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
      ]),
    ).toBe(1 | 32768);
    expect(resolveGatewayIntents("unknown_intent_string" as any)).toBe(0);
  });

  test("ChannelType enum constants", () => {
    expect(ChannelType.GuildText).toBe(0);
    expect(ChannelType.DM).toBe(1);
    expect(ChannelType.GuildVoice).toBe(2);
    expect(ChannelType.PublicThread).toBe(11);
    expect(ChannelType.PrivateThread).toBe(12);
  });

  test("MessageFlags enum constants", () => {
    expect(MessageFlags.Crossposted).toBe(1);
    expect(MessageFlags.SuppressEmbeds).toBe(4);
    expect(MessageFlags.Ephemeral).toBe(64);
  });

  test("ApplicationCommand types and options", () => {
    expect(ApplicationCommandType.ChatInput).toBe(1);
    expect(ApplicationCommandOptionType.String).toBe(3);
    expect(ApplicationCommandOptionType.Integer).toBe(4);
    expect(ApplicationCommandOptionType.Boolean).toBe(5);
  });
});
