import { describe, expect, test } from "bun:test";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectBuilder, SlashCommandBuilder } from "../src/index.js";

describe("builders", () => {
    test("rejects invalid command names", () => {
        expect(() => new SlashCommandBuilder().setName("Hello").setDescription("test")).toThrow();
    });

    test("rejects duplicate command option names", () => {
        const command = new SlashCommandBuilder().setName("test").setDescription("test");
        command.addStringOption(option => option.setName("value").setDescription("value"));
        expect(() => command.addStringOption(option => option.setName("value").setDescription("value"))).toThrow();
    });

    test("rejects required options after optional options", () => {
        const command = new SlashCommandBuilder().setName("test").setDescription("test");
        command.addStringOption(option => option.setName("optional").setDescription("optional"));
        expect(() => command.addStringOption(option => option.setName("required").setDescription("required").setRequired())).toThrow();
    });

    test("validates button payloads", () => {
        expect(() => new ButtonBuilder().toJSON()).toThrow();
        expect(new ButtonBuilder().setStyle(ButtonStyle.Primary).setCustomId("ok").setLabel("OK").toJSON()).toMatchObject({ style: 1, custom_id: "ok", label: "OK" });
    });

    test("validates select ranges", () => {
        expect(() => new StringSelectBuilder().setMinValues(3).setMaxValues(2)).toThrow();
    });

    test("enforces aggregate embed limits", () => {
        const embed = new EmbedBuilder().setTitle("x".repeat(256)).setDescription("x".repeat(4096));
        expect(() => embed.addFields({ name: "x".repeat(256), value: "x".repeat(1024) }).toJSON()).toThrow();
    });

    test("limits action rows", () => {
        const row = new ActionRowBuilder<ButtonBuilder>();
        for (let index = 0; index < 5; index++) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Primary).setCustomId(String(index)));
        expect(() => row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Primary).setCustomId("6"))).toThrow();
    });
});
