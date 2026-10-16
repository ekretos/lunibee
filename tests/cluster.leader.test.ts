import { afterEach, describe, expect, test } from "bun:test";
import {
    ClusterHost,
    ClusterManager,
    RedisLeaderLock,
    type LeaderLock,
} from "../packages/sharding/src/index.ts";
import { fakeFork, tick } from "./helpers/fake-cluster.ts";

const SECRET = "a-shared-secret-of-sufficient-length";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function until<T>(
    check: () => T | undefined | false,
    ms = 4000,
): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) throw new Error("until() timed out");
        await tick(5);
    }
}

/** One lock key shared by several coordinators, with an expiry like Redis's. */
class SharedKey {
    holder?: string;
    until = 0;
    take(token: string, ttl: number): boolean {
        const now = Date.now();
        if (this.holder !== undefined && this.until <= now)
            this.holder = undefined;
        if (this.holder !== undefined && this.holder !== token) return false;
        this.holder = token;
        this.until = now + ttl;
        return true;
    }
}

/** A lock on a shared key; `broken` makes it unreachable, like a partition. */
function lockOn(
    key: SharedKey,
    token: string,
): LeaderLock & { broken: boolean; released: number } {
    const lock = {
        broken: false,
        released: 0,
        acquire: async (ttl: number) => {
            if (lock.broken) throw new Error("lock unreachable");
            return key.take(token, ttl);
        },
        release: async () => {
            lock.released++;
            if (key.holder === token) key.holder = undefined;
        },
    };
    return lock;
}

function coordinator(
    lock: LeaderLock,
    extra: Partial<ConstructorParameters<typeof ClusterManager>[0]> = {},
) {
    const forked = fakeFork();
    const manager = new ClusterManager({
        token: "t",
        script: "w.js",
        shardCount: 2,
        clusterCount: 2,
        spawnInterval: 0,
        restartDelay: 20,
        fork: forked.fork,
        leader: { lock, ttl: 200 },
        ...extra,
    });
    const events: string[] = [];
    manager.on("leaderAcquired", () => events.push("acquired"));
    manager.on("leaderLost", (reason) => events.push(`lost:${reason}`));
    manager.on("error", () => undefined);
    cleanup.push(() => manager.killAll());
    return { manager, forked, events };
}

describe("RedisLeaderLock", () => {
    /** Runs the two scripts against a key map, as Redis would. */
    function fakeRedis() {
        const keys = new Map<string, { value: string; until: number }>();
        const calls: string[][] = [];
        const client = {
            send: async (command: string, args: string[]) => {
                calls.push([command, ...args]);
                const [script, , key, token, ttl] = args as [
                    string,
                    string,
                    string,
                    string,
                    string?,
                ];
                const entry = keys.get(key);
                const live =
                    entry && entry.until > Date.now() ? entry : undefined;
                if (script.includes("PEXPIRE")) {
                    if (live && live.value !== token) return 0;
                    keys.set(key, {
                        value: token,
                        until: Date.now() + Number(ttl),
                    });
                    return 1;
                }
                if (live?.value === token) {
                    keys.delete(key);
                    return 1;
                }
                return 0;
            },
        };
        return { client, keys, calls };
    }

    test("one holder at a time; the holder renews; release frees it", async () => {
        const redis = fakeRedis();
        const a = new RedisLeaderLock({ client: redis.client, token: "a" });
        const b = new RedisLeaderLock({ client: redis.client, token: "b" });
        expect(await a.acquire(1000)).toBe(true);
        expect(await b.acquire(1000)).toBe(false);
        expect(await a.acquire(1000)).toBe(true);
        await b.release();
        expect(await b.acquire(1000)).toBe(false);
        await a.release();
        expect(await b.acquire(1000)).toBe(true);
        // Keys and tokens travel as KEYS/ARGV, never inside the script.
        const [command, script, count, key, token] = redis.calls[0]!;
        expect([command, count, key, token]).toEqual([
            "EVAL",
            "1",
            "lunibee:cluster:leader",
            "a",
        ]);
        expect(script).not.toContain("lunibee:cluster:leader");
    });

    test("an expired lock can be taken by another coordinator", async () => {
        const redis = fakeRedis();
        const a = new RedisLeaderLock({ client: redis.client, key: "k" });
        const b = new RedisLeaderLock({ client: redis.client, key: "k" });
        expect(await a.acquire(30)).toBe(true);
        expect(await b.acquire(30)).toBe(false);
        await tick(40);
        expect(await b.acquire(30)).toBe(true);
    });

    test("rejects bad options and ttls", async () => {
        expect(() => new RedisLeaderLock({ client: {} as never })).toThrow(
            TypeError,
        );
        expect(
            () =>
                new RedisLeaderLock({
                    client: fakeRedis().client,
                    key: "",
                }),
        ).toThrow(TypeError);
        const lock = new RedisLeaderLock({ client: fakeRedis().client });
        await expect(lock.acquire(0)).rejects.toThrow(RangeError);
        await expect(lock.acquire(1.5)).rejects.toThrow(RangeError);
    });
});

