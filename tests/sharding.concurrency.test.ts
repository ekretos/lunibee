import { afterEach, describe, expect, test } from "bun:test";
import { ShardManager } from "../packages/sharding/src/index.ts";
import { Gateway } from "../packages/ws/src/index.ts";

const originalFetch = globalThis.fetch;
const originalConnect = Gateway.prototype.connect;
afterEach(() => {
    globalThis.fetch = originalFetch;
    Gateway.prototype.connect = originalConnect;
});

const gatewayBot = (body: unknown) => {
    globalThis.fetch = (async () =>
        new Response(JSON.stringify(body), { status: 200 })) as never;
};

describe("ShardManager startup pacing", () => {
    test("starts max_concurrency shards per round", async () => {
        gatewayBot({
            shards: 4,
            session_start_limit: {
                total: 1000,
                remaining: 999,
                reset_after: 1000,
                max_concurrency: 2,
            },
        });
        let active = 0;
        let peak = 0;
        let calls = 0;
        Gateway.prototype.connect = async function () {
            calls++;
            peak = Math.max(peak, ++active);
            await new Promise((r) => setTimeout(r, 2));
            active--;
        };
        const manager = new ShardManager({
            token: "t",
            intents: 0,
            shardCount: "auto",
            spawnDelay: 5,
        });
        await manager.connect();
        expect(calls).toBe(4);
        expect(peak).toBe(2);
        expect(manager.health()).toHaveLength(4);
        expect(manager.health()[0]).toMatchObject({ id: 0, ping: -1 });
        manager.destroy();
    });

    test("refuses to start past the session start limit", async () => {
        gatewayBot({
            shards: 3,
            session_start_limit: {
                total: 1000,
                remaining: 2,
                reset_after: 60_500,
                max_concurrency: 1,
            },
        });
        const manager = new ShardManager({
            token: "t",
            intents: 0,
            shardCount: "auto",
        });
        await expect(manager.connect()).rejects.toThrow(
            "2 of 1000 IDENTIFYs left for 3 shards; resets in 61s",
        );
        expect(manager.shardCount).toBe(0);
    });

    test("reports the failing shard of a round", async () => {
        Gateway.prototype.connect = async function () {
            throw new Error("nope");
        };
        const manager = new ShardManager({
            token: "t",
            intents: 0,
            shardCount: 2,
            maxConcurrency: 2,
        });
        await expect(manager.connect()).rejects.toThrow(
            "Failed to connect shard 0.",
        );
    });

    test("validates maxConcurrency and tolerates a missing start limit", async () => {
        expect(
            () =>
                new ShardManager({ token: "t", intents: 0, maxConcurrency: 0 }),
        ).toThrow(RangeError);
        gatewayBot({ shards: 1 });
        const manager = new ShardManager({
            token: "t",
            intents: 0,
            shardCount: "auto",
        });
        expect(await manager.fetchGatewayInfo()).toEqual({ shards: 1 });
    });
});
