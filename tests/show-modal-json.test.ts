import { expect, test } from "bun:test";
import {
    createInteraction,
    type InteractionResponse,
} from "../packages/structures/src/index.ts";
import {
    CreateModal,
    CreateTextInput,
} from "../packages/builders/src/index.ts";

test("showModal accepts a builder and its toJSON() output alike", async () => {
    const sent: unknown[] = [];
    const client = {
        postInteractionResponse: async (
            _id: string,
            _token: string,
            response: InteractionResponse,
        ) => void sent.push(response.toJSON()),
        editInteractionReply: async () => undefined,
        deleteInteractionReply: async () => undefined,
        followUpInteraction: async () => undefined,
    };
    const modal = new CreateModal()
        .setCustomId("report")
        .setTitle("Report")
        .addTextInputs(
            new CreateTextInput()
                .setCustomId("why")
                .setLabel("Why?")
                .setStyle(2),
        );
    const make = (id: string) =>
        createInteraction(client, {
            id,
            application_id: "app",
            token: "tok",
            type: 2,
            data: { name: "report" },
        });

    await make("1").showModal(modal);
    // Type-checks without casts: the builder's payload type has no index signature.
    await make("2").showModal(modal.toJSON());
    expect(sent[0]).toEqual(sent[1]);
    expect((sent[0] as { type: number }).type).toBe(9);
});
