import { expect, test } from "bun:test";
import {
    CreateActionRow,
    CreateButton,
    CreateContainer,
    CreateModal,
    CreateStringSelect,
    CreateTextDisplay,
    CreateTextInput,
    type APIActionRowChild,
    type APIActionRowPayload,
    type APIButtonPayload,
    type APIComponent,
    type APIContainerComponent,
    type APIEntitySelectComponent,
    type APIModalComponent,
    type APISelectOption,
    type APIStringSelectComponent,
    type APITextDisplayComponent,
    type APITextInputPayload,
} from "../packages/lunibee/src/index.ts";

test("builder payload types are exported from lunibee and match toJSON()", () => {
    const button: APIButtonPayload = new CreateButton()
        .setCustomId("b")
        .setLabel("B")
        .setStyle(1)
        .toJSON();
    const select: APIStringSelectComponent = new CreateStringSelect()
        .setCustomId("s")
        .addOptions({ label: "A", value: "a" })
        .toJSON();
    const option: APISelectOption | undefined = select.options?.[0];
    const input: APITextInputPayload = new CreateTextInput()
        .setCustomId("t")
        .setLabel("T")
        .setStyle(1)
        .toJSON();
    const child: APIActionRowChild = button;
    const row: APIActionRowPayload = new CreateActionRow()
        .addComponents(
            new CreateButton().setCustomId("r").setLabel("R").setStyle(1),
        )
        .toJSON();
    const text: APITextDisplayComponent = new CreateTextDisplay()
        .setContent("hi")
        .toJSON();
    const container: APIContainerComponent = new CreateContainer()
        .addComponents(new CreateTextDisplay().setContent("hi"))
        .toJSON();
    const modal: APIModalComponent = new CreateModal()
        .setCustomId("m")
        .setTitle("M")
        .addTextInputs(
            new CreateTextInput().setCustomId("i").setLabel("I").setStyle(1),
        )
        .toJSON();
    const entity: APIEntitySelectComponent = { type: 5, custom_id: "u" };
    const any: APIComponent[] = [row, container, text, input, entity];

    expect(child.type).toBe(2);
    expect(option?.value).toBe("a");
    expect(row.type).toBe(1);
    expect(modal.type).toBe(9);
    expect(any.map((c) => c.type)).toEqual([1, 17, 10, 4, 5]);
});
