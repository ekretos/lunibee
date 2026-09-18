import { describe, expect, test } from "bun:test";
import {
    REST,
    RateLimiter,
    RequestScheduler,
    HttpTransport,
    MemoryRateLimitStore,
    RedisRateLimitStore,
    createRouteKey,
    scopeBucket,
    type MinimalRedisClient,
    type Reservation,
} from "../packages/rest/src/index.ts";

/**
 * Stage 1A coverage: REST-005 (atomic reservation across workers) and
 * REST-004 (routes Discord maps onto one bucket hash must share a queue).
 */

/**
 * In-memory stand-in for Redis with real `eval` semantics for the reservation
 * script: reads and writes of one key cannot interleave, and every client
 * instance shares the same backing map, the way separate workers share a server.
 */
function createSharedRedis(): {
    client: () => MinimalRedisClient;
    evalCalls: () => number;
} {
    const data = new Map<string, string>();
    let evals = 0;
    const client = (): MinimalRedisClient => ({
        async get(key) {
            return data.get(key) ?? null;
        },
        async mget(keys) {
            return keys.map((key) => data.get(key) ?? null);
        },
        async set(key, value) {
            data.set(key, String(value));
            return "OK";
        },
        async del(...keys) {
            let removed = 0;
            for (const key of keys) if (data.delete(key)) removed++;
            return removed;
        },
        async eval(_script, _numKeys, ...args) {
            evals++;
            const key = String(args[0]);
            const now = Number(args[1]);
            const raw = data.get(key);
            if (!raw) return [1, 0];
            const state = JSON.parse(raw) as {
                remaining: number;
                resetAt: number;
            };
            const wait = state.resetAt - now;
            if (wait <= 0) return [1, 0];
            if (state.remaining > 0) {
                state.remaining -= 1;
                data.set(key, JSON.stringify(state));
                return [1, 0];
            }
            return [0, Math.ceil(wait)];
        },
    });
    return { client, evalCalls: () => evals };
}

describe("REST-005: atomic reservation", () => {
    test("a bucket's allowance is handed to exactly one worker", async () => {
        const redis = createSharedRedis();
        // Three independent workers, each with its own store instance, sharing
        // one Redis — the exact shape that raced on `remaining` before.
        const workers = [0, 1, 2].map(
            () => new RedisRateLimitStore({ client: redis.client() }),
        );
        const seed = workers[0]!;
        await seed.updateBucket("hash|1", {
            remaining: 1,
            resetAt: Date.now() + 10_000,
        });

        const results = await Promise.all(
            workers.map((store) => store.reserve!("hash|1")),
        );
        const granted = results.filter((r: Reservation) => r.granted);
        expect(granted).toHaveLength(1);
        for (const refusal of results.filter((r) => !r.granted))
            expect(
                (refusal as { retryAfterMs: number }).retryAfterMs,
            ).toBeGreaterThan(0);
        expect(redis.evalCalls()).toBe(3);
    });

    test("reservation is advertised only when the client can run it atomically", () => {
        const withEval = new RedisRateLimitStore({
            client: createSharedRedis().client(),
        });
        expect(typeof withEval.reserve).toBe("function");
        expect(withEval.supportsReservation).toBe(true);

        const plain = createSharedRedis().client();
        delete (plain as { eval?: unknown }).eval;
        const withoutEval = new RedisRateLimitStore({ client: plain });
        expect(withoutEval.reserve).toBeUndefined();
        expect(withoutEval.supportsReservation).toBe(false);
        // The limiter must see the same answer the store gives.
        expect(new RateLimiter(withoutEval).reserves).toBe(false);
        expect(new RateLimiter(withEval).reserves).toBe(true);
    });

    test("an unknown or elapsed bucket is granted, never deadlocked", async () => {
        const store = new MemoryRateLimitStore();
        expect(store.reserve("never-seen")).toEqual({ granted: true });
        store.updateBucket("stale", { remaining: 0, resetAt: Date.now() - 10 });
        expect(store.reserve("stale")).toEqual({ granted: true });
    });

    test("the memory store decrements, refuses, then grants after the reset", async () => {
        const store = new MemoryRateLimitStore();
        store.updateBucket("k", { remaining: 2, resetAt: Date.now() + 40 });
        expect(store.reserve("k").granted).toBe(true);
        expect(store.reserve("k").granted).toBe(true);
        const refused = store.reserve("k");
        expect(refused.granted).toBe(false);

        const limiter = new RateLimiter(store);
        const start = Date.now();
        await limiter.acquire("k", undefined, "/p");
        expect(Date.now() - start).toBeGreaterThanOrEqual(20);
    });

    test("a Redis outage falls back to the local mirror instead of blocking", async () => {
        const warn = console.warn;
        console.warn = () => {};
        try {
            const store = new RedisRateLimitStore({
                client: {
                    get: async () => {
                        throw new Error("down");
                    },
                    mget: async () => {
                        throw new Error("down");
                    },
                    set: async () => {
                        throw new Error("down");
                    },
                    del: async () => {
                        throw new Error("down");
                    },
                    eval: async () => {
                        throw new Error("down");
                    },
                } as unknown as MinimalRedisClient,
            });
            // Mirrored write survives the failed Redis write.
            await store.updateBucket("k", {
                remaining: 1,
                resetAt: Date.now() + 5_000,
            });
            expect((await store.reserve!("k")).granted).toBe(true);
            // The mirror's single unit is now spent, so the fleet still backs off.
            expect((await store.reserve!("k")).granted).toBe(false);
        } finally {
            console.warn = warn;
        }
    });
});

