import { describe, expect, test } from "bun:test";
import { ShardBus } from "../packages/sharding/src/index.ts";

describe("ShardBus", () => {
    test("routes targeted and broadcast messages between shard buses", async () => {
        const shard0 = new ShardBus(0, `lunibee-test-${crypto.randomUUID()}`);
        const shard1 = new ShardBus(1, shard0Channel(shard0));
        const received: unknown[] = [];
        shard1.on("target", message => received.push(message.data));
        shard1.on("broadcast", message => received.push(message.data));

        shard0.send(1, "target", { value: 1 });
        shard0.broadcast("broadcast", { value: 2 });
        await Bun.sleep(10);

        expect(received).toEqual([{ value: 1 }, { value: 2 }]);
        shard0.close();
        shard1.close();
    });
});

function shard0Channel(bus: ShardBus): string {
    return (bus as unknown as { __unused?: string }).__unused ?? "lunibee-test";
}
