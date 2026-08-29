import { expect, test } from "bun:test";
import { ChannelManager } from "../packages/managers/src/index.js";

const channelId = "123456789012345680";
const messageId = "123456789012345681";
const userId = "123456789012345682";
const message = {
    id: messageId,
    content: "hello",
    author: { id: userId, username: "bot" },
    channel_id: channelId,
};

function manager() {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const rest = {
        get: async <T>(path: string): Promise<T> => {
            calls.push({ method: "GET", path });
            return (path.includes("/reactions/") ? [{ id: userId, username: "user" }] : [message]) as T;
        },
        post: async <T>(path: string, body?: unknown): Promise<T> => {
            calls.push({ method: "POST", path, body });
            return (path.endsWith("/messages") || path.includes("/crosspost") ? message : undefined) as T;
        },
        patch: async <T>(path: string, body?: unknown): Promise<T> => {
            calls.push({ method: "PATCH", path, body });
            return message as T;
        },
        put: async <T>(path: string): Promise<T> => {
            calls.push({ method: "PUT", path });
            return undefined as T;
        },
        delete: async <T>(path: string): Promise<T> => {
            calls.push({ method: "DELETE", path });
            return undefined as T;
        },
    };
    return { channels: new ChannelManager(rest as never), calls };
}

test("send posts a message", async () => {
    const { channels, calls } = manager();
    const result = await channels.send(channelId, { content: "hello" });
    expect(calls[0]).toEqual({ method: "POST", path: `/channels/${channelId}/messages`, body: { content: "hello" } });
    expect(result.id).toBe(messageId);
});

test("fetches messages with query parameters", async () => {
    const { channels, calls } = manager();
    await channels.fetchMessages(channelId, { before: messageId, limit: 50 });
    expect(calls[0]?.path).toBe(`/channels/${channelId}/messages?before=${messageId}&limit=50`);
});

test("fetches, edits, and deletes a message", async () => {
    const { channels, calls } = manager();
    await channels.fetchMessage(channelId, messageId);
    await channels.editMessage(channelId, messageId, { content: "edited" });
    await channels.deleteMessage(channelId, messageId);
    expect(calls.map(call => call.method)).toEqual(["GET", "PATCH", "DELETE"]);
    expect(calls[1]).toEqual({ method: "PATCH", path: `/channels/${channelId}/messages/${messageId}`, body: { content: "edited" } });
});

test("supports crosspost and bulk delete", async () => {
    const { channels, calls } = manager();
    await channels.crosspostMessage(channelId, messageId);
    await channels.bulkDeleteMessages(channelId, [messageId, "123456789012345683"]);
    expect(calls[0]?.path).toBe(`/channels/${channelId}/messages/${messageId}/crosspost`);
    expect(calls[1]?.path).toBe(`/channels/${channelId}/messages/bulk-delete`);
    expect(calls[1]?.body).toEqual({ messages: [messageId, "123456789012345683"] });
});

test("supports reaction endpoints", async () => {
    const { channels, calls } = manager();
    await channels.addReaction(channelId, messageId, "👍");
    await channels.fetchReactions(channelId, messageId, "👍", { limit: 25 });
    await channels.removeOwnReaction(channelId, messageId, "👍");
    await channels.removeReaction(channelId, messageId, "👍", userId);
    await channels.removeAllReactions(channelId, messageId);
    expect(calls.map(call => call.method)).toEqual(["PUT", "GET", "DELETE", "DELETE", "DELETE"]);
    expect(calls[0]?.path).toContain("/reactions/");
    expect(calls[2]?.path).toContain("/@me");
});

test("supports pins and message threads", async () => {
    const { channels, calls } = manager();
    await channels.fetchPinnedMessages(channelId);
    await channels.pinMessage(channelId, messageId);
    await channels.unpinMessage(channelId, messageId);
    await channels.createThreadFromMessage(channelId, messageId, { name: "discussion" });
    expect(calls[0]?.path).toBe(`/channels/${channelId}/pins`);
    expect(calls[1]?.path).toBe(`/channels/${channelId}/messages/${messageId}/pins`);
    expect(calls[2]?.path).toBe(`/channels/${channelId}/messages/${messageId}/pins`);
    expect(calls[3]?.path).toBe(`/channels/${channelId}/messages/${messageId}/threads`);
});

test("message routes preserve existing snowflake validation", async () => {
    const { channels } = manager();
    await expect(channels.fetchMessage("invalid", messageId)).rejects.toThrow(TypeError);
    await expect(channels.fetchMessage(channelId, "invalid")).rejects.toThrow(TypeError);
});
