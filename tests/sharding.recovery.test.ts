import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
    ClusterManager,
    ClusterWorker,
    ShardManager,
    ShardSupervisor,
} from "../packages/sharding/src/index.ts";
import { CLUSTER_FRAME } from "../packages/sharding/src/protocol.ts";
import { Gateway } from "../packages/ws/src/index.ts";
import { fakeFork, tick, type FakeChild } from "./helpers/fake-cluster.ts";
import { FakeWebSocket, installWebSocket } from "./helpers/fake-websocket.ts";

const originalConnect = Gateway.prototype.connect;
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
afterEach(() => {
    Gateway.prototype.connect = originalConnect;
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
});

const gatewayBot = (body: () => unknown) => {
    globalThis.fetch = (async () =>
        new Response(JSON.stringify(body()), { status: 200 })) as never;
};

/** Real processes exit some time after a signal. */
function slowExit(child: FakeChild): void {
    child.kill = (signal?: string) => {
        child.kills.push(signal);
        setTimeout(() => child.exit(null, (signal ?? "SIGTERM") as never), 20);
        return true;
    };
}

describe("ClusterManager recovery", () => {
    test("a late exit of a killed child does not touch the cluster that replaced it", async () => {
        const forked = fakeFork();
        forked.onFork(slowExit);
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 2,
            clusterCount: 2,
            spawnInterval: 0,
            restartDelay: 5,
            fork: forked.fork,
        });
        await manager.spawn();
        manager.killAll();
        await manager.spawn();
        const fresh = forked.children.slice(2);
        for (const child of fresh) child.ready();
        await tick();
        // An old child still talking is ignored.
        forked.children[0]!.control({ kind: "identify", id: 1, shardId: 0 });
        await tick(40); // the old children exit now
        expect(forked.children[0]!.controlFrames("identify-grant")).toEqual([]);
        expect([...manager.clusters.keys()].sort()).toEqual([0, 1]);
        const result = await manager.broadcast("ping", null, {
            timeoutMs: 50,
        });
        expect(result.missing).toEqual([]);
        await manager.shutdownAll(50);
        expect(fresh.every((child) => child.kills.length > 0)).toBe(true);
    });

    test("an auto-scale respawn keeps max_concurrency", async () => {
        let shards = 2;
        gatewayBot(() => ({
            url: "wss://gateway.discord.gg",
            shards,
            session_start_limit: {
                total: 1000,
                remaining: 1000,
                reset_after: 0,
                max_concurrency: 4,
            },
        }));
        const forked = fakeFork();
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: "auto",
            clusterCount: 2,
            spawnInterval: 0,
            fork: forked.fork,
            shutdownTimeout: 10,
        });
        await manager.spawn();
        shards = 4;
        await manager.checkAutoScale();
        const fresh = forked.children.slice(2);
        expect(manager.shardCount).toBe(4);
        for (const child of fresh)
            child.control({
                kind: "identify",
                id: 1,
                shardId: child.shards[0],
            });
        await tick(5);
        expect(
            fresh.map((child) => child.controlFrames("identify-grant").length),
        ).toEqual([1, 1]);
        await manager.shutdownAll(10);
    });

    test("one renewal that never settles costs at most one term", async () => {
        let calls = 0;
        const lock = {
            acquire: () => {
                calls++;
                // The first renewal hangs, like a command lost on a reconnect.
                if (calls === 2) return new Promise<boolean>(() => {});
                return Promise.resolve(true);
            },
            release: async () => {},
        };
        const forked = fakeFork();
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 1,
            clusterCount: 1,
            spawnInterval: 0,
            fork: forked.fork,
            leader: { lock, ttl: 200 },
        });
        let lost = 0;
        manager.on("leaderLost", () => lost++);
        manager.on("error", () => {});
        await manager.spawn();
        await tick(700);
        expect(lost).toBeLessThanOrEqual(1);
        expect(manager.isLeader).toBe(true);
        expect(forked.children.length).toBeLessThanOrEqual(2);
        manager.killAll();
    });

    test("clusterUnstable counts recent crashes, not the lifetime", async () => {
        const forked = fakeFork();
        const manager = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 1,
            clusterCount: 1,
            spawnInterval: 0,
            fork: forked.fork,
            restartDelay: 1,
            supervisor: { window: 20 },
        });
        const unstable: number[] = [];
        manager.on("clusterUnstable", (_cluster, info) =>
            unstable.push(info.attempt),
        );
        await manager.spawn();
        for (let i = 0; i < 4; i++) {
            const child = forked.children.at(-1)!;
            child.ready();
            await tick(40); // stable for two windows
            child.exit(1, null);
            await tick(10);
        }
        expect(forked.children).toHaveLength(5);
        expect(unstable).toEqual([]);
        manager.killAll();
    });
});

