import { describe, expect, test } from "bun:test";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EntitySelectBuilder,
    ModalBuilder,
    StringSelectBuilder,
    TextInputBuilder,
    TextInputStyle,
    ComponentType,
} from "../packages/builders/src/index.ts";

describe("component builders", () => {
    test("serializes entity selects with Discord component types", () => {
        const select = new EntitySelectBuilder(ComponentType.UserSelect)
            .setCustomId("users")
            .setMinValues(1)
            .setMaxValues(3)
            .setPlaceholder("Choose users");
        expect(select.toJSON()).toEqual({
            type: ComponentType.UserSelect,
            custom_id: "users",
            min_values: 1,
            max_values: 3,
            placeholder: "Choose users",
        });
    });

    test("rejects invalid select identifiers", () => {
        expect(() => new StringSelectBuilder().setCustomId(" ")).toThrow(
            RangeError,
        );
        expect(() =>
            new StringSelectBuilder().addOptions({ label: "", value: "x" }),
        ).toThrow(RangeError);
    });

    test("builds a modal containing a text input action row", () => {
        const input = new TextInputBuilder()
            .setCustomId("reason")
            .setStyle(TextInputStyle.Paragraph)
            .setLabel("Reason")
            .setRequired();
        const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
            input,
        );
        const modal = new ModalBuilder()
            .setCustomId("moderation")
            .setTitle("Moderation")
            .addComponents(row);
        expect(modal.toJSON()).toEqual({
            type: 9,
            custom_id: "moderation",
            title: "Moderation",
            components: [
                {
                    type: ComponentType.ActionRow,
                    components: [
                        {
                            type: ComponentType.TextInput,
                            style: TextInputStyle.Paragraph,
                            custom_id: "reason",
                            label: "Reason",
                            required: true,
                        },
                    ],
                },
            ],
        });
    });

    test("link buttons cannot retain an interaction custom id", () => {
        const button = new ButtonBuilder()
            .setCustomId("action")
            .setStyle(ButtonStyle.Primary)
            .setURL("https://example.com");
        expect(button.toJSON()).toEqual({
            type: ComponentType.Button,
            style: ButtonStyle.Link,
            url: "https://example.com/",
        });
    });
});