describe("REST-004: routes sharing one bucket hash", () => {
    test("a request re-resolves its bucket key after waiting", async () => {
        const scheduler = new RequestScheduler();
        let key = "route-key";
        const order: string[] = [];

        const first = scheduler.runResolved(
            async () => key,
            undefined,
            "/a",
            async (resolved) => {
                // While this runs, the shared hash becomes known.
                key = "shared-hash|1";
                await new Promise((resolve) => setTimeout(resolve, 20));
                order.push(`first:${resolved}`);
            },
        );
        const second = scheduler.runResolved(
            async () => key,
            undefined,
            "/b",
            async (resolved) => {
                order.push(`second:${resolved}`);
            },
        );
        await Promise.all([first, second]);
        expect(order).toEqual(["first:route-key", "second:shared-hash|1"]);
        expect(scheduler.size).toBe(0);
    });

    test("a request queued under its route key joins the shared-hash queue", async () => {
        // The realistic case: one route already knows the shared hash, the
        // other is discovering it. A request queued behind the discovering
        // request must not run alongside the shared bucket's other traffic
        // once the hash is known.
        const store = new MemoryRateLimitStore();
        const live = new Set<string>();
        const overlaps = new Set<string>();
        const durations: Record<string, number> = {
            "/channels/1/pins": 60,
            "/channels/1/messages": 20,
        };

        const rest = new REST({
            token: "token",
            store,
            transport: new HttpTransport({
                fetch: async (url) => {
                    const path = new URL(url).pathname;
                    const label = `${path}#${live.size}`;
                    for (const other of live) overlaps.add(`${other}|${label}`);
                    live.add(label);
                    await new Promise((resolve) =>
                        setTimeout(resolve, durations[path] ?? 20),
                    );
                    live.delete(label);
                    return new Response("{}", {
                        status: 200,
                        headers: {
                            "content-type": "application/json",
                            "X-RateLimit-Bucket": "shared",
                            "X-RateLimit-Remaining": "10",
                            "X-RateLimit-Reset-After": "1",
                        },
                    });
                },
            }),
        });

        // Teach only the pins route its hash; messages is still undiscovered.
        await rest.get("/channels/1/pins");
        expect(await store.getBucketHash("GET:/channels/:id/pins")).toBe(
            "shared",
        );
        expect(
            await store.getBucketHash("GET:/channels/:id/messages"),
        ).toBeUndefined();

        overlaps.clear();
        await Promise.all([
            rest.get("/channels/1/messages"), // discovers the hash
            rest.get("/channels/1/messages"), // queued behind it, must remap
            rest.get("/channels/1/pins"), // long, holds the shared queue
        ]);

        // The first messages request unavoidably overlaps pins: neither knew
        // they shared a bucket. The queued one must not, having learned.
        const sharedBucketOverlaps = [...overlaps].filter((pair) =>
            pair.includes("/channels/1/messages#1"),
        );
        expect(sharedBucketOverlaps).toEqual([]);
    });

    test("different major parameters still run independently", async () => {
        const store = new MemoryRateLimitStore();
        store.setBucketHash("GET:/channels/:id/messages", "shared");
        const route1 = createRouteKey("GET", "/channels/1/messages");
        const route2 = createRouteKey("GET", "/channels/2/messages");
        const limiter = new RateLimiter(store);
        expect(await limiter.resolveBucketKey(route1.route, route1.major)).toBe(
            scopeBucket("shared", "1"),
        );
        expect(
            await limiter.resolveBucketKey(route2.route, route2.major),
        ).not.toBe(scopeBucket("shared", "1"));

        let inFlight = 0;
        let maxConcurrent = 0;
        const rest = new REST({
            token: "token",
            store,
            transport: new HttpTransport({
                fetch: async () => {
                    inFlight++;
                    maxConcurrent = Math.max(maxConcurrent, inFlight);
                    await new Promise((resolve) => setTimeout(resolve, 20));
                    inFlight--;
                    return new Response("{}", {
                        status: 200,
                        headers: {
                            "content-type": "application/json",
                            "X-RateLimit-Bucket": "shared",
                            "X-RateLimit-Remaining": "5",
                            "X-RateLimit-Reset-After": "1",
                        },
                    });
                },
            }),
        });
        await Promise.all([
            rest.get("/channels/1/messages"),
            rest.get("/channels/2/messages"),
        ]);
        expect(maxConcurrent).toBe(2);
    });
});
