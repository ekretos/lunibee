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
            handshakeTimeout: 1,
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
        // The shard set is kept; nothing was connected.
        expect(manager.shardCount).toBe(3);
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

describe("ShardManager review fixes", () => {
    test("caps a maxConcurrency override at Discord's limit", async () => {
        gatewayBot({
            shards: 3,
            session_start_limit: {
                total: 1000,
                remaining: 1000,
                reset_after: 0,
                max_concurrency: 1,
            },
        });
        let active = 0;
        let peak = 0;
        Gateway.prototype.connect = async function () {
            peak = Math.max(peak, ++active);
            await new Promise((r) => setTimeout(r, 2));
            active--;
        };
        const manager = new ShardManager({
            token: "t",
            intents: 0,
            shardCount: "auto",
            maxConcurrency: 3,
            spawnDelay: 1,
            handshakeTimeout: 1,
        });
        await manager.connect();
        expect(peak).toBe(1);
        manager.destroy();
    });

    test("live shards are not counted against the budget or reconnected", async () => {
        gatewayBot({
            shards: 2,
            session_start_limit: {
                total: 1000,
                remaining: 1,
                reset_after: 0,
                max_concurrency: 1,
            },
        });
        const connected: Gateway[] = [];
        Gateway.prototype.connect = async function (this: Gateway) {
            connected.push(this);
        };
        const manager = new ShardManager({
            token: "t",
            intents: 0,
            shardCount: "auto",
            spawnDelay: 0,
        });
        await expect(manager.connect()).rejects.toThrow("for 2 shards");
        manager.get(0)!.state = "READY" as Gateway["state"];
        await manager.connect();
        expect(connected).toEqual([manager.get(1)!]);
        manager.destroy();
    });

    test("the next round waits for the previous round's IDENTIFY", async () => {
        const order: string[] = [];
        Gateway.prototype.connect = async function (this: Gateway) {
            const gateway = this as unknown as {
                state: string;
                emit(event: string, data: unknown): void;
            };
            order.push("open");
            setTimeout(() => {
                order.push("identify");
                gateway.state = "IDENTIFY";
                gateway.emit("stateChange", {
                    previous: "HELLO",
                    next: "IDENTIFY",
                });
            }, 5);
        };
        const manager = new ShardManager({
            token: "t",
            intents: 0,
            shardCount: 2,
            spawnDelay: 1,
            handshakeTimeout: 1_000,
        });
        await manager.connect();
        expect(order.slice(0, 3)).toEqual(["open", "identify", "open"]);
        manager.destroy();
    });

    test("validates handshakeTimeout", () => {
        expect(
            () =>
                new ShardManager({
                    token: "t",
                    intents: 0,
                    handshakeTimeout: -1,
                }),
        ).toThrow(RangeError);
    });
});