describe("ShardSupervisor", () => {
    test("a crash-on-boot loop reaches maxRestarts and maxDelay despite backoff", () => {
        const supervisor = new ShardSupervisor({
            restartDelay: 5000,
            backoff: 2,
            maxRestarts: 8,
            window: 60_000,
            maxDelay: 300_000,
        });
        let now = 0;
        const delays: (number | null)[] = [];
        for (let i = 0; i < 20; i++) {
            const delay = supervisor.next(0, now);
            delays.push(delay);
            if (delay === null) break;
            now += delay + 100; // crashes 100 ms after each restart
        }
        expect(delays).toEqual([
            5000,
            10_000,
            20_000,
            40_000,
            80_000,
            160_000,
            300_000,
            300_000,
            null,
        ]);
        expect(supervisor.attempts(0)).toBe(0);
    });

    test("a cluster that ran a whole window after its restart is forgiven", () => {
        const supervisor = new ShardSupervisor({
            restartDelay: 10,
            backoff: 2,
            window: 100,
        });
        expect(supervisor.next(0, 0)).toBe(10);
        expect(supervisor.next(0, 50)).toBe(20);
        expect(supervisor.attempts(0)).toBe(2);
        // Restarted at 70; crashing at 170 means it ran for a whole window.
        expect(supervisor.next(0, 170)).toBe(10);
        expect(supervisor.attempts(0)).toBe(1);
    });
});

describe("ClusterWorker", () => {
    test("an unsendable reply fails alone and is answered with an error", async () => {
        const endpoint = new EventEmitter() as EventEmitter & {
            send(message: unknown): boolean;
        };
        const sent: Record<string, Record<string, unknown>>[] = [];
        // JSON IPC serialization throws synchronously on a BigInt.
        endpoint.send = (message) => {
            sent.push(JSON.parse(JSON.stringify(message)));
            return true;
        };
        const worker = new ClusterWorker(
            {
                clusterId: 0,
                clusterCount: 1,
                shardCount: 2,
                shardIds: [0, 1],
                coordinatedIdentify: true,
            } as never,
            endpoint as never,
        );
        worker.onRequest("stats", () => ({ members: 10n }));
        let settled = "pending";
        void worker.identifyGate!.acquire(1).then(
            () => (settled = "granted"),
            () => (settled = "rejected"),
        );
        endpoint.emit("message", {
            [CLUSTER_FRAME]: {
                kind: "request",
                id: "parent:1",
                type: "stats",
                data: null,
            },
        });
        await tick(5);
        expect(settled).toBe("pending");
        const replies = sent
            .map((frame) => frame[CLUSTER_FRAME]!)
            .filter((body) => body.kind === "reply");
        expect(replies).toHaveLength(1);
        expect(String(replies[0]!.error)).toContain(
            "The reply could not be sent",
        );
        worker.close();
        await tick();
        expect(settled).toBe("rejected");
    });

    test("an IDENTIFY request that cannot be sent rejects, and a closed channel fails every wait", async () => {
        const endpoint = new EventEmitter() as EventEmitter & {
            send(message: unknown): boolean;
            connected: boolean;
        };
        endpoint.connected = true;
        let fail = false;
        endpoint.send = () => {
            if (fail) throw new Error("channel closed");
            return true;
        };
        const worker = new ClusterWorker(
            {
                clusterId: 0,
                clusterCount: 1,
                shardCount: 2,
                shardIds: [0, 1],
                coordinatedIdentify: true,
            } as never,
            endpoint as never,
        );
        const gate = worker.identifyGate!;
        const waiting = gate.acquire(0).catch((error: Error) => error.message);
        fail = true;
        endpoint.connected = false;
        await expect(gate.acquire(1)).rejects.toThrow("channel closed");
        expect(await waiting).toBe("channel closed");
        worker.close();
    });
});

