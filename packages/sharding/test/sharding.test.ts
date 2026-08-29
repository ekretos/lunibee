import { describe, expect, test } from "bun:test";
import { ShardManager } from "../src/index.js";

describe("ShardManager", () => {
    test("validates shard configuration", () => {
        expect(() => new ShardManager({ token: "", intents: 0 })).toThrow();
        expect(() => new ShardManager({ token: "token", intents: 0, shardCount: 0 })).toThrow();
        expect(() => new ShardManager({ token: "token", intents: 0, shardCount: 2, identifyConcurrency: 0 })).toThrow();
    });

    test("creates the configured shard set", () => {
        const manager = new ShardManager({ token: "token", intents: 0, shardCount: 3 });
        expect(manager.shards.size).toBe(3);
        expect(manager.readyCount).toBe(0);
        manager.destroy();
    });
});
