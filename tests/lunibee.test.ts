import { describe, expect, test } from "bun:test";
import * as lunibee from "../packages/lunibee/src/index.ts";

describe("Lunibee Main Package", () => {
  test("exports core structures, managers, formatters, voice, and gateway state", () => {
    expect(lunibee.Client).toBeDefined();
    expect(lunibee.REST).toBeDefined();
    expect(lunibee.Gateway).toBeDefined();
    expect(lunibee.GatewayState).toBeDefined();
    expect(lunibee.EmbedBuilder).toBeDefined();
    expect(lunibee.SlashCommandBuilder).toBeDefined();
    expect(lunibee.PermissionsBitField).toBeDefined();
    expect(lunibee.userMention).toBeDefined();
    expect(lunibee.channelMention).toBeDefined();
    expect(lunibee.VoiceConnection).toBeDefined();
    expect(lunibee.sleep).toBeDefined();
  });
});
