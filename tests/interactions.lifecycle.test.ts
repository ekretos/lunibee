import { describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import {
    createInteraction,
    type InteractionClient,
    type InteractionData,
} from "../packages/structures/src/index.ts";

const BOT = "999000000000000001";
/** Some older applications have an ID that differs from their bot user's. */
const APP = "888000000000000001";
const ID = "1100000000000000000";

function setup() {
    const client = new Client({ token: "a.b", intents: [] });
    const ws = client.ws as unknown as { emit(e: string, d: unknown): void };
    ws.emit("READY", {
        user: { id: BOT, username: "bot" },
        guilds: [],
        session_id: "s",
        application: { id: APP },
    });
    const calls: string[] = [];
    const rest = client.rest as unknown as Record<string, unknown>;
    for (const method of ["get", "post", "patch", "delete"])
        rest[method] = async (path: string) => {
            calls.push(`${method.toUpperCase()} ${path}`);
            return {};
        };
    return { client, calls, rest };
}

const payload = (extra: Record<string, unknown> = {}) =>
    ({
        id: ID,
        application_id: APP,
        token: "tok",
        type: 2,
        data: { name: "ping", type: 1 },
        ...extra,
    }) as InteractionData;

describe("interaction webhooks use the interaction's application ID (I1)", () => {
    test("editReply, followUp and deleteReply target /webhooks/<application_id>", async () => {
        const { client, calls } = setup();
        const interaction = createInteraction(client, payload());
        await interaction.deferReply();
        await interaction.editReply({ content: "x" });
        await interaction.followUp("y");
        await interaction.deleteReply();
        const webhooks = calls.filter((call) => call.includes("/webhooks/"));
        expect(webhooks).toHaveLength(3);
        for (const call of webhooks)
            expect(call).toContain(`/webhooks/${APP}/`);
        client.destroy();
    });

    test("without an application ID the client falls back to its user ID, or refuses", async () => {
        const { client, calls } = setup();
        await client.editInteractionReply("tok", { content: "x" });
        await client.followUpInteraction("tok", { content: "x" });
        await client.deleteInteractionReply("tok");
        expect(calls.every((call) => call.includes(`/webhooks/${BOT}/`))).toBe(
            true,
        );
        const fresh = new Client({ token: "a.b", intents: [] });
        await expect(fresh.editInteractionReply("tok", {})).rejects.toThrow(
            "unauthenticated",
        );
        await expect(fresh.followUpInteraction("tok", {})).rejects.toThrow(
            "unauthenticated",
        );
        await expect(fresh.deleteInteractionReply("tok")).rejects.toThrow(
            "unauthenticated",
        );
        fresh.destroy();
        client.destroy();
    });
});

describe("acknowledgement state after a failed callback (I2)", () => {
    test("40060 (already acknowledged) marks the interaction acknowledged", async () => {
        const { client, rest } = setup();
        rest.post = async () => {
            throw Object.assign(
                new Error("Interaction has already been acknowledged."),
                {
                    code: 40060,
                },
            );
        };
        const interaction = createInteraction(client, payload());
        await expect(interaction.deferReply()).rejects.toThrow(
            "already been acknowledged",
        );
        expect(interaction.deferred).toBe(true);
        expect(interaction.replied).toBe(false);
        await interaction.editReply({ content: "recovered" });
        client.destroy();
    });

    test("any other failure leaves it unacknowledged so it can be retried", async () => {
        const { client, rest } = setup();
        rest.post = async () => {
            throw Object.assign(new Error("Unknown interaction"), {
                code: 10062,
            });
        };
        const interaction = createInteraction(client, payload());
        await expect(interaction.reply("a")).rejects.toThrow(
            "Unknown interaction",
        );
        expect(interaction.replied || interaction.deferred).toBe(false);
        expect(() => interaction.editReply({ content: "x" })).toThrow(
            "has not been acknowledged",
        );
        client.destroy();
    });
});

describe("message operations after a modal or autocomplete answer (I3)", () => {
    test("editReply, deleteReply and fetchReply are refused after showModal", async () => {
        const { client, calls } = setup();
        const interaction = createInteraction(client, payload());
        await interaction.showModal({
            custom_id: "m",
            title: "t",
            components: [],
        });
        const message = "answered with a modal or autocomplete choices";
        expect(() => interaction.editReply({ content: "x" })).toThrow(message);
        expect(() => interaction.deleteReply()).toThrow(message);
        expect(() => interaction.fetchReply()).toThrow(message);
        expect(calls).toHaveLength(1);
        client.destroy();
    });

    test("editReply is refused after autocomplete respond()", async () => {
        const { client } = setup();
        const interaction = createInteraction(client, payload({ type: 4 }));
        if (!interaction.isAutocomplete())
            throw new Error("expected autocomplete");
        await interaction.respond([]);
        expect(() => interaction.editReply({ content: "x" })).toThrow(
            "no reply message",
        );
        client.destroy();
    });
});

describe("responses Discord always rejects are refused locally (I4)", () => {
    test("followUp before the initial response", async () => {
        const { client, calls } = setup();
        const interaction = createInteraction(client, payload());
        expect(() => interaction.followUp("x")).toThrow(
            "has not been acknowledged",
        );
        expect(calls).toHaveLength(0);
        client.destroy();
    });

    test("update() on a slash command, deferUpdate() on a non-component", async () => {
        const { client, calls } = setup();
        const command = createInteraction(client, payload());
        await expect(command.update({ content: "x" })).rejects.toThrow(
            "update() only works on component interactions",
        );
        const modal = createInteraction(
            client,
            payload({ type: 5, data: { custom_id: "m" } }),
        );
        await expect(modal.update("x")).rejects.toThrow("use reply() instead");
        expect(calls).toHaveLength(0);
        expect(command.replied || command.deferred).toBe(false);
        client.destroy();
    });

    test("update() works on components and on modals opened from a component", async () => {
        const { client, calls } = setup();
        const component = createInteraction(
            client,
            payload({ type: 3, data: { custom_id: "b", component_type: 2 } }),
        );
        await component.update("x");
        const modal = createInteraction(
            client,
            payload({
                type: 5,
                data: { custom_id: "m" },
                message: { id: "1" },
            }),
        );
        await modal.update("y");
        const deferred = createInteraction(
            client,
            payload({ type: 3, data: { custom_id: "b", component_type: 2 } }),
        );
        if (!deferred.isMessageComponent())
            throw new Error("expected component");
        await deferred.deferUpdate();
        expect(calls.filter((call) => call.startsWith("POST"))).toHaveLength(3);
        client.destroy();
    });

    test("deferUpdate() checks the interaction type at runtime", async () => {
        const transport: InteractionClient = {
            postInteractionResponse: async () => ({}),
            editInteractionReply: async () => ({}),
            deleteInteractionReply: async () => {},
            followUpInteraction: async () => ({}),
        };
        const { ComponentInteraction } =
            await import("../packages/structures/src/index.ts");
        const odd = new ComponentInteraction(transport, payload());
        await expect(odd.deferUpdate()).rejects.toThrow(
            "deferUpdate() only works",
        );
    });
});
