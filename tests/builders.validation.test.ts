import { describe, expect, test } from "bun:test";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    EntitySelectBuilder,
    ModalBuilder,
    StringSelectBuilder,
    TextInputBuilder,
} from "../packages/builders/src/index.ts";

describe("component validation on toJSON", () => {
    test("buttons need an action and a label or emoji", () => {
        expect(() => new ButtonBuilder().setLabel("x").toJSON()).toThrow(
            "custom ID",
        );
        expect(() =>
            new ButtonBuilder()
                .setStyle(ButtonStyle.Link)
                .setLabel("x")
                .toJSON(),
        ).toThrow("URL");
        expect(() => new ButtonBuilder().setCustomId("a").toJSON()).toThrow(
            "label or an emoji",
        );
        expect(
            new ButtonBuilder().setCustomId("a").setEmoji("👍").toJSON().emoji,
        ).toEqual({ name: "👍" });
        const premium = new ButtonBuilder()
            .setCustomId("a")
            .setSKUId("123")
            .toJSON();
        expect(premium).toEqual({
            type: ComponentType.Button,
            style: ButtonStyle.Premium,
            sku_id: "123",
        });
        expect(() =>
            new ButtonBuilder().setStyle(ButtonStyle.Premium).toJSON(),
        ).toThrow("SKU");
    });

    test("selects need a custom ID and consistent value bounds", () => {
        expect(() =>
            new EntitySelectBuilder(ComponentType.RoleSelect).toJSON(),
        ).toThrow("custom ID");
        expect(() =>
            new EntitySelectBuilder(ComponentType.RoleSelect)
                .setCustomId("r")
                .setMinValues(3)
                .setMaxValues(2)
                .toJSON(),
        ).toThrow("min_values");
        const select = new StringSelectBuilder().setCustomId("s");
        expect(() => select.toJSON()).toThrow("at least one option");
        select.addOptions({ label: "a", value: "a" }).setMaxValues(2);
        expect(() => select.toJSON()).toThrow("number of options");
    });

    test("action rows cannot mix a select with other components", () => {
        const select = new StringSelectBuilder()
            .setCustomId("s")
            .addOptions({ label: "a", value: "a" });
        const button = new ButtonBuilder().setCustomId("b").setLabel("b");
        expect(() =>
            new ActionRowBuilder().addComponents(select, button).toJSON(),
        ).toThrow("alone");
        expect(
            new ActionRowBuilder().addComponents(button, button).toJSON()
                .components,
        ).toHaveLength(2);
    });

    test("modals and text inputs need their identifiers", () => {
        expect(() => new ModalBuilder().toJSON()).toThrow(
            "custom ID and a title",
        );
        expect(() =>
            new ModalBuilder().setCustomId("m").setTitle("t").toJSON(),
        ).toThrow("at least one");
        expect(() => new TextInputBuilder().toJSON()).toThrow("custom ID");
        expect(() =>
            new TextInputBuilder()
                .setCustomId("i")
                .setMinLength(10)
                .setMaxLength(5)
                .toJSON(),
        ).toThrow("min_length");
    });
});
