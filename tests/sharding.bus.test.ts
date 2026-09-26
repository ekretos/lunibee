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

    test("request/respond and broadcastRequest collect replies", async () => {
        const channel = `lunibee-test-${crypto.randomUUID()}`;
        const [a, b, c] = [0, 1, 2].map((id) => new ShardBus(id, channel));
        b!.respond<number, number>("double", (n) => n * 2);
        c!.respond<number, number>("double", async (n) => n * 3);
        b!.respond("fail", () => {
            throw new Error("nope");
        });
        expect(await a!.request<number>(1, "double", 4)).toBe(8);
        await expect(a!.request(1, "fail", null)).rejects.toThrow("nope");
        await expect(a!.request(2, "missing", null, 30)).rejects.toThrow(
            /did not reply/,
        );
        const replies = await a!.broadcastRequest<number>("double", 5, {
            expected: 2,
        });
        expect(replies.map((r) => [r.shardId, r.result]).sort()).toEqual([
            [1, 10],
            [2, 15],
        ]);
        const partial = await a!.broadcastRequest("fail", null, {
            timeoutMs: 30,
        });
        expect(partial).toEqual([{ shardId: 1, error: "nope" }]);
        // Plain sends to a responder type are ignored (no reply expected).
        a!.send(1, "double", 1);
        await Bun.sleep(10);
        for (const bus of [a, b, c]) bus!.close();
    });
});