describe("leader option", () => {
    test("rejects an invalid lock or ttl", () => {
        const base = { token: "t", script: "w.js", shardCount: 1 };
        expect(
            () =>
                new ClusterManager({ ...base, leader: { lock: {} as never } }),
        ).toThrow(TypeError);
        const lock = lockOn(new SharedKey(), "x");
        expect(
            () => new ClusterManager({ ...base, leader: { lock, ttl: 50 } }),
        ).toThrow(RangeError);
        expect(new ClusterManager({ ...base }).isLeader).toBe(true);
    });

    test("only the leader starts clusters; a standby takes over when the leader cannot renew", async () => {
        const key = new SharedKey();
        const lockA = lockOn(key, "a");
        const a = coordinator(lockA);
        const b = coordinator(lockOn(key, "b"));
        await a.manager.spawn();
        expect(a.manager.isLeader).toBe(true);
        expect(a.forked.children.length).toBe(2);

        let bStarted = false;
        void b.manager.spawn().then(() => (bStarted = true));
        await tick(150);
        expect(bStarted).toBe(false);
        expect(b.forked.children.length).toBe(0);
        expect(b.manager.isLeader).toBe(false);

        // A is cut off from the lock: it stands down before the lock lapses.
        lockA.broken = true;
        await until(() => a.events.some((e) => e.startsWith("lost:")));
        const stoodDown = Date.now();
        expect(a.manager.isLeader).toBe(false);
        for (const child of a.forked.children)
            expect(child.kills).toContain("SIGKILL");
        expect(key.until).toBeGreaterThan(stoodDown);

        // B leads once the lock lapsed, and only then starts the shards.
        await until(() => bStarted);
        expect(b.events).toEqual(["acquired"]);
        expect(b.forked.children.length).toBe(2);
        expect(b.forked.children.map((c) => c.env.SHARD_LIST)).toEqual(
            a.forked.children.map((c) => c.env.SHARD_LIST),
        );
        expect(a.manager.clusters.size).toBe(0);

        // A is a standby now: reachable again, it still does not lead.
        lockA.broken = false;
        await tick(250);
        expect(a.manager.isLeader).toBe(false);
        expect(a.forked.children.length).toBe(2);
    });

    test("a leader that finds the lock held by another stands down", async () => {
        const key = new SharedKey();
        const a = coordinator(lockOn(key, "a"));
        await a.manager.spawn();
        key.holder = "intruder";
        key.until = Date.now() + 60_000;
        await until(() =>
            a.events.includes(
                "lost:Another coordinator holds the leader lock.",
            ),
        );
        expect(a.manager.clusters.size).toBe(0);
    });

    test("shutdownAll gives the lock back, so a standby leads at once", async () => {
        const key = new SharedKey();
        const lockA = lockOn(key, "a");
        const a = coordinator(lockA);
        const b = coordinator(lockOn(key, "b"));
        await a.manager.spawn();
        const waiting = b.manager.spawn();
        await a.manager.shutdownAll(100);
        expect(lockA.released).toBe(1);
        expect(a.manager.isLeader).toBe(false);
        await waiting;
        expect(b.manager.isLeader).toBe(true);
    });

    test("a standby that is shut down while waiting stops waiting", async () => {
        const key = new SharedKey();
        const a = coordinator(lockOn(key, "a"));
        const lockB = lockOn(key, "b");
        const b = coordinator(lockB);
        await a.manager.spawn();
        const waiting = b.manager.spawn();
        await tick(30);
        await b.manager.shutdownAll(100);
        await waiting;
        expect(b.forked.children.length).toBe(0);
        expect(lockB.released).toBe(0);
    });

    test("an unreachable lock is reported and retried", async () => {
        const lock = lockOn(new SharedKey(), "a");
        lock.broken = true;
        const a = coordinator(lock);
        const errors: string[] = [];
        a.manager.on("error", (error) => errors.push(error.message));
        const started = a.manager.spawn();
        await until(() => errors.length >= 2);
        lock.broken = false;
        await started;
        expect(a.manager.isLeader).toBe(true);
    });

    test("a lock that never answers cannot hold up a shutdown", async () => {
        const hung: LeaderLock = {
            acquire: () => new Promise<boolean>(() => undefined),
            release: () => new Promise<void>(() => undefined),
        };
        const a = coordinator(hung);
        const errors: string[] = [];
        a.manager.on("error", (error) => errors.push(error.message));
        const waiting = a.manager.spawn();
        await until(() => errors.length > 0);
        expect(errors[0]).toMatch(/did not answer within 100 ms/);
        const started = Date.now();
        await a.manager.shutdownAll(100);
        await waiting;
        expect(Date.now() - started).toBeLessThan(1000);
        expect(a.forked.children.length).toBe(0);
    });

    test("a release that never answers cannot hold up a shutdown", async () => {
        const key = new SharedKey();
        const lock = lockOn(key, "a");
        lock.release = () => new Promise<void>(() => undefined);
        const a = coordinator(lock);
        await a.manager.spawn();
        const started = Date.now();
        await a.manager.shutdownAll(100);
        expect(Date.now() - started).toBeLessThan(1000);
        expect(a.manager.isLeader).toBe(false);
    });

    test("respawn keeps the lock", async () => {
        const a = coordinator(lockOn(new SharedKey(), "a"));
        await a.manager.spawn();
        await a.manager.respawn(2);
        expect(a.events).toEqual(["acquired"]);
        expect(a.manager.isLeader).toBe(true);
    });
});