describe("ShardManager recovery", () => {
    test("reshard(n) uses n, in fixed and in auto mode", async () => {
        Gateway.prototype.connect = async () => {};
        const fixed = new ShardManager({
            token: "t",
            intents: [],
            shardCount: 2,
            cluster: false,
            spawnDelay: 0,
        });
        await fixed.connect();
        await fixed.reshard(4);
        expect(fixed.shardIds).toEqual([0, 1, 2, 3]);
        fixed.destroy();

        let recommended = 2;
        gatewayBot(() => ({
            url: "wss://gateway.discord.gg",
            shards: recommended,
            session_start_limit: {
                total: 1000,
                remaining: 1000,
                reset_after: 0,
                max_concurrency: 16,
            },
        }));
        const auto = new ShardManager({
            token: "t",
            intents: [],
            shardCount: "auto",
            cluster: false,
            spawnDelay: 0,
        });
        await auto.connect();
        recommended = 4;
        await auto.checkAutoScale();
        expect(auto.shardCount).toBe(4);
        auto.destroy();
    });

    test("a reshard during a paced connect() leaves the new shard set to the new start", async () => {
        const connected: Gateway[] = [];
        Gateway.prototype.connect = async function (this: Gateway) {
            connected.push(this);
        };
        const manager = new ShardManager({
            token: "t",
            intents: [],
            shardCount: 3,
            cluster: false,
            spawnDelay: 30,
            handshakeTimeout: 1,
        });
        const first = manager.connect();
        await tick(5); // the first round ran; the old start sleeps
        await manager.reshard(2);
        await first;
        const fresh = new Set(manager.shards.values());
        expect(connected.filter((gateway) => fresh.has(gateway))).toHaveLength(
            2,
        );
        manager.destroy();
    });

    test("a destroy() while shards wait for a slot does not destroy the next shard set", async () => {
        Gateway.prototype.connect = function (this: Gateway) {
            return this.state === "CLOSED"
                ? Promise.reject(new Error("closed"))
                : Promise.resolve();
        };
        const grants: (() => void)[] = [];
        const released: number[] = [];
        const gate = {
            acquire: () => new Promise<void>((grant) => grants.push(grant)),
            release: (id: number) => released.push(id),
        };
        const manager = new ShardManager({
            token: "t",
            intents: [],
            shardCount: 1,
            cluster: false,
            identify: gate,
            handshakeTimeout: 1,
        });
        const first = manager.connect();
        await tick();
        manager.destroy();
        const second = manager.connect();
        await tick();
        const fresh = manager.shards.get(0)!;
        grants.shift()!();
        await first;
        grants.shift()!();
        await second;
        expect(manager.shards.get(0)).toBe(fresh);
        expect(fresh.state).not.toBe("CLOSED");
        expect(released).toEqual([0, 0]);
        manager.destroy();
    });

    test("a re-IDENTIFY after a lost session takes a slot from the gate", async () => {
        FakeWebSocket.instances = [];
        installWebSocket(FakeWebSocket);
        let acquires = 0;
        let releases = 0;
        const gate = {
            acquire: async () => void acquires++,
            release: () => void releases++,
        };
        const manager = new ShardManager({
            token: "t",
            intents: [],
            shardCount: 1,
            cluster: false,
            identify: gate,
            handshakeTimeout: 50,
        });
        const connecting = manager.connect();
        await tick();
        const first = FakeWebSocket.instances[0]!;
        first.open();
        first.receive({ op: 10, d: { heartbeat_interval: 45_000 } });
        await connecting;
        first.receive({ op: 9, d: false }); // not resumable
        for (let i = 0; i < 60 && FakeWebSocket.instances.length < 2; i++)
            await tick(50);
        const second = FakeWebSocket.instances[1]!;
        second.open();
        second.receive({ op: 10, d: { heartbeat_interval: 45_000 } });
        await tick();
        const identifies = FakeWebSocket.instances
            .flatMap((socket) => socket.payloads())
            .filter((payload) => payload.op === 2).length;
        expect(identifies).toBe(2);
        expect(acquires).toBe(2);
        expect(releases).toBe(2);
        manager.destroy();
    }, 10_000);
});

