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

    test("reports sync and async handler errors to error listeners", async () => {
        const channel = `lunibee-test-${crypto.randomUUID()}`;
        const shard0 = new ShardBus(0, channel);
        const shard1 = new ShardBus(1, channel);
        const errors: [unknown, string][] = [];
        const received: unknown[] = [];
        shard1.onError(() => {
            throw new Error("listener failure is isolated");
        });
        shard1.onError((error, message) => errors.push([error, message.type]));
        shard1.on("sync", () => {
            throw new Error("sync");
        });
        shard1.on("async", async () => {
            throw new Error("async");
        });
        shard1.on("sync", (message) => received.push(message.data));
        shard0.broadcast("sync", 1);
        shard0.broadcast("async", 2);
        await Bun.sleep(10);
        expect(
            errors.map(([error, type]) => [(error as Error).message, type]),
        ).toEqual([
            ["sync", "sync"],
            ["async", "async"],
        ]);
        expect(received).toEqual([1]);
        shard0.close();
        shard1.close();
    });
});
