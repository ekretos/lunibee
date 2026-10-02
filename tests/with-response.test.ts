import { describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import {
    ComponentInteraction,
    createInteraction,
    Message,
} from "../packages/structures/src/index.ts";

const CHANNEL = "200000000000000001";
const MESSAGE = "200000000000000002";
const USER = "200000000000000003";

/** Interaction callback body as the REST stub receives it. */
type SentBody = { type: number; data: Record<string, string | number> };

function setup() {
    const bot = new Client({ token: "a.b", intents: 0 });
    const calls: { path: string; body: SentBody }[] = [];
    bot.rest.post = (async (path: string, body: SentBody) => {
        calls.push({ path, body });
        return path.includes("with_response=true")
            ? {
                  interaction: { id: "1", type: 2 },
                  resource: {
                      type: body.type,
                      message: {
                          id: MESSAGE,
                          channel_id: CHANNEL,
                          author: { id: USER, username: "bot" },
                          content: "created",
                      },
                  },
              }
            : undefined;
    }) as typeof bot.rest.post;
    return { bot, calls };
}

const command = (bot: Client) =>
    createInteraction(bot, {
        id: "1",
        application_id: USER,
        token: "tok",
        type: 2,
        data: { name: "ping" },
    });
const component = (bot: Client) =>
    createInteraction(bot, {
        id: "2",
        application_id: USER,
        token: "tok",
        type: 3,
        data: { custom_id: "b", component_type: 2 },
    }) as ComponentInteraction;

describe("reply({ withResponse: true })", () => {
    test("reply returns the created message in one request", async () => {
        const { bot, calls } = setup();
        const message = await command(bot).reply({
            content: "hi",
            withResponse: true,
        });
        expect(message).toBeInstanceOf(Message);
        expect(message?.id).toBe(MESSAGE);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.path).toEndWith("?with_response=true");
        // The local-only key never reaches Discord.
        expect(calls[0]!.body.data.withResponse).toBeUndefined();
        expect(calls[0]!.body.data.content).toBe("hi");
    });

    test("without it the old return and URL are kept", async () => {
        const { bot, calls } = setup();
        expect(await command(bot).reply({ content: "hi" })).toBeUndefined();
        expect(calls[0]!.path).not.toContain("with_response");
    });

    test("deferReply, update and deferUpdate support it", async () => {
        const { bot, calls } = setup();
        const deferred = await command(bot).deferReply({
            ephemeral: true,
            withResponse: true,
        });
        expect(deferred).toBeInstanceOf(Message);
        expect(calls[0]!.body.data).toEqual({ flags: 64 });

        const updated = await component(bot).update({
            content: "new",
            withResponse: true,
        });
        expect(updated?.id).toBe(MESSAGE);
        expect(calls[1]!.body.type).toBe(7);

        const deferredUpdate = await component(bot).deferUpdate({
            withResponse: true,
        });
        expect(deferredUpdate).toBeInstanceOf(Message);
        expect(await component(bot).deferUpdate()).toBeUndefined();
        expect(await command(bot).deferReply()).toBeUndefined();
    });

    test("an interaction still acknowledges once", async () => {
        const { bot } = setup();
        const interaction = command(bot);
        await interaction.reply({ content: "one", withResponse: true });
        expect(interaction.replied).toBe(true);
        await expect(interaction.reply({ content: "two" })).rejects.toThrow(
            "already been acknowledged",
        );
    });

    test("a callback without a message resolves to null", async () => {
        const bot = new Client({ token: "a.b", intents: 0 });
        (bot.rest as unknown as Record<string, unknown>).post = async () => ({
            interaction: { id: "1" },
        });
        expect(
            await command(bot).reply({ content: "hi", withResponse: true }),
        ).toBeNull();
    });
});
