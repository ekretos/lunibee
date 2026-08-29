import { describe, expect, test } from "bun:test";
import { ChannelManager } from "@lunibee/managers";
import { MockREST } from "./rest.js";

/** Verifies canonical manager cache identity and shared REST hydration behavior. */
describe("ChannelManager integration lifecycle", () => {
    /** Verifies message creation is routed through REST and cached. */
    test("send delegates through REST and returns a Message", async () => {
        const rest = new MockREST({ "/channels/123/messages": { id: "456", channel_id: "123", content: "hello" } });
        const manager = new ChannelManager(rest);
        const message = await manager.send("123", { content: "hello" });
        expect(message.id).toBe("456");
        expect(await manager.messages("123").resolve("456")).toBe(message);
        expect(rest.requests).toEqual([{ method: "POST", path: "/channels/123/messages", body: { content: "hello" } }]);
    });

    /** Verifies repeated channel resolution returns the same canonical object. */
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

    /** Verifies REST updates preserve the canonical message object identity. */
    test("edit updates the existing canonical message", async () => {
        const rest = new MockREST({
            "/channels/123/messages/456": { id: "456", channel_id: "123", content: "updated" },
        });
        const manager = new ChannelManager(rest);
        const existing = manager.messages("123").upsert({ id: "456", channel_id: "123", content: "original" });
        const updated = await manager.editMessage("123", "456", { content: "updated" });
        expect(updated).toBe(existing);
        expect(existing.content).toBe("updated");
    });

    /** Verifies deletion removes the canonical cache entry after REST succeeds. */
    test("delete removes the canonical message", async () => {
        const rest = new MockREST({ "/channels/123/messages/456": null });
        const manager = new ChannelManager(rest);
        manager.messages("123").upsert({ id: "456", channel_id: "123", content: "original" });
        await manager.deleteMessage("123", "456");
        expect(manager.messages("123").cache.has("456")).toBe(false);
    });
});
