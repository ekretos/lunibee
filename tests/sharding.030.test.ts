import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";
import {
    ShardManager,
    fetchGatewayBot,
} from "../packages/sharding/src/index.ts";
import { Gateway } from "../packages/ws/src/index.ts";
import { FakeWebSocket, installWebSocket } from "./helpers/fake-websocket.ts";

const originalFetch = globalThis.fetch;
const originalConnect = Gateway.prototype.connect;
afterEach(() => {
    globalThis.fetch = originalFetch;
    Gateway.prototype.connect = originalConnect;
});

const gatewayBot = (body: unknown, status = 200) => {
    globalThis.fetch = (async () =>
        new Response(JSON.stringify(body), { status })) as never;
};

describe("fetchGatewayBot", () => {
    test("reads shards and the start limit", async () => {
        gatewayBot({
            shards: 9,
            session_start_limit: {
                total: 1000,
                remaining: 990,
                reset_after: 5,
                max_concurrency: 16,
            },
        });
        expect(await fetchGatewayBot("t")).toEqual({
            shards: 9,
            sessionStartLimit: {
                total: 1000,
                remaining: 990,
                resetAfter: 5,
                maxConcurrency: 16,
            },
        });
        gatewayBot({ shards: 2 });
        expect(await fetchGatewayBot("t")).toEqual({ shards: 2 });
    });

    test("rejects a failed or malformed answer", async () => {
        gatewayBot({}, 401);
        await expect(fetchGatewayBot("t")).rejects.toThrow(/status 401/);
        gatewayBot({ shards: 0 });
        await expect(fetchGatewayBot("t")).rejects.toThrow(
            /invalid shard count/,
        );
    });
});

describe("ShardManager buckets, events and shard ids", () => {
    test("each round starts one shard per IDENTIFY bucket (shard_id % max_concurrency)", async () => {
        const order: number[] = [];
        Gateway.prototype.connect = async function () {
            order.push(Date.now());
        };
        gatewayBot({
            shards: 6,
            session_start_limit: {
                total: 1000,
                remaining: 999,
                reset_after: 1,
                max_concurrency: 3,
            },
        });
        const manager = new ShardManager({
            token: "t",
            intents: 0,
            shardCount: "auto",
            spawnDelay: 20,
            handshakeTimeout: 1,
        });
        await manager.connect();
        // 6 shards, 3 buckets: two rounds of three, 20 ms apart.
        expect(order).toHaveLength(6);
        expect(order[3]! - order[2]!).toBeGreaterThanOrEqual(15);
        expect(order[2]! - order[0]!).toBeLessThan(15);
        manager.destroy();
    });

    test("only shards without a live socket join the buckets, grouped by key", async () => {
        gatewayBot({
            shards: 6,
            session_start_limit: {
                total: 1000,
                remaining: 999,
                reset_after: 1,
                max_concurrency: 2,
            },
        });
        const started: number[] = [];
        const manager = new ShardManager({
            token: "t",
            intents: 0,
            shardCount: "auto",
            spawnDelay: 1,
            handshakeTimeout: 1,
        });
        await manager.fetchGatewayInfo();
        Gateway.prototype.connect = async function () {
            for (const [id, gateway] of manager.shards)
                if (gateway === this) started.push(id);
        };
        await manager.connect();
        expect(started.sort()).toEqual([0, 1, 2, 3, 4, 5]);
        // Odd and even ids are different keys: shard 0 and 1 start together.
        expect(started.slice(0, 2)).toEqual([0, 1]);
        manager.destroy();
    });

    test("aggregates shard events and keeps the shard count while resharding", () => {
        const manager = new ShardManager({
            token: "t",
            intents: 0,
            shardCount: 4,
        });
        const log: string[] = [];
        const ready = (id: number) => log.push(`ready:${id}`);
        manager.on("shardReady", ready);
        manager.on("shardResume", (id) => log.push(`resume:${id}`));
        manager.on("shardDisconnect", (id, close) =>
            log.push(`close:${id}:${close.code}`),
        );
        manager.on("shardError", (id, error) =>
            log.push(`error:${id}:${error.message}`),
        );
        manager.on("shardUnstable", (id, info) =>
            log.push(`unstable:${id}:${info.reconnects}`),
        );
        manager.on("shardReady", () => {
            throw new Error("listener failures are isolated");
        });
        const shard = manager.get(2)!;
        shard.emit("ready", {});
        shard.emit("resumed", {});
        shard.emit("close", { code: 1006, action: "resume" });
        shard.emit("error", new Error("boom"));
        shard.emit("unstable", { reconnects: 6, delay: 100 });
        manager.off("shardReady", ready);
        shard.emit("ready", {});
        expect(log).toEqual([
            "ready:2",
            "resume:2",
            "close:2:1006",
            "error:2:boom",
            "unstable:2:6",
        ]);

        // 4 shards: the shard of this guild is the same before and during a reshard.
        const guild = "175928847299117063";
        const before = manager.getShardIdForGuild(guild);
        manager.destroy();
        expect(manager.shardCount).toBe(0);
        expect(manager.getShardIdForGuild(guild)).toBe(before);
    });
});

describe("Client compress option", () => {
    const original = globalThis.WebSocket;
    afterEach(() => {
        globalThis.WebSocket = original;
    });

    const urlFor = async (options: Record<string, unknown>) => {
        FakeWebSocket.instances = [];
        installWebSocket(FakeWebSocket);
        const client = new Client({ token: "a.b", intents: 0, ...options });
        const promise = client.gateway.connect();
        FakeWebSocket.instances[0]!.open();
        await promise;
        client.gateway.close();
        return FakeWebSocket.instances[0]!.url;
    };

    test("is shorthand for gateway.compress, which wins when set", async () => {
        expect(await urlFor({})).not.toContain("compress");
        expect(await urlFor({ compress: true })).toContain(
            "compress=zlib-stream",
        );
        expect(
            await urlFor({ compress: true, gateway: { compress: false } }),
        ).not.toContain("compress");
    });
});
