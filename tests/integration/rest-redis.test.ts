/**
 * RedisRateLimitStore against a real Redis: the Lua scripts, atomicity across
 * connections, several REST processes, outages and reconnects. Skipped unless
 * REDIS_URL is set, so the unit run needs no server:
 *
 *   REDIS_URL=redis://127.0.0.1:6379 bun test tests/integration
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
    MemoryRateLimitStore,
    RESTError,
    RedisRateLimitStore,
    fromBunRedis,
    type RESTTelemetryEvent,
    type RateLimitStore,
} from "../../packages/rest/src/index.ts";
import { startFakeDiscord } from "../helpers/fake-discord-server.ts";

const REDIS_URL = process.env.REDIS_URL;
const clients: Array<InstanceType<typeof Bun.RedisClient>> = [];

function connect(url = REDIS_URL!): InstanceType<typeof Bun.RedisClient> {
    const client = new Bun.RedisClient(url, {
        maxRetries: 10_000,
        connectionTimeout: 500,
    });
    clients.push(client);
    return client;
}

function store(
    prefix: string,
    options: Partial<ConstructorParameters<typeof RedisRateLimitStore>[0]> = {},
): RedisRateLimitStore {
    return new RedisRateLimitStore({
        client: fromBunRedis(connect()),
        prefix,
        ...options,
    });
}

const unique = () => `lunibee:it:${crypto.randomUUID()}:`;

afterAll(() => {
    for (const c of clients) c.close();
});

/** A TCP proxy in front of Redis that can drop and refuse connections. */
function redisProxy(target: URL) {
    let accepting = true;
    const live = new Set<{ end(): void }>();
    const server = Bun.listen<{
        upstream?: Awaited<ReturnType<typeof Bun.connect>>;
        pending: Uint8Array[];
    }>({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
            async open(socket) {
                socket.data = { pending: [] };
                if (!accepting) return void socket.end();
                live.add(socket);
                const upstream = await Bun.connect({
                    hostname: target.hostname,
                    port: Number(target.port || 6379),
                    socket: {
                        data: (_s, chunk) => void socket.write(chunk),
                        close: () => void socket.end(),
                        error: () => void socket.end(),
                    },
                });
                live.add(upstream);
                socket.data.upstream = upstream;
                for (const chunk of socket.data.pending.splice(0))
                    upstream.write(chunk);
            },
            data(socket, chunk) {
                if (socket.data.upstream) socket.data.upstream.write(chunk);
                else socket.data.pending.push(new Uint8Array(chunk));
            },
            close(socket) {
                socket.data.upstream?.end();
                live.delete(socket);
            },
        },
    });
    return {
        url: `redis://127.0.0.1:${server.port}`,
        cut() {
            accepting = false;
            for (const s of live) s.end();
            live.clear();
        },
        restore() {
            accepting = true;
        },
        stop: () => server.stop(true),
    };
}

