import { expect, test } from "bun:test";
import { ChannelManager } from "../packages/managers/src/index.js";

const message = {
  id: "123456789012345678",
  content: "hello",
  author: { id: "123456789012345679", username: "bot" },
  channel_id: "123456789012345680",
};

test("ChannelManager.sendMessage posts a message and returns Message", async () => {
  let method = "";
  let path = "";
  let body: unknown;
  const rest = {
    post: async <T>(requestPath: string, requestBody: unknown): Promise<T> => {
      method = "POST";
      path = requestPath;
      body = requestBody;
      return message as T;
    },
  };

  const channels = new ChannelManager(rest as never);
  const result = await channels.sendMessage(message.channel_id, {
    content: "hello",
  });

  expect(method).toBe("POST");
  expect(path).toBe(`/channels/${message.channel_id}/messages`);
  expect(body).toEqual({ content: "hello" });
  expect(result.id).toBe(message.id);
  expect(result.content).toBe("hello");
  expect(result.channelId).toBe(message.channel_id);
});

test("ChannelManager.sendMessage propagates REST errors", async () => {
  const error = new Error("Discord request failed");
  const rest = {
    post: async () => {
      throw error;
    },
  };
  const channels = new ChannelManager(rest as never);

  await expect(
    channels.sendMessage("123456789012345680", { content: "hello" }),
  ).rejects.toBe(error);
});

test("ChannelManager.sendMessage validates channel IDs through Routes", async () => {
  const rest = { post: async () => message };
  const channels = new ChannelManager(rest as never);

  expect(
    channels.sendMessage("not-a-snowflake", { content: "hello" }),
  ).rejects.toThrow(TypeError);
});