/** A port nothing listens on yet. */
function freePort(): number {
    const server = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = server.port!;
    server.stop(true);
    return port;
}

describe("coordinator failover with hosts", () => {
    test("hosts follow the new leader; it waits for them to fence first", async () => {
        const key = new SharedKey();
        const lockA = lockOn(key, "a");
        const ports = [freePort(), freePort()];
        const lease = 60;
        const make = (lock: LeaderLock, port: number) =>
            coordinator(lock, {
                remote: { port, secret: SECRET, hosts: ["h"], lease },
                shardCount: 1,
                clusterCount: 1,
            });
        const a = make(lockA, ports[0]!);
        const b = make(lockOn(key, "b"), ports[1]!);
        const startingA = a.manager.spawn();
        void b.manager.spawn().catch(() => undefined);

        const forked = fakeFork();
        const host = new ClusterHost({
            url: ports.map((port) => `ws://127.0.0.1:${port}`),
            secret: SECRET,
            id: "h",
            script: "w.js",
            fork: forked.fork,
            reconnectDelay: 10,
            maxReconnectDelay: 40,
        });
        host.on("error", () => undefined);
        cleanup.push(() => host.close());
        // A opens its listener once it leads and waited for fencing.
        for (let attempt = 0; ; attempt++)
            try {
                await host.connect();
                break;
            } catch (error) {
                if (attempt > 100) throw error;
                await tick(20);
            }
        await startingA;
        await until(() => forked.children[0]);
        const first = forked.children[0]!;

        let acquiredAt = 0;
        b.manager.on("leaderAcquired", () => (acquiredAt = Date.now()));
        lockA.broken = true;
        await until(() => forked.children[1], 6000);
        // The old worker was killed, and the new leader waited two leases.
        expect(first.kills).toContain("SIGKILL");
        expect(acquiredAt).toBeGreaterThan(0);
        expect(Date.now() - acquiredAt).toBeGreaterThanOrEqual(lease * 2);
        expect(forked.children[1]!.env.SHARD_LIST).toBe("0");
        expect(b.manager.hosts()[0]!.connected).toBe(true);
    });

    test("connect() tries the next coordinator when one cannot be reached", async () => {
        const live = new ClusterManager({
            token: "t",
            script: "w.js",
            shardCount: 1,
            clusterCount: 1,
            fork: fakeFork().fork,
            remote: { port: 0, secret: SECRET, hosts: ["h"] },
        });
        cleanup.push(() => live.killAll());
        void live.spawn().catch(() => undefined);
        const port = await until(() => live.remotePort);
        const host = new ClusterHost({
            url: [`ws://127.0.0.1:${freePort()}`, `ws://127.0.0.1:${port}`],
            secret: SECRET,
            id: "h",
            script: "w.js",
            fork: fakeFork().fork,
        });
        cleanup.push(() => host.close());
        await host.connect();
        expect(host.connected).toBe(true);
    });

    test("connect() rejects once every coordinator was unreachable", async () => {
        const host = new ClusterHost({
            url: [
                `ws://127.0.0.1:${freePort()}`,
                `ws://127.0.0.1:${freePort()}`,
            ],
            secret: SECRET,
            id: "h",
            script: "w.js",
        });
        cleanup.push(() => host.close());
        await expect(host.connect()).rejects.toThrow(/refused this host/);
    });

    test("url lists are validated", () => {
        const base = { secret: SECRET, id: "h", script: "w.js" };
        expect(() => new ClusterHost({ ...base, url: [] })).toThrow(TypeError);
        expect(
            () =>
                new ClusterHost({
                    ...base,
                    url: Array.from({ length: 17 }, () => "ws://127.0.0.1:1"),
                }),
        ).toThrow(TypeError);
        expect(
            () =>
                new ClusterHost({
                    ...base,
                    url: ["ws://127.0.0.1:1", "ws://example.com:1"],
                }),
        ).toThrow(/wss/);
    });
});
