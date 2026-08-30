import { expect, test } from "bun:test";
import { ChannelManager } from "../packages/managers/src/index.js";

const channelId = "123456789012345680";
const messageId = "123456789012345681";
const message = {
  id: messageId,
  content: "hello",
  author: { id: "123456789012345679", username: "bot" },
  channel_id: channelId,
};

function setup() {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const rest = {
    post: async <T>(path: string, body?: unknown): Promise<T> => {
      calls.push({ method: "POST", path, body });
      return message as T;
    },
    patch: async <T>(path: string, body?: unknown): Promise<T> => {
      calls.push({ method: "PATCH", path, body });
      return message as T;
    },
    delete: async <T>(path: string): Promise<T> => {
      calls.push({ method: "DELETE", path });
      return undefined as T;
    },
  };
  return { channels: new ChannelManager(rest as never), calls };
}

test("message resource methods delegate through ChannelManager", async () => {
  const { channels, calls } = setup();
  const created = await channels.send(channelId, { content: "hello" });

  expect(created.channelId).toBe(channelId);
  expect(created.channel.id).toBe(channelId);
  expect(await created.channel.sendMessage({ content: "again" })).toBeDefined();
  expect(await created.reply("reply")).toBeDefined();
  expect(await created.edit({ content: "edited" })).toBeDefined();
  await created.delete();
  expect(await created.crosspost()).toBeDefined();

  expect(calls.map((call) => call.method)).toEqual([
    "POST",
    "POST",
    "POST",
    "PATCH",
    "DELETE",
    "POST",
  ]);
  expect(calls[1]).toEqual({
    method: "POST",
    path: `/channels/${channelId}/messages`,
    body: { content: "again" },
  });
  expect(calls[2]).toEqual({
    method: "POST",
    path: `/channels/${channelId}/messages`,
    body: {
      content: "reply",
      message_reference: {
        message_id: messageId,
        channel_id: channelId,
        guild_id: undefined,
      },
    },
  });
  expect(calls[3]).toEqual({
    method: "PATCH",
    path: `/channels/${channelId}/messages/${messageId}`,
    body: { content: "edited" },
  });
  expect(calls[4]).toEqual({
    method: "DELETE",
    path: `/channels/${channelId}/messages/${messageId}`,
  });
  expect(calls[5]).toEqual({
    method: "POST",
    path: `/channels/${channelId}/messages/${messageId}/crosspost`,
  });
});

test("detached structures fail clearly instead of bypassing REST", async () => {
  const { Channel, Message } =
    await import("../packages/structures/src/index.js");
  const detachedChannel = new Channel({ id: channelId, type: 0 });
  const detachedMessage = new Message(message);

  expect(() => detachedChannel.sendMessage({ content: "hello" })).toThrow(
    "not attached to a client",
  );
  expect(() => detachedMessage.reply("hello")).toThrow(
    "not attached to a client",
  );
});
