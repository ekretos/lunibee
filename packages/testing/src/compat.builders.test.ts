/**
 * Builder → Discord API payload compatibility. Builders are Discord.js-familiar
 * (CreateEmbed, CreateButton, CreateActionRow, CreateSlashCommand, ...); their
 * toJSON() output is sent to Discord verbatim, so the payload shape (snake_case keys,
 * numeric type/style, nesting) must match the Discord REST contract.
 */
import { describe, expect, test } from "bun:test";
import {
    CreateEmbed,
    CreateButton,
    ButtonType,
    ComponentEnum,
    CreateActionRow,
    CreateStringSelect,
    CreateModal,
    CreateTextInput,
    CreateSlashCommand,
} from "@lunibee/builders";

describe("CreateEmbed → APIEmbed payload", () => {
    test("serializes snake_case footer/author/field keys", () => {
        const embed = new CreateEmbed()
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
        const embed = new CreateEmbed().addFields({ name: "a", value: "b" });
        const a = embed.toJSON();
        a.fields![0]!.name = "mutated";
        expect(embed.toJSON().fields![0]!.name).toBe("a");
    });
    test("rejects out-of-range color like Discord", () => {
        expect(() => new CreateEmbed().setColor(0x1000000)).toThrow(RangeError);
    });
    // discord.js CreateEmbed.addFields accepts BOTH spread and a single array
    // (RestOrArray); Lunibee matches.
    test("addFields accepts an array argument (discord.js RestOrArray)", () => {
        const embed = new CreateEmbed().addFields([
            { name: "f1", value: "v1" },
            { name: "f2", value: "v2" },
        ] as unknown as { name: string; value: string });
        expect(embed.toJSON().fields).toHaveLength(2);
    });
});

describe("CreateButton → APIButtonComponent payload", () => {
    test("primary button carries type 2 and the chosen style", () => {
        const json = new CreateButton()
            .setCustomId("btn")
            .setLabel("Click")
            .setStyle(ButtonType.Primary)
            .toJSON();
        expect(json.type).toBe(ComponentEnum.Button);
        expect(json.type).toBe(2);
        expect(json.style).toBe(ButtonType.Primary);
        expect(json.custom_id).toBe("btn");
        expect(json.label).toBe("Click");
    });
    test("link button uses url and drops custom_id", () => {
        const json = new CreateButton()
            .setLabel("Docs")
            .setURL("https://lunibee.dev")
            .toJSON();
        expect(json.style).toBe(ButtonType.Link);
        expect(json.url).toBe("https://lunibee.dev/");
        expect(json.custom_id).toBeUndefined();
    });
    test("rejects a custom id on a link button", () => {
        expect(() =>
            new CreateButton().setURL("https://x.dev").setCustomId("nope"),
        ).toThrow(TypeError);
    });
});

describe("CreateActionRow → APIActionRowComponent payload", () => {
    test("wraps children with type 1 and nested toJSON payloads", () => {
        const row = new CreateActionRow().addComponents(
            new CreateButton()
                .setCustomId("a")
                .setLabel("A")
                .setStyle(ButtonType.Secondary),
            new CreateButton()
                .setCustomId("b")
                .setLabel("B")
                .setStyle(ButtonType.Danger),
        );
        const json = row.toJSON();
        expect(json.type).toBe(1);
        expect(json.components).toHaveLength(2);
        expect(json.components[0]!.type).toBe(2);
    });
    test("enforces the Discord 5-component row limit", () => {
        const row = new CreateActionRow();
        const buttons = Array.from({ length: 6 }, (_, i) =>
            new CreateButton()
                .setCustomId(`b${i}`)
                .setStyle(ButtonType.Secondary),
        );
        expect(() => row.addComponents(...buttons)).toThrow(RangeError);
    });
});

describe("CreateStringSelect → APIStringSelectComponent payload", () => {
    test("carries type 3 and snake_case option/limit keys", () => {
        const json = new CreateStringSelect()
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

describe("CreateModal → APIModalComponent payload", () => {
    test("nests text inputs inside action rows with correct types", () => {
        const modal = new CreateModal()
            .setCustomId("m")
            .setTitle("Feedback")
            .addComponents(
                new CreateActionRow().addComponents(
                    new CreateTextInput()
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

describe("CreateSlashCommand → application command payload", () => {
    test("serializes name/description/options with numeric option types", () => {
        const json = new CreateSlashCommand()
            .setName("ban")
            .setDescription("Ban a user")
            .addUserOption((o) =>
                o.setName("target").setDescription("Who").setRequired(true),
            )
            .addStringOption((o) => o.setName("reason").setDescription("Why"))
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
            new CreateSlashCommand()
                .setName("cmd")
                .setDescription("d")
                .addStringOption((o) => o.setName("opt").setDescription("d"))
                .addUserOption((o) =>
                    o.setName("req").setDescription("d").setRequired(true),
                ),
        ).toThrow(RangeError);
    });
});
