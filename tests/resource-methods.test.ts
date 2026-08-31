import { expect, test } from "bun:test";
import { ChannelManager } from "../packages/managers/src/index.js";

const channelId = "123456789012345680";
const messageId = "123456789012345681";
const message = {
  id: messageId,
  type: 0,
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
    get: async <T>(path: string): Promise<T> => {
      calls.push({ method: "GET", path });
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
    put: async <T>(path: string, body?: unknown): Promise<T> => {
      calls.push({ method: "PUT", path, body });
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
  expect(await created.update({ content: "updated" })).toBeDefined();
  await created.delete();
  expect(await created.crosspost()).toBeDefined();

  await created.react("👍");
  await created.removeReaction("👍");
  await created.removeReaction("👍", "999");
  await created.removeAllReactions();
  await created.pin();
  await created.unpin();

  await created.channel.edit({ name: "edited channel" });
  await created.channel.delete();

  await channels.updateChannel(channelId, { name: "test" });
  await channels.create("123456789012345679", { name: "test2", type: 0 });
  await channels.resolve(channelId);

  expect(calls.length).toBeGreaterThan(10);
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