describe.skipIf(!REDIS_URL)("RedisRateLimitStore on a real Redis", () => {
    test("the scripts run and verify() passes", async () => {
        await store(unique()).verify();
    });

    test("the Lua scripts behave like the JS core they port", async () => {
        const run = async (s: RateLimitStore) => {
            const out: unknown[] = [];
            const r = async (key: string) => {
                const res = await s.reserve!(key, { probeMs: 5000 });
                out.push(
                    res.granted
                        ? { granted: true, known: res.known }
                        : {
                              granted: false,
                              reason: res.reason,
                              short: res.retryAfterMs <= 50,
                          },
                );
            };
            await r("a"); // probe
            await r("a"); // waits for the probe
            await s.reconcile!("a", {
                remaining: 2,
                resetAfterMs: 1000,
                limit: 3,
                window: 1_000_000,
            });
            await r("a");
            await r("a");
            await r("a"); // spent
            // An older window's late response changes nothing.
            await s.reconcile!("a", {
                remaining: 3,
                resetAfterMs: 10,
                window: 1,
            });
            out.push((await s.getBucket("a"))?.remaining);
            // A 429 spends the bucket.
            await s.reconcile!("b", { retryAfterMs: 1000 });
            await r("b");
            // A probe can be cleared; a unit refunded.
            await r("c");
            const probe = (await s.reserve!("d", { probeMs: 5000 })) as {
                resetAt: number;
            };
            await s.release!("d", probe, false);
            out.push(await s.getBucket("d"));
            await s.reconcile!("e", {
                remaining: 1,
                resetAfterMs: 1000,
                limit: 2,
            });
            const unit = (await s.reserve!("e")) as { resetAt: number };
            await s.release!("e", unit, true);
            out.push((await s.getBucket("e"))?.remaining);
            // Nothing learned: the probe placeholder goes.
            await s.reconcile!("c", {});
            out.push(await s.getBucket("c"));
            // Elapsed window with a known limit: the next opens at the limit.
            await s.reconcile!("f", {
                remaining: 0,
                resetAfterMs: 1,
                limit: 4,
            });
            await Bun.sleep(5);
            await r("f");
            out.push((await s.getBucket("f"))?.remaining);
            // Global limit, checked in the same step.
            await s.extendGlobalReset!("g", 1000);
            await s.extendGlobalReset!("g", 10);
            const g = await s.reserve!("x", { global: "g" });
            out.push(g.granted ? "granted" : g.reason);
            out.push(
                (await s.getGlobalReset("g")) - Date.now() > 900
                    ? "long"
                    : "short",
            );
            return out;
        };
        const local = await run(new MemoryRateLimitStore());
        const redis = await run(store(unique()));
        expect(redis).toEqual(local);
        expect(local).toEqual([
            { granted: true, known: false },
            { granted: false, reason: "probe", short: true },
            { granted: true, known: true },
            { granted: true, known: true },
            { granted: false, reason: "bucket", short: false },
            0,
            { granted: false, reason: "bucket", short: false },
            { granted: true, known: false },
            undefined,
            1,
            undefined,
            { granted: true, known: true },
            3,
            "global",
            "long",
        ]);
    });

    test("400 concurrent reservations over 8 connections grant exactly the remaining", async () => {
        const prefix = unique();
        const workers = Array.from({ length: 8 }, () => store(prefix));
        await workers[0]!.reconcile!("hot", {
            remaining: 25,
            resetAfterMs: 10_000,
            limit: 25,
        });
        const results = await Promise.all(
            Array.from({ length: 400 }, (_, i) =>
                workers[i % 8]!.reserve!("hot"),
            ),
        );
        expect(results.filter((r) => r.granted)).toHaveLength(25);
        expect((await workers[3]!.getBucket("hot"))!.remaining).toBe(0);
    });

    test("an unknown bucket gets exactly one probe across connections", async () => {
        const prefix = unique();
        const workers = Array.from({ length: 6 }, () => store(prefix));
        const results = await Promise.all(
            Array.from({ length: 60 }, (_, i) =>
                workers[i % 6]!.reserve!("new"),
            ),
        );
        expect(results.filter((r) => r.granted)).toHaveLength(1);
    });

    test("concurrent global extends never shorten the longest", async () => {
        const prefix = unique();
        const workers = Array.from({ length: 8 }, () => store(prefix));
        await Promise.all(
            workers.map((w, i) =>
                w.extendGlobalReset!("bot", i === 5 ? 60_000 : 2_000),
            ),
        );
        expect(
            (await workers[0]!.getGlobalReset("bot")) - Date.now(),
        ).toBeGreaterThan(55_000);
    });

    test("a skewed client clock does not move the windows", async () => {
        const s = store(unique());
        await s.reconcile!("k", { remaining: 0, resetAfterMs: 300 });
        const now = Date.now;
        Date.now = () => now() + 3_600_000;
        try {
            const refused = await s.reserve!("k");
            expect(refused.granted).toBe(false);
            expect(
                (refused as { retryAfterMs: number }).retryAfterMs,
            ).toBeLessThanOrEqual(300);
        } finally {
            Date.now = now;
        }
    });

    test("keys are versioned, carry no token and expire", async () => {
        const prefix = unique();
        const s = store(prefix);
        await s.reconcile!("tokfp/h|1", { remaining: 1, resetAfterMs: 1000 });
        await s.setBucketHash("GET:/x", "h");
        await s.extendGlobalReset!("tokfp", 1000);
        const raw = connect();
        const keys = (await raw.send("KEYS", [`${prefix}*`])) as string[];
        expect(keys.length).toBe(3);
        for (const key of keys) {
            expect(key.startsWith(`${prefix}v1:`)).toBe(true);
            const ttl = Number(await raw.send("PTTL", [key]));
            expect(ttl).toBeGreaterThan(0);
        }
    });

    test("an outage degrades to local limiting, reports it, and recovers on reconnect", async () => {
        const proxy = redisProxy(new URL(REDIS_URL!));
        const events: RESTTelemetryEvent[] = [];
        const warn = console.warn;
        console.warn = () => {};
        try {
            const s = new RedisRateLimitStore({
                client: fromBunRedis(connect(proxy.url)),
                prefix: unique(),
                commandTimeout: 300,
                telemetry: { emit: (e) => void events.push(e) },
            });
            await s.reconcile!("k", { remaining: 5, resetAfterMs: 30_000 });
            expect(s.mode).toBe("distributed");
            proxy.cut();
            await s.reserve!("k");
            expect(s.mode).toBe("degraded-local");
            proxy.restore();
            let recovered = false;
            for (let i = 0; i < 40 && !recovered; i++) {
                await Bun.sleep(100);
                await s.reserve!("k");
                recovered = s.mode === "distributed";
            }
            expect(recovered).toBe(true);
            expect(
                events
                    .filter((e) => e.type === "mode")
                    .map((e) => (e as { mode: string }).mode),
            ).toEqual(["degraded-local", "distributed"]);
        } finally {
            console.warn = warn;
            proxy.stop();
        }
    });

    test("fail-closed refuses while Redis is unreachable and works again after", async () => {
        const proxy = redisProxy(new URL(REDIS_URL!));
        const warn = console.warn;
        console.warn = () => {};
        try {
            const s = new RedisRateLimitStore({
                client: fromBunRedis(connect(proxy.url)),
                prefix: unique(),
                commandTimeout: 300,
                failurePolicy: "fail-closed",
            });
            expect((await s.reserve!("k")).granted).toBe(true);
            proxy.cut();
            const error = await s.reserve!("k").catch((e: unknown) => e);
            expect(error).toBeInstanceOf(RESTError);
            expect((error as RESTError).kind).toBe("coordination");
            proxy.restore();
            let ok = false;
            for (let i = 0; i < 40 && !ok; i++) {
                await Bun.sleep(100);
                ok = await s.reserve!("k2").then(
                    () => true,
                    () => false,
                );
            }
            expect(ok).toBe(true);
            expect(s.mode).toBe("distributed");
        } finally {
            console.warn = warn;
            proxy.stop();
        }
    });
});