describe("Gateway identifyGate", () => {
    const hello = { op: 10, d: { heartbeat_interval: 45_000 } };
    const make = (gate: { acquire(): Promise<void>; release(): void }) =>
        new Gateway({
            token: "t",
            intents: [],
            reconnectBaseDelay: 1,
            reconnectMaxDelay: 5,
            identifyGate: gate,
            createSocket: (url) =>
                new FakeWebSocket(url) as unknown as WebSocket,
        });
    const reconnect = async (gateway: Gateway) => {
        const before = FakeWebSocket.instances.length;
        FakeWebSocket.instances.at(-1)!.receive({ op: 9, d: false });
        for (
            let i = 0;
            i < 50 && FakeWebSocket.instances.length === before;
            i++
        )
            await tick(2);
        const socket = FakeWebSocket.instances.at(-1)!;
        socket.open();
        socket.receive(hello);
        void gateway;
        return socket;
    };

    test("the first IDENTIFY after connect() is not gated; a refused slot closes and retries", async () => {
        FakeWebSocket.instances = [];
        let refuse = true;
        let acquires = 0;
        const gate = {
            acquire: () => {
                acquires++;
                return refuse
                    ? Promise.reject(new Error("busy"))
                    : Promise.resolve();
            },
            release: () => {},
        };
        const gateway = make(gate);
        const errors: string[] = [];
        gateway.on("error", (error) => errors.push((error as Error).message));
        const connecting = gateway.connect();
        const first = FakeWebSocket.instances[0]!;
        first.open();
        first.receive(hello);
        await connecting;
        expect(acquires).toBe(0);
        expect(first.payloads().filter((p) => p.op === 2)).toHaveLength(1);
        const refused = await reconnect(gateway);
        await tick();
        expect(errors).toContain("No IDENTIFY slot: busy");
        expect(refused.payloads().filter((p) => p.op === 2)).toHaveLength(0);
        refuse = false;
        for (let i = 0; i < 50 && FakeWebSocket.instances.length < 3; i++)
            await tick(2);
        const third = FakeWebSocket.instances.at(-1)!;
        third.open();
        third.receive(hello);
        await tick();
        expect(third.payloads().filter((p) => p.op === 2)).toHaveLength(1);
        gateway.close();
    });

    test("a slot granted after the socket was replaced is released unused", async () => {
        FakeWebSocket.instances = [];
        const grants: (() => void)[] = [];
        let releases = 0;
        const gateway = make({
            acquire: () => new Promise<void>((grant) => grants.push(grant)),
            release: () => void releases++,
        });
        const connecting = gateway.connect();
        FakeWebSocket.instances[0]!.open();
        FakeWebSocket.instances[0]!.receive(hello);
        await connecting;
        const waiting = await reconnect(gateway);
        gateway.close();
        grants.shift()!();
        await tick();
        expect(waiting.payloads().filter((p) => p.op === 2)).toHaveLength(0);
        expect(releases).toBe(1);
    });
});
