import { describe, expect, test } from "bun:test";
import { ShardManager } from "../packages/sharding/src/index.ts";

describe("Sharding Full Coverage", () => {
  test("ShardManager creates and calculates shards", () => {
    const mgr = new ShardManager({
      token: "test_token",
      intents: 513,
      shardCount: 2,
    });

    expect(mgr.shardCount).toBe(2);
    expect(mgr.shards.size).toBe(2);
    expect(mgr.get(0)).toBeDefined();
    expect(mgr.get(1)).toBeDefined();
    expect(mgr.getShardIdForGuild("123456789012345678")).toBeDefined();

    mgr.destroy();
    expect(mgr.shardCount).toBe(0);
  });
});