describe.skipIf(!REDIS_URL)("several REST processes sharing one Redis", () => {
    const discord = startFakeDiscord({ limit: 5, windowMs: 150, latencyMs: 3 });
    afterAll(() => discord.stop());

    async function fleet(
        processes: number,
        tokens: number,
        perBucket: number,
        server: ReturnType<typeof startFakeDiscord> = discord,
        globalLimit?: number,
    ) {
        server.reset();
        const prefix = unique();
        const outputs = await Promise.all(
            Array.from({ length: processes }, async (_, i) => {
                const proc = Bun.spawn(
                    [
                        "bun",
                        `${import.meta.dir}/../helpers/rest-worker.ts`,
                        JSON.stringify({
                            url: server.url,
                            redis: REDIS_URL,
                            prefix,
                            token: `it.token.${i % tokens}`,
                            buckets: 2,
                            perBucket,
                            globalLimit,
                        }),
                    ],
                    { stdout: "pipe", stderr: "inherit" },
                );
                const out = await new Response(proc.stdout).text();
                expect(await proc.exited).toBe(0);
                return JSON.parse(out.trim().split("\n").at(-1)!) as {
                    errors: number;
                };
            }),
        );
        return {
            errors: outputs.reduce((n, o) => n + o.errors, 0),
            ...server.stats,
        };
    }

    test("4 processes, one bot: no request is sent over the limit", async () => {
        const result = await fleet(4, 1, 15);
        expect(result.errors).toBe(0);
        expect(result.ok).toBe(120);
        expect(result.bucket429).toBe(0);
    }, 30_000);

    test("4 processes, two bots: limits stay per bot", async () => {
        const started = performance.now();
        const result = await fleet(4, 2, 15);
        const ms = performance.now() - started;
        expect(result.errors).toBe(0);
        expect(result.bucket429).toBe(0);
        // Each bot has 30 requests per bucket = 6 windows of 150 ms; sharing
        // one counter would need 12.
        expect(ms).toBeLessThan(12 * 150);
    }, 30_000);

    test("the proactive global limit holds across processes", async () => {
        // Buckets are roomy; only the per-bot global limit (20/s here) binds.
        const global = startFakeDiscord({
            limit: 1000,
            windowMs: 1000,
            globalPerSecond: 20,
        });
        try {
            // Control: without the proactive limit the fleet trips it.
            const without = await fleet(3, 1, 8, global);
            expect(without.global429).toBeGreaterThan(0);
            await Bun.sleep(1100);
            const started = performance.now();
            const limited = await fleet(3, 1, 8, global, 20);
            expect(limited.errors).toBe(0);
            expect(limited.ok).toBe(48);
            expect(limited.global429).toBe(0);
            // 48 requests at 20 per second take at least two windows.
            expect(performance.now() - started).toBeGreaterThan(1900);
        } finally {
            global.stop();
        }
    }, 30_000);
});
