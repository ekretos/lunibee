import { describe, expect, test } from "bun:test";
import {
    CreateActionRow,
    CreateButton,
    ButtonType,
    ComponentEnum,
    CreateEntitySelect,
    CreateModal,
    CreateStringSelect,
    CreateTextInput,
    CreateIntegerOption,
    CreateNumberOption,
    CreateStringOption,
    CreateUserSelectMenu,
} from "../packages/builders/src/index.ts";

describe("component validation on toJSON", () => {
    test("buttons need an action and a label or emoji", () => {
        expect(() => new CreateButton().setLabel("x").toJSON()).toThrow(
            "custom ID",
        );
        expect(() =>
            new CreateButton().setStyle(ButtonType.Link).setLabel("x").toJSON(),
        ).toThrow("URL");
        expect(() => new CreateButton().setCustomId("a").toJSON()).toThrow(
            "label or an emoji",
        );
        expect(
            new CreateButton().setCustomId("a").setEmoji("👍").toJSON().emoji,
        ).toEqual({ name: "👍" });
        const premium = new CreateButton()
            .setCustomId("a")
            .setSKUId("123")
            .toJSON();
        expect(premium).toEqual({
            type: ComponentEnum.Button,
            style: ButtonType.Premium,
            sku_id: "123",
        });
        expect(() =>
            new CreateButton().setStyle(ButtonType.Premium).toJSON(),
        ).toThrow("SKU");
    });

    test("selects need a custom ID and consistent value bounds", () => {
        expect(() =>
            new CreateEntitySelect(ComponentEnum.RoleSelect).toJSON(),
        ).toThrow("custom ID");
        expect(() =>
            new CreateEntitySelect(ComponentEnum.RoleSelect)
                .setCustomId("r")
                .setMinValues(3)
                .setMaxValues(2)
                .toJSON(),
        ).toThrow("min_values");
        const select = new CreateStringSelect().setCustomId("s");
        expect(() => select.toJSON()).toThrow("at least one option");
        select.addOptions({ label: "a", value: "a" }).setMaxValues(2);
        expect(() => select.toJSON()).toThrow("number of options");
    });

    test("action rows cannot mix a select with other components", () => {
        const select = new CreateStringSelect()
            .setCustomId("s")
            .addOptions({ label: "a", value: "a" });
        const button = new CreateButton().setCustomId("b").setLabel("b");
        expect(() =>
            new CreateActionRow().addComponents(select, button).toJSON(),
        ).toThrow("alone");
        expect(
            new CreateActionRow().addComponents(button, button).toJSON()
                .components,
        ).toHaveLength(2);
    });

    test("modals and text inputs need their identifiers", () => {
        expect(() => new CreateModal().toJSON()).toThrow(
            "custom ID and a title",
        );
        expect(() =>
            new CreateModal().setCustomId("m").setTitle("t").toJSON(),
        ).toThrow("at least one");
        expect(() => new CreateTextInput().toJSON()).toThrow("custom ID");
        expect(() =>
            new CreateTextInput()
                .setCustomId("i")
                .setMinLength(10)
                .setMaxLength(5)
                .toJSON(),
        ).toThrow("min_length");
    });
});

describe("shared option rules", () => {
    test("integer and number choices validate names like string choices", () => {
        expect(() =>
            new CreateIntegerOption().addChoices({ name: "", value: 1 }),
        ).toThrow(RangeError);
        expect(() =>
            new CreateNumberOption().addChoices({
                name: "x".repeat(101),
                value: 1.5,
            }),
        ).toThrow(RangeError);
    });

    test("a rejected string choice leaves the option unchanged", () => {
        const option = new CreateStringOption()
            .setName("pick")
            .setDescription("d")
            .addChoices({ name: "a", value: "a" });
        expect(() => option.addChoices({ name: "b", value: "" })).toThrow(
            RangeError,
        );
        expect(option.toJSON().choices).toEqual([{ name: "a", value: "a" }]);
    });

    test("select menus share their setters", () => {
        const string = new CreateStringSelect()
            .setCustomId("s")
            .setPlaceholder("p")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions({ label: "a", value: "a" });
        const user = new CreateUserSelectMenu()
            .setCustomId("u")
            .setPlaceholder("p")
            .setDisabled();
        expect(string.toJSON()).toMatchObject({
            custom_id: "s",
            placeholder: "p",
        });
        expect(user.toJSON()).toMatchObject({
            type: 5,
            custom_id: "u",
            disabled: true,
        });
    });
});
