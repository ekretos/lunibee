import { describe, expect, test } from "bun:test";
import { ShardBus } from "../packages/sharding/src/index.ts";

describe("ShardBus", () => {
  test("routes targeted and broadcast messages between shard buses", async () => {
    const channel = `lunibee-test-${crypto.randomUUID()}`;
    const shard0 = new ShardBus(0, channel);
    const shard1 = new ShardBus(1, channel);
    const received: unknown[] = [];
    shard1.on("target", (message) => received.push(message.data));
    shard1.on("broadcast", (message) => received.push(message.data));
    shard0.send(1, "target", { value: 1 });
    shard0.broadcast("broadcast", { value: 2 });
    await Bun.sleep(10);
    expect(received).toEqual([{ value: 1 }, { value: 2 }]);
    expect(shard0.channelName).toBe(channel);
    shard0.close();
    shard1.close();
  });
});
