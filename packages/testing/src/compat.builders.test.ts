/**
 * Builder → Discord API payload compatibility. Builders are Discord.js-familiar
 * (EmbedBuilder, ButtonBuilder, ActionRowBuilder, SlashCommandBuilder, ...); their
 * toJSON() output is sent to Discord verbatim, so the payload shape (snake_case keys,
 * numeric type/style, nesting) must match the Discord REST contract.
 */
import { describe, expect, test } from "bun:test";
import {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ActionRowBuilder,
    StringSelectBuilder,
    ModalBuilder,
    TextInputBuilder,
    SlashCommandBuilder,
} from "@lunibee/builders";

describe("EmbedBuilder → APIEmbed payload", () => {
    test("serializes snake_case footer/author/field keys", () => {
        const embed = new EmbedBuilder()
            .setTitle("Title")
            .setDescription("Desc")
            .setColor(0x5865f2)
            .setFooter({ text: "foot", icon_url: "https://cdn.test/i.png" })
            .setAuthor({ name: "auth", url: "https://test.dev" })
            .addFields({ name: "f1", value: "v1", inline: true });
        const json = embed.toJSON();
        expect(json.title).toBe("Title");
        expect(json.description).toBe("Desc");
        expect(json.color).toBe(0x5865f2);
        expect(json.footer).toEqual({
            text: "foot",
            icon_url: "https://cdn.test/i.png",
        });
        expect(json.author?.name).toBe("auth");
        expect(json.fields).toEqual([
            { name: "f1", value: "v1", inline: true },
        ]);
    });
    test("toJSON returns an independent (deep-cloned) payload", () => {
        const embed = new EmbedBuilder().addFields({ name: "a", value: "b" });
        const a = embed.toJSON();
        a.fields![0]!.name = "mutated";
        expect(embed.toJSON().fields![0]!.name).toBe("a");
    });
    test("rejects out-of-range color like Discord", () => {
        expect(() => new EmbedBuilder().setColor(0x1000000)).toThrow(RangeError);
    });
    // discord.js EmbedBuilder.addFields accepts BOTH spread and a single array
    // (RestOrArray). Lunibee only accepts spread, so addFields([...]) throws.
    test.failing("addFields accepts an array argument (discord.js RestOrArray)", () => {
        const embed = new EmbedBuilder().addFields([
            { name: "f1", value: "v1" },
            { name: "f2", value: "v2" },
        ] as unknown as { name: string; value: string });
        expect(embed.toJSON().fields).toHaveLength(2);
    });
});

describe("ButtonBuilder → APIButtonComponent payload", () => {
    test("primary button carries type 2 and the chosen style", () => {
        const json = new ButtonBuilder()
            .setCustomId("btn")
            .setLabel("Click")
            .setStyle(ButtonStyle.Primary)
            .toJSON();
        expect(json.type).toBe(ComponentType.Button);
        expect(json.type).toBe(2);
        expect(json.style).toBe(ButtonStyle.Primary);
        expect(json.custom_id).toBe("btn");
        expect(json.label).toBe("Click");
    });
    test("link button uses url and drops custom_id", () => {
        const json = new ButtonBuilder()
            .setLabel("Docs")
            .setURL("https://lunibee.dev")
            .toJSON();
        expect(json.style).toBe(ButtonStyle.Link);
        expect(json.url).toBe("https://lunibee.dev/");
        expect(json.custom_id).toBeUndefined();
    });
    test("rejects a custom id on a link button", () => {
        expect(() =>
            new ButtonBuilder().setURL("https://x.dev").setCustomId("nope"),
        ).toThrow(TypeError);
    });
});

describe("ActionRowBuilder → APIActionRowComponent payload", () => {
    test("wraps children with type 1 and nested toJSON payloads", () => {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("a").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("b").setStyle(ButtonStyle.Danger),
        );
        const json = row.toJSON();
        expect(json.type).toBe(1);
        expect(json.components).toHaveLength(2);
        expect(json.components[0]!.type).toBe(2);
    });
    test("enforces the Discord 5-component row limit", () => {
        const row = new ActionRowBuilder();
        const buttons = Array.from({ length: 6 }, (_, i) =>
            new ButtonBuilder().setCustomId(`b${i}`).setStyle(ButtonStyle.Secondary),
        );
        expect(() => row.addComponents(...buttons)).toThrow(RangeError);
    });
});

describe("StringSelectBuilder → APIStringSelectComponent payload", () => {
    test("carries type 3 and snake_case option/limit keys", () => {
        const json = new StringSelectBuilder()
            .setCustomId("sel")
            .setPlaceholder("pick")
            .setMinValues(1)
            .setMaxValues(2)
            .addOptions(
                { label: "One", value: "1" },
                { label: "Two", value: "2", description: "second" },
            )
            .toJSON();
        expect(json.type).toBe(3);
        expect(json.custom_id).toBe("sel");
        expect(json.min_values).toBe(1);
        expect(json.max_values).toBe(2);
        expect(json.options).toHaveLength(2);
        expect(json.options![1]).toEqual({
            label: "Two",
            value: "2",
            description: "second",
        });
    });
});

describe("ModalBuilder → APIModalComponent payload", () => {
    test("nests text inputs inside action rows with correct types", () => {
        const modal = new ModalBuilder()
            .setCustomId("m")
            .setTitle("Feedback")
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("field")
                        .setLabel("Your feedback")
                        .setStyle(2),
                ),
            );
        const json = modal.toJSON();
        expect(json.custom_id).toBe("m");
        expect(json.title).toBe("Feedback");
        expect(json.components[0]!.type).toBe(1);
        expect(json.components[0]!.components[0]!.type).toBe(4);
    });
});

describe("SlashCommandBuilder → application command payload", () => {
    test("serializes name/description/options with numeric option types", () => {
        const json = new SlashCommandBuilder()
            .setName("ban")
            .setDescription("Ban a user")
            .addUserOption((o) =>
                o.setName("target").setDescription("Who").setRequired(true),
            )
            .addStringOption((o) =>
                o.setName("reason").setDescription("Why"),
            )
            .toJSON();
        expect(json.name).toBe("ban");
        expect(json.description).toBe("Ban a user");
        const options = json.options as Array<Record<string, unknown>>;
        expect(options).toHaveLength(2);
        expect(options[0]!.name).toBe("target");
        expect(options[0]!.required).toBe(true);
        // Discord requires required options before optional ones.
        expect(options[1]!.required).not.toBe(true);
    });
    test("enforces required-before-optional ordering like Discord", () => {
        expect(() =>
            new SlashCommandBuilder()
                .setName("cmd")
                .setDescription("d")
                .addStringOption((o) => o.setName("opt").setDescription("d"))
                .addUserOption((o) =>
                    o.setName("req").setDescription("d").setRequired(true),
                ),
        ).toThrow(RangeError);
    });
});
