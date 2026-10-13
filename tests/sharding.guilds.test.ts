import { afterEach, describe, expect, test } from "bun:test";
import {
    ClusterManager,
    MAX_GUILDS_PER_SHARD,
    ShardManager,
    fetchGuildCount,
    shardsForGuilds,
} from "../packages/sharding/src/index.ts";
import { fakeFork } from "./helpers/fake-cluster.ts";

const original = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = original;
});

/** Answers /gateway/bot and /applications/@me. */
function discord(
    opts: {
        recommended?: number;
        guilds?: number | null;
        status?: number;
    } = {},
) {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
        calls.push(String(url));
        if (String(url).endsWith("/applications/@me"))
            return new Response(
                JSON.stringify(
                    opts.guilds === null
                        ? {}
                        : { approximate_guild_count: opts.guilds ?? 0 },
                ),
                { status: opts.status ?? 200 },
            );
        return new Response(JSON.stringify({ shards: opts.recommended ?? 1 }), {
            status: 200,
        });
    }) as never;
    return calls;
}

describe("shardsForGuilds", () => {
    test("rounds up, never below one, never above Discord's limit per shard", () => {
        expect(shardsForGuilds(0, 1000)).toBe(1);
        expect(shardsForGuilds(1000, 1000)).toBe(1);
        expect(shardsForGuilds(1001, 1000)).toBe(2);
        expect(shardsForGuilds(7300, 1000)).toBe(8);
        expect(shardsForGuilds(5000, 2500)).toBe(2);
        expect(MAX_GUILDS_PER_SHARD).toBe(2500);
        for (const bad of [0, -1, 1.5, 2501, NaN])
            expect(() => shardsForGuilds(10, bad)).toThrow(RangeError);
        expect(() => shardsForGuilds(-1, 1000)).toThrow(RangeError);
        expect(() => shardsForGuilds(1.5, 1000)).toThrow(RangeError);
    });

    test("fetchGuildCount reads the application's guild count", async () => {
        discord({ guilds: 4321 });
        expect(await fetchGuildCount("t")).toBe(4321);
        discord({ guilds: 1, status: 401 });
        await expect(fetchGuildCount("t")).rejects.toThrow("status 401");
        discord({ guilds: null });
        await expect(fetchGuildCount("t")).rejects.toThrow(/guild count/);
    });
});

describe("ClusterManager guildsPerShard", () => {
    const make = (options: object) => {
        const forked = fakeFork();
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: "auto",
            clusterCount: 2,
            spawnInterval: 0,
            fork: forked.fork,
            ...options,
        });
        return { manager, ...forked };
    };

    test("sizes the deployment from the guild count Discord reports", async () => {
        const calls = discord({ recommended: 2, guilds: 7300 });
        const { manager, children } = make({ guildsPerShard: 1000 });
        await manager.spawn();
        expect(manager.shardCount).toBe(8);
        expect(children.map((c) => c.env.SHARD_COUNT)).toEqual(["8", "8"]);
        expect(calls.some((c) => c.endsWith("/applications/@me"))).toBe(true);
        await manager.shutdownAll();
    });

    test("an explicit guildCount needs no extra request, and shardsPerCluster follows", async () => {
        const calls = discord({ recommended: 1 });
        const { manager, children } = make({
            guildsPerShard: 500,
            guildCount: 3000,
            clusterCount: undefined,
            shardsPerCluster: 3,
        });
        await manager.spawn();
        expect(manager.shardCount).toBe(6);
        expect(children).toHaveLength(2);
        expect(children.map((c) => c.env.SHARD_LIST)).toEqual([
            "0,2,4",
            "1,3,5",
        ]);
        expect(calls.every((c) => !c.endsWith("/applications/@me"))).toBe(true);
        await manager.shutdownAll();
    });

    test("without guildsPerShard Discord's recommendation is used, and auto-scaling follows the guild count", async () => {
        discord({ recommended: 3 });
        const plain = make({});
        await plain.manager.spawn();
        expect(plain.manager.shardCount).toBe(3);
        await plain.manager.shutdownAll();

        discord({ recommended: 1, guilds: 2000 });
        const { manager } = make({ guildsPerShard: 1000 });
        await manager.spawn();
        expect(manager.shardCount).toBe(2);
        discord({ recommended: 1, guilds: 2500 });
        await manager.checkAutoScale();
        expect(manager.shardCount).toBe(3);
        await manager.shutdownAll();
    });

    test("validates the options", async () => {
        const options = { token: "t", script: "w.js" };
        expect(
            () =>
                new ClusterManager({
                    ...options,
                    shardCount: "auto",
                    guildsPerShard: 0,
                }),
        ).toThrow(RangeError);
        expect(
            () =>
                new ClusterManager({
                    ...options,
                    shardCount: "auto",
                    guildsPerShard: 3000,
                }),
        ).toThrow(RangeError);
        expect(
            () =>
                new ClusterManager({
                    ...options,
                    shardCount: 4,
                    guildsPerShard: 1000,
                }),
        ).toThrow(/needs shardCount: "auto"/);
        discord({ guilds: 1, status: 403 });
        const { manager } = make({ guildsPerShard: 1000 });
        await expect(manager.spawn()).rejects.toThrow("status 403");
    });
});

describe("ShardManager guildsPerShard", () => {
    test("recommends from the guild count", async () => {
        discord({ recommended: 1, guilds: 5200 });
        const manager = new ShardManager({
            token: "t",
            intents: [],
            cluster: false,
            shardCount: "auto",
            guildsPerShard: 1000,
        });
        expect(await manager.fetchRecommendedShardCount()).toBe(6);
        const fixed = new ShardManager({
            token: "t",
            intents: [],
            cluster: false,
            shardCount: "auto",
            guildsPerShard: 1000,
            guildCount: 100,
        });
        expect(await fixed.fetchRecommendedShardCount()).toBe(1);
    });

    test("validates the options", () => {
        const base = { token: "t", intents: [], cluster: false } as const;
        expect(
            () =>
                new ShardManager({
                    ...base,
                    shardCount: "auto",
                    guildsPerShard: 9999,
                }),
        ).toThrow(RangeError);
        expect(
            () =>
                new ShardManager({
                    ...base,
                    shardCount: 2,
                    guildsPerShard: 1000,
                }),
        ).toThrow(/needs shardCount: "auto"/);
    });
});
