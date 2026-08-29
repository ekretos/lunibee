import { describe, expect, test } from "bun:test";
import { ChannelManager } from "@lunibee/managers";
import { MockREST } from "./rest.js";

describe("ChannelManager integration lifecycle", () => {
    test("send delegates through REST and returns a Message", async () => {
        const rest = new MockREST({ "/channels/123/messages": { id: "456", channel_id: "123", content: "hello" } });
        const manager = new ChannelManager(rest);
        const message = await manager.send("123", { content: "hello" });
        expect(message.id).toBe("456");
        expect(rest.requests).toEqual([{ method: "POST", path: "/channels/123/messages", body: { content: "hello" } }]);
    });

    test("resolve caches a fetched channel", async () => {
        const payload = { id: "123", type: 0, name: "general" };
        const rest = new MockREST({ "/channels/123": payload });
        const manager = new ChannelManager(rest);
        const first = await manager.resolve("123");
        const second = await manager.resolve("123");
        expect(first).toBe(second);
        expect(manager.get("123")).toBe(first);
        expect(rest.requests).toHaveLength(1);
    });
});
