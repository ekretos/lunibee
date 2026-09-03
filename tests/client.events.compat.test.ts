import { describe, expect, test } from "bun:test";
import {
    Client,
    ClientEvent,
    Collector,
    type ClientEventName,
} from "../packages/core/src/index.ts";

/**
 * Discord.js compatibility surface for the Lunibee Client.
 *
 * These tests pin the client-facing API that Discord.js developers expect —
 * event names, the `token` getter, Node-style emitter aliases, the Collector
 * primitive, and the interaction acknowledgement methods — while preserving
 * Lunibee's own naming and architecture (no renames).
 */
describe("Client — Discord.js-familiar event names", () => {
    // Compile-time: every name below must be a valid ClientEvents key, and the
    // ClientEvent enum must carry the same string value.
    const familiarEvents: Record<string, ClientEventName> = {
        ready: "ready",
        error: "error",
        warn: "warn" as ClientEventName, // documented gap — see note below
        debug: "debug" as ClientEventName, // documented gap — see note below
        messageCreate: "messageCreate",
        messageUpdate: "messageUpdate",
        messageDelete: "messageDelete",
        interactionCreate: "interactionCreate",
        guildCreate: "guildCreate",
        guildUpdate: "guildUpdate",
        guildDelete: "guildDelete",
        guildAvailable: "guildAvailable",
        guildUnavailable: "guildUnavailable",
    };

    test("core Discord.js event names exist in the ClientEvent enum", () => {
        const enumValues = new Set<string>(Object.values(ClientEvent));
        for (const name of [
            "ready",
            "error",
            "messageCreate",
            "messageUpdate",
            "messageDelete",
            "interactionCreate",
            "guildCreate",
            "guildUpdate",
            "guildDelete",
            "guildAvailable",
            "guildUnavailable",
        ]) {
            expect(enumValues.has(name)).toBe(true);
        }
        // `warn` and `debug` are NOT emitted by Lunibee's client yet — asserted
        // absent so the gap is tracked rather than silently assumed.
        expect(enumValues.has("warn")).toBe(false);
        expect(enumValues.has("debug")).toBe(false);
        expect(familiarEvents.ready).toBe("ready");
    });

    test("client.on() accepts the familiar event names and dispatches them", () => {
        const client = new Client({ token: "test-token", intents: 513 });
        const seen: string[] = [];
        client.on(ClientEvent.Ready, () => seen.push("ready"));
        client.on("messageCreate", () => seen.push("messageCreate"));
        client.on("interactionCreate", () => seen.push("interactionCreate"));

        const gw = client.ws;
        gw.emit("READY", { user: { id: "1", username: "Bot" } });
        gw.emit("MESSAGE_CREATE", {
            id: "2",
            channel_id: "3",
            content: "hi",
            author: { id: "4", username: "U" },
        });
        gw.emit("INTERACTION_CREATE", {
            id: "5",
            application_id: "6",
            type: 2,
            token: "tok",
            version: 1,
            data: { id: "cmd", name: "test" },
        });

        expect(seen).toEqual(["ready", "messageCreate", "interactionCreate"]);
        client.destroy();
    });
});

describe("Client — guildCreate vs. guildAvailable", () => {
    test("first sighting emits guildCreate, re-availability emits guildAvailable", () => {
        const client = new Client({ token: "test-token", intents: 1 });
        const events: string[] = [];
        client.on("guildCreate", () => events.push("guildCreate"));
        client.on("guildAvailable", () => events.push("guildAvailable"));

        const gw = client.ws;
        const payload = { id: "500", name: "Guild" };
        gw.emit("GUILD_CREATE", payload); // not cached -> guildCreate
        gw.emit("GUILD_CREATE", payload); // already cached -> guildAvailable

        expect(events).toEqual(["guildCreate", "guildAvailable"]);
        client.destroy();
    });
});

describe("Client — Discord.js-familiar accessors & emitter aliases", () => {
    test("exposes client.token and nulls it after destroy", () => {
        const client = new Client({ token: "secret-token", intents: 1 });
        expect(client.token).toBe("secret-token");
        client.destroy();
        expect(client.token).toBeNull();
    });

    test("removeListener is an alias of off", () => {
        const client = new Client({ token: "test-token", intents: 1 });
        let count = 0;
        const listener = () => {
            count++;
        };
        client.on("open", listener);
        client.ws.emit("open");
        client.removeListener("open", listener);
        client.ws.emit("open");
        expect(count).toBe(1);
        client.destroy();
    });
});

describe("Collector — Discord.js-familiar collection primitive", () => {
    test("is exported from the public API and collects up to max", async () => {
        const collector = new Collector<string, number>({ max: 2 });
        const ended: unknown[] = [];
        collector.on("end", (collected: Map<string, number>, reason: string) => {
            ended.push([collected.size, reason]);
        });
        await collector.handle("a", 1);
        await collector.handle("b", 2);
        expect(collector.ended).toBe(true);
        expect(collector.collected.size).toBe(2);
        expect(ended).toEqual([[2, "limit"]]);
    });

    test("respects a filter predicate", async () => {
        const collector = new Collector<string, number>({
            filter: (n) => n % 2 === 0,
        });
        await collector.handle("a", 1);
        await collector.handle("b", 2);
        expect(collector.collected.size).toBe(1);
        expect([...collector.collected.values()]).toEqual([2]);
        collector.stop();
    });
});

describe("Interaction — Discord.js acknowledgement methods", () => {
    test("interactionCreate yields an interaction exposing reply/defer/etc.", () => {
        const client = new Client({ token: "test-token", intents: 1 });
        let interaction: any;
        client.on("interactionCreate", (i) => {
            interaction = i;
        });
        client.ws.emit("INTERACTION_CREATE", {
            id: "800",
            application_id: "900",
            type: 2,
            token: "tok",
            version: 1,
            data: { id: "cmd", name: "test" },
        });
        expect(interaction).toBeDefined();
        for (const method of [
            "reply",
            "deferReply",
            "editReply",
            "deleteReply",
            "followUp",
            "showModal",
        ]) {
            expect(typeof interaction[method]).toBe("function");
        }
        client.destroy();
    });
});
