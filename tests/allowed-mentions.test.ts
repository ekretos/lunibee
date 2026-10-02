import { describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import { createInteraction } from "../packages/structures/src/index.ts";

const CHANNEL = "200000000000000001";
const MESSAGE = "200000000000000002";
const USER = "200000000000000003";

type Mentions = { allowed_mentions?: { parse?: string[] } };
type Call = {
    method: string;
    path: string;
    body: Mentions & { body?: Mentions; data?: Mentions };
};

function client(allowedMentions?: {
    parse?: ("users" | "roles" | "everyone")[];
}) {
    const bot = new Client({ token: "a.b", intents: 0, allowedMentions });
    const calls: Call[] = [];
    const reply =
        (method: string) => async (path: string, body: Call["body"]) => {
            calls.push({ method, path, body });
            return {
                id: MESSAGE,
                channel_id: CHANNEL,
                author: { id: USER, username: "bot" },
                content: "",
            };
        };
    bot.rest.post = reply("POST") as typeof bot.rest.post;
    bot.rest.patch = reply("PATCH") as typeof bot.rest.patch;
    bot.gateway.emit("READY", {
        v: 10,
        user: { id: USER, username: "bot", bot: true },
        guilds: [],
        session_id: "s",
        application: { id: USER },
    });
    return { bot, calls };
}

const interaction = (bot: Client) =>
    createInteraction(bot, {
        id: "1",
        application_id: USER,
        token: "tok",
        type: 2,
        data: { name: "ping" },
    });

describe("client-wide default allowed_mentions", () => {
    test("channel send and edit get the default", async () => {
        const { bot, calls } = client({ parse: [] });
        await bot.channels.send(CHANNEL, { content: "@everyone" });
        await bot.channels.editMessage(CHANNEL, MESSAGE, { content: "edited" });
        expect(calls[0]!.body.allowed_mentions).toEqual({ parse: [] });
        expect(calls[1]!.body.allowed_mentions).toEqual({ parse: [] });
    });

    test("a message's own allowed_mentions wins", async () => {
        const { bot, calls } = client({ parse: [] });
        await bot.channels.send(CHANNEL, {
            content: "hi",
            allowed_mentions: { parse: ["users"] },
        });
        expect(calls[0]!.body.allowed_mentions).toEqual({ parse: ["users"] });
    });

    test("uploads keep the default in the JSON part", async () => {
        const { bot, calls } = client({ parse: [] });
        await bot.channels.send(CHANNEL, {
            content: "file",
            files: [{ name: "a.txt", data: "a" }],
        });
        expect(calls[0]!.body.body?.allowed_mentions).toEqual({ parse: [] });
    });

    test("interaction replies, edits and follow-ups get it; deferrals and modals do not", async () => {
        const { bot, calls } = client({ parse: [] });
        await interaction(bot).reply({ content: "hi" });
        expect(calls.at(-1)!.body.data?.allowed_mentions).toEqual({
            parse: [],
        });

        const deferred = interaction(bot);
        await deferred.deferReply();
        expect(calls.at(-1)!.body.data?.allowed_mentions).toBeUndefined();
        await deferred.editReply({ content: "done" });
        expect(calls.at(-1)!.body.allowed_mentions).toEqual({ parse: [] });
        await deferred.followUp({ content: "more" });
        expect(calls.at(-1)!.body.allowed_mentions).toEqual({ parse: [] });

        await interaction(bot).showModal({
            custom_id: "m",
            title: "T",
            components: [],
        } as never);
        expect(calls.at(-1)!.body.data?.allowed_mentions).toBeUndefined();
    });

    test("without the option nothing is added", async () => {
        const { bot, calls } = client();
        await bot.channels.send(CHANNEL, { content: "hi" });
        await interaction(bot).reply({ content: "hi" });
        expect(calls[0]!.body.allowed_mentions).toBeUndefined();
        expect(calls[1]!.body.data?.allowed_mentions).toBeUndefined();
    });
});
