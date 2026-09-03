import { describe, expect, test } from "bun:test";
import { ShardManager, ClusterManager } from "../packages/sharding/src/index.ts";

/**
 * Integration coverage for the sharding lifecycle and the auto-scale regression
 * fixed in this branch: resharding/respawning in "auto" mode previously clobbered
 * the `"auto"` sentinel on the options object, which permanently disabled
 * subsequent auto-scale checks.
 */
describe("Sharding integration", () => {
    test("connect() waits spawnDelay between shards (runtime-agnostic sleep)", async () => {
        const mgr = new ShardManager({
            token: "test_token",
            intents: 0,
            shardCount: 2,
            spawnDelay: 20,
        });
        // Avoid real gateway/network by stubbing each shard's connect.
        for (const shard of mgr.shards.values()) {
            (shard as unknown as { connect: () => Promise<void> }).connect =
                async () => {};
        }
        const start = Date.now();
        await mgr.connect();
        // One inter-shard gap of ~20ms should have elapsed.
        expect(Date.now() - start).toBeGreaterThanOrEqual(15);
        mgr.destroy();
        expect(mgr.shardCount).toBe(0);
    });

    test("auto-scale keeps running after a reshard (sentinel not clobbered)", async () => {
        const mgr = new ShardManager({
            token: "test_token",
            intents: 0,
            shardCount: "auto",
        });
        // Avoid network in reshard()->connect().
        (mgr as unknown as { connect: () => Promise<void> }).connect =
            async () => {};
        (
            mgr as unknown as {
                fetchRecommendedShardCount: () => Promise<number>;
            }
        ).fetchRecommendedShardCount = async () => 3;

        // Perform a reshard; pre-fix this overwrote the "auto" option to a number.
        await mgr.reshard(3);

        // A later auto-scale check must still fetch the recommended count.
        let rechecked = false;
        (
            mgr as unknown as {
                fetchRecommendedShardCount: () => Promise<number>;
            }
        ).fetchRecommendedShardCount = async () => {
            rechecked = true;
            return 3;
        };
        await mgr.checkAutoScale();
        expect(rechecked).toBe(true);

        mgr.destroy();
    });

    test("checkAutoScale is a no-op for a fixed shard count", async () => {
        const mgr = new ShardManager({
            token: "test_token",
            intents: 0,
            shardCount: 2,
        });
        let called = false;
        (
            mgr as unknown as {
                fetchRecommendedShardCount: () => Promise<number>;
            }
        ).fetchRecommendedShardCount = async () => {
            called = true;
            return 4;
        };
        await mgr.checkAutoScale();
        expect(called).toBe(false);
        mgr.destroy();
    });

    test("getShardIdForGuild is deterministic and within range", () => {
        const mgr = new ShardManager({
            token: "test_token",
            intents: 0,
            shardCount: 4,
        });
        const guild = "852892297661906993";
        const a = mgr.getShardIdForGuild(guild);
        const b = mgr.getShardIdForGuild(guild);
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(4);
        mgr.destroy();
    });

    test("destroy() is idempotent and connect() (re)initializes the shard set", async () => {
        const mgr = new ShardManager({
            token: "test_token",
            intents: 0,
            shardCount: 2,
        });
        mgr.destroy();
        mgr.destroy(); // second call must not throw
        expect(mgr.shardCount).toBe(0);

        const fresh = new ShardManager({
            token: "test_token",
            intents: 0,
            shardCount: 2,
        });
        for (const shard of fresh.shards.values()) {
            (shard as unknown as { connect: () => Promise<void> }).connect =
                async () => {};
        }
        await fresh.connect();
        expect(fresh.shardCount).toBe(2);
        fresh.destroy();
    });

    test("ClusterManager validates options and only auto-scales in auto mode", () => {
        expect(
            () =>
                new ClusterManager({
                    token: "",
                    script: "./worker.js",
                }),
        ).toThrow(TypeError);
        expect(
            () =>
                new ClusterManager({
                    token: "t",
                    script: "",
                }),
        ).toThrow(TypeError);

        const fixed = new ClusterManager({
            token: "t",
            script: "./worker.js",
            shardCount: 4,
        });
        // Fixed mode: checkAutoScale must short-circuit without fetching.
        let called = false;
        (
            fixed as unknown as {
                fetchRecommendedShardCount: () => Promise<number>;
            }
        ).fetchRecommendedShardCount = async () => {
            called = true;
            return 8;
        };
        return fixed.checkAutoScale().then(() => {
            expect(called).toBe(false);
        });
    });
});
