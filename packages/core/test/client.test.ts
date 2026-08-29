import { describe, expect, test } from "bun:test";
import { Client } from "../src/index.js";

describe("Client", () => {
    test("validates construction options", () => {
        expect(() => new Client({ token: "", intents: 0 })).toThrow();
        expect(() => new Client({ token: "token", intents: -1 })).toThrow();
    });

    test("deduplicates concurrent login attempts", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(JSON.stringify({ id: "1", username: "bot" }), { status: 200, headers: { "content-type": "application/json" } });
        const client = new Client({ token: "token", intents: 0, gateway: { reconnect: false } });
        const first = client.login();
        const second = client.login();
        expect(first).toBe(second);
        client.destroy();
        await expect(first).rejects.toThrow();
        globalThis.fetch = originalFetch;
    });

    test("removes listeners", () => {
        const client = new Client({ token: "token", intents: 0 });
        const listener = () => undefined;
        client.on("error", listener);
        expect(client.removeAllListeners()).toBe(client);
    });
});
