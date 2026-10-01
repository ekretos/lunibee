import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import {
    AutocompleteInteraction,
    ComponentInteraction,
    createInteraction,
    ModalSubmitInteraction,
    type InteractionClient,
} from "../packages/structures/src/index.ts";

const client = {} as InteractionClient;
const base = {
    id: "100000000000000001",
    application_id: "100000000000000002",
    token: "token",
};

describe("interaction data is read without any", () => {
    test("component fields come from the payload", () => {
        const select = createInteraction(client, {
            ...base,
            type: 3,
            message: { id: "100000000000000003" },
            data: { custom_id: "menu", component_type: 3, values: ["a", "b"] },
        });
        expect(select).toBeInstanceOf(ComponentInteraction);
        if (!select.isStringSelectMenu()) throw new Error("not a select");
        // The guard narrows: `values` is string[] without a cast.
        const values: string[] = select.values;
        expect(values).toEqual(["a", "b"]);
        expect(select.customId).toBe("menu");
        expect(select.componentType).toBe(3);
        expect(select.messageId).toBe("100000000000000003");
    });

    test("malformed component data falls back instead of leaking wrong types", () => {
        const odd = new ComponentInteraction(client, {
            ...base,
            type: 3,
            data: { custom_id: 42, component_type: "3", values: "a" },
        });
        expect(odd.customId).toBe("");
        expect(odd.componentType).toBe(0);
        expect(odd.values).toEqual([]);
        expect(odd.messageId).toBeUndefined();
    });

    test("modal and autocomplete fields come from the payload", () => {
        const modal = new ModalSubmitInteraction(client, {
            ...base,
            type: 5,
            data: {
                custom_id: "form",
                components: [
                    { components: [{ custom_id: "name", value: "Bee" }] },
                ],
            },
        });
        expect(modal.customId).toBe("form");
        expect(modal.getInputValue("name")).toBe("Bee");
        expect(modal.getInputValue("missing")).toBeUndefined();

        const auto = new AutocompleteInteraction(client, {
            ...base,
            type: 4,
            data: {
                name: "search",
                options: [
                    {
                        name: "sub",
                        type: 1,
                        options: [
                            { name: "q", type: 3, value: "lu", focused: true },
                        ],
                    },
                ],
            },
        });
        expect(auto.commandName).toBe("search");
        expect(auto.focusedOption).toEqual({ name: "q", value: "lu", type: 3 });
    });

    test("resolved options are read through one typed lookup", () => {
        const command = createInteraction(client, {
            ...base,
            type: 2,
            data: {
                name: "info",
                type: 1,
                options: [
                    { name: "who", type: 9, value: "100000000000000004" },
                ],
                resolved: {
                    users: {
                        "100000000000000004": { id: "100000000000000004" },
                    },
                },
            },
        });
        if (!command.isChatInputCommand()) throw new Error("not a command");
        expect(command.options.getMentionable("who")).toEqual({
            id: "100000000000000004",
        });
        expect(command.options.getMentionableType("who")).toBe("user");
    });

    test("structures source has no `any`", async () => {
        const offenders: string[] = [];
        for await (const file of new Glob(
            "packages/structures/src/*.ts",
        ).scan()) {
            if (file.endsWith(".test.ts")) continue;
            const text = await Bun.file(file).text();
            text.split("\n").forEach((line, index) => {
                const code = line.replace(/\/\/.*$|\/\*.*?\*\//g, "");
                if (/\bas any\b|:\s*any\b|\bany\[\]/.test(code))
                    offenders.push(`${file}:${index + 1}`);
            });
        }
        expect(offenders).toEqual([]);
    });
});
