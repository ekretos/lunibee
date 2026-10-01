import { describe, expect, test } from "bun:test";
import {
    CreateActionRow,
    CreateButton,
    ButtonType,
    CreateEntitySelect,
    CreateModal,
    CreateStringSelect,
    CreateTextInput,
    TextInputType,
    ComponentEnum,
} from "../packages/builders/src/index.ts";

describe("component builders", () => {
    test("serializes entity selects with Discord component types", () => {
        const select = new CreateEntitySelect(ComponentEnum.UserSelect)
            .setCustomId("users")
            .setMinValues(1)
            .setMaxValues(3)
            .setPlaceholder("Choose users");
        expect(select.toJSON()).toEqual({
            type: ComponentEnum.UserSelect,
            custom_id: "users",
            min_values: 1,
            max_values: 3,
            placeholder: "Choose users",
        });
    });

    test("rejects invalid select identifiers", () => {
        expect(() => new CreateStringSelect().setCustomId(" ")).toThrow(
            RangeError,
        );
        expect(() =>
            new CreateStringSelect().addOptions({ label: "", value: "x" }),
        ).toThrow(RangeError);
    });

    test("builds a modal containing a text input action row", () => {
        const input = new CreateTextInput()
            .setCustomId("reason")
            .setStyle(TextInputType.Paragraph)
            .setLabel("Reason")
            .setRequired();
        const row = new CreateActionRow<CreateTextInput>().addComponents(input);
        const modal = new CreateModal()
            .setCustomId("moderation")
            .setTitle("Moderation")
            .addComponents(row);
        expect(modal.toJSON()).toEqual({
            type: 9,
            custom_id: "moderation",
            title: "Moderation",
            components: [
                {
                    type: ComponentEnum.ActionRow,
                    components: [
                        {
                            type: ComponentEnum.TextInput,
                            style: TextInputType.Paragraph,
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
        const button = new CreateButton()
            .setCustomId("action")
            .setStyle(ButtonType.Primary)
            .setURL("https://example.com")
            .setLabel("Open");
        expect(button.toJSON()).toEqual({
            type: ComponentEnum.Button,
            style: ButtonType.Link,
            label: "Open",
            url: "https://example.com/",
        });
    });
});
