import { expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import { ActivityEnum } from "../packages/types/src/index.ts";

function setup() {
    const bot = new Client({ token: "a.b", intents: 0 });
    const sent: unknown[] = [];
    bot.setPresence = ((data: unknown) => {
        sent.push(data);
        return true;
    }) as never;
    return { bot, sent };
}

test("setActivity plays by default and stays online", () => {
    const { bot, sent } = setup();
    expect(bot.setActivity("chess")).toBe(true);
    expect(sent[0]).toEqual({
        status: "online",
        activities: [{ name: "chess", type: ActivityEnum.Playing }],
    });
});

test("setActivity takes a type, url, state and status", () => {
    const { bot, sent } = setup();
    bot.setActivity("the logs", {
        type: ActivityEnum.Watching,
        status: "idle",
    });
    bot.setActivity("live", {
        type: ActivityEnum.Streaming,
        url: "https://twitch.tv/x",
        state: "playing",
    });
    expect(sent[0]).toMatchObject({
        status: "idle",
        activities: [{ name: "the logs", type: ActivityEnum.Watching }],
    });
    expect(sent[1]).toMatchObject({
        activities: [
            { name: "live", url: "https://twitch.tv/x", state: "playing" },
        ],
    });
});

test("a custom status shows its state, defaulting to the name", () => {
    const { bot, sent } = setup();
    bot.setActivity("Running on Bun", { type: ActivityEnum.Custom });
    expect(sent[0]).toMatchObject({
        activities: [{ type: ActivityEnum.Custom, state: "Running on Bun" }],
    });
});

test("null clears the activity", () => {
    const { bot, sent } = setup();
    bot.setActivity(null, { status: "dnd" });
    expect(sent[0]).toEqual({ status: "dnd", activities: [] });
});
