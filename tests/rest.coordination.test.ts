import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    HttpTransport,
    MemoryRateLimitStore,
    REST,
    RESTError,
    RESTMetrics,
    RateLimiter,
    RedisRateLimitStore,
    fromBunRedis,
    headerNumber,
    parseRateLimitHeaders,
    requestIdentity,
    tokenFingerprint,
    type RESTTelemetryEvent,
    type RateLimitStore,
    type Reservation,
} from "../packages/rest/src/index.ts";
import { reconcileState, reserveState } from "../packages/rest/src/store.ts";
import {
    createFakeDiscord,
    startFakeDiscord,
} from "./helpers/fake-discord-server.ts";
import { createFakeRedis } from "./helpers/fake-redis.ts";

const TOKEN = "coordination.test.token-value";

let warn: typeof console.warn;
beforeEach(() => {
    warn = console.warn;
    console.warn = () => {};
});
afterEach(() => {
    console.warn = warn;
});

function client(
    discord: ReturnType<typeof createFakeDiscord>,
    options: ConstructorParameters<typeof REST>[0] = {},
): REST {
    return new REST({
        token: TOKEN,
        retries: 10,
        transport: new HttpTransport({ fetch: discord.fetch }),
        ...options,
    });
}

const post = (rest: REST, channel: number | string) =>
    rest.post(`/channels/${channel}/messages`, { content: "x" });

describe("headers are parsed defensively", () => {
    test("missing, empty, negative and non-numeric values are absent, not zero", () => {
        const h = new Headers({
            "x-ratelimit-remaining": "",
            "x-ratelimit-limit": "-3",
            "x-ratelimit-reset-after": "soon",
            "retry-after": "Infinity",
        });
        const parsed = parseRateLimitHeaders(h);
        expect(parsed.remaining).toBeUndefined();
        expect(parsed.limit).toBeUndefined();
        expect(parsed.resetAfterMs).toBeUndefined();
        expect(parsed.retryAfterMs).toBeUndefined();
        expect(headerNumber(new Headers(), "x")).toBeUndefined();
    });

    test("valid values, scope, global and bucket are read", () => {
        const parsed = parseRateLimitHeaders(
            new Headers({
                "x-ratelimit-limit": "5",
                "x-ratelimit-remaining": "4",
                "x-ratelimit-reset-after": "1.5",
                "x-ratelimit-reset": "1700000000.25",
                "x-ratelimit-bucket": "abc123",
                "x-ratelimit-scope": "Shared",
                "x-ratelimit-global": "true",
                "retry-after": "2",
            }),
        );
        expect(parsed).toEqual({
            limit: 5,
            remaining: 4,
            resetAfterMs: 1500,
            resetAtMs: 1700000000250,
            bucket: "abc123",
            scope: "shared",
            global: true,
            retryAfterMs: 2000,
        });
    });

    test("a bucket hash that is not one is ignored", () => {
        expect(
            parseRateLimitHeaders(
                new Headers({ "x-ratelimit-bucket": "a b;c" }),
            ).bucket,
        ).toBeUndefined();
        expect(
            parseRateLimitHeaders(
                new Headers({ "x-ratelimit-bucket": "x".repeat(65) }),
            ).bucket,
        ).toBeUndefined();
        expect(
            parseRateLimitHeaders(new Headers({ "x-ratelimit-scope": "odd" }))
                .scope,
        ).toBeUndefined();
    });

    test("a response without rate-limit headers does not zero remaining", async () => {
        const store = new MemoryRateLimitStore();
        store.updateBucket("k", { remaining: 5, resetAt: Date.now() + 10_000 });
        const limiter = new RateLimiter(store);
        await limiter.applyResponse(new Response("{}"), "k", "r", "@none");
        expect(store.getBucket("k")!.remaining).toBe(5);
    });
});

describe("429 delays", () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore());
    const res = (headers: Record<string, string>) =>
        new Response("{}", { status: 429, headers });

    test("the body's retry_after wins, then Retry-After, then Reset-After, then one second", () => {
        expect(
            limiter.retryAfterMs(res({ "retry-after": "9" }), {
                retry_after: 0.25,
            }),
        ).toBe(250);
        expect(limiter.retryAfterMs(res({ "retry-after": "3" }))).toBe(3000);
        expect(
            limiter.retryAfterMs(res({ "x-ratelimit-reset-after": "0.5" })),
        ).toBe(500);
        expect(limiter.retryAfterMs(res({}))).toBe(1000);
    });

    test("malformed delays are ignored, not read as zero", () => {
        expect(
            limiter.retryAfterMs(res({ "retry-after": "-5" }), {
                retry_after: Number.NaN,
            }),
        ).toBe(1000);
        expect(limiter.retryAfterMs(res({ "retry-after": "abc" }))).toBe(1000);
        expect(limiter.retryAfterMs(res({}), { retry_after: -1 })).toBe(1000);
    });

    test("a 429 without a delay still waits, and the retry goes through the limiter", async () => {
        let calls = 0;
        const times: number[] = [];
        const rest = new REST({
            token: TOKEN,
            transport: new HttpTransport({
                fetch: async () => {
                    times.push(Date.now());
                    return ++calls === 1
                        ? new Response(JSON.stringify({ message: "slow" }), {
                              status: 429,
                              headers: {
                                  "content-type": "application/json",
                                  "x-ratelimit-reset-after": "0.08",
                              },
                          })
                        : new Response("{}");
                },
            }),
        });
        await rest.get("/channels/1/messages");
        expect(calls).toBe(2);
        expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(70);
    });

    test("other requests on the bucket also wait out a 429", async () => {
        const discord = createFakeDiscord({ limit: 2, windowMs: 150 });
        const store = new MemoryRateLimitStore();
        const a = client(discord, { store });
        await Promise.all([post(a, 1), post(a, 1), post(a, 1), post(a, 1)]);
        expect(discord.stats.bucket429).toBe(0);
    });
});

describe("reservation core", () => {
    test("unknown bucket: one probe, everyone else polls briefly", () => {
        const first = reserveState(undefined, 1000, 5000);
        expect(first.reservation).toEqual({
            granted: true,
            known: false,
            resetAt: 6000,
        });
        const second = reserveState(first.next, 1001, 5000);
        expect(second.reservation).toEqual({
            granted: false,
            retryAfterMs: 50,
            reason: "probe",
        });
    });

    test("elapsed window with a known limit opens the next one at the limit", () => {
        const { reservation, next } = reserveState(
            { remaining: 0, resetAt: 900, limit: 3 },
            1000,
            5000,
        );
        expect(reservation).toMatchObject({ granted: true, known: true });
        expect(next).toEqual({
            remaining: 2,
            resetAt: 6000,
            limit: 3,
            provisional: true,
        });
    });

    test("never goes negative", () => {
        let state = reserveState(
            { remaining: 0, resetAt: 900, limit: 2 },
            1000,
            5000,
        ).next;
        let granted = 1;
        for (let i = 0; i < 10; i++) {
            const r = reserveState(state, 1001, 5000);
            if (r.reservation.granted) granted++;
            state = r.next ?? state;
            expect(state!.remaining).toBeGreaterThanOrEqual(0);
        }
        expect(granted).toBe(2);
    });
});

describe("out-of-order responses", () => {
    const base = { remaining: 3, resetAt: 5000, window: 5000 };

    test("a late response cannot raise remaining within its window", () => {
        const next = reconcileState(
            base,
            { remaining: 4, resetAfterMs: 3000, window: 5000 },
            2000,
        );
        expect(next!.remaining).toBe(3);
    });

    test("a response from an older window is ignored", () => {
        const next = reconcileState(
            base,
            { remaining: 0, resetAfterMs: 10, window: 1000 },
            2000,
        );
        expect(next).toEqual(base);
    });

    test("a newer window replaces the reset but keeps the lower count", () => {
        const next = reconcileState(
            base,
            { remaining: 4, resetAfterMs: 1000, window: 9000 },
            4000,
        );
        expect(next).toMatchObject({
            remaining: 3,
            resetAt: 5000,
            window: 9000,
        });
        const later = reconcileState(
            { ...base, resetAt: 5000 },
            { remaining: 1, resetAfterMs: 4000, window: 9000 },
            4000,
        );
        expect(later).toMatchObject({ remaining: 1, resetAt: 8000 });
    });

    test("an estimated reset is replaced by the server's", () => {
        const next = reconcileState(
            { remaining: 2, resetAt: 20_000, limit: 3, provisional: true },
            { remaining: 2, resetAfterMs: 500, limit: 3 },
            1000,
        );
        expect(next).toEqual({ remaining: 2, resetAt: 1500, limit: 3 });
    });

    test("a probe placeholder is replaced, or cleared when nothing was learned", () => {
        const probe = {
            remaining: 0,
            resetAt: 9000,
            provisional: true,
            probe: true,
        };
        expect(
            reconcileState(probe, { remaining: 4, resetAfterMs: 1000 }, 1000),
        ).toEqual({ remaining: 4, resetAt: 2000 });
        expect(reconcileState(probe, {}, 1000)).toBeNull();
        expect(reconcileState(undefined, {}, 1000)).toBeUndefined();
    });

    test("a bucket 429 spends the bucket until its wait", () => {
        expect(
            reconcileState(base, { retryAfterMs: 7000 }, 2000),
        ).toMatchObject({ remaining: 0, resetAt: 9000 });
        expect(reconcileState(undefined, { retryAfterMs: 100 }, 2000)).toEqual({
            remaining: 0,
            resetAt: 2100,
        });
    });
});

describe("global limits", () => {
    test("a shorter extend never shortens a longer one", async () => {
        const store = new MemoryRateLimitStore();
        const limiter = new RateLimiter(store);
        await limiter.noteGlobalReset(Date.now() + 60_000, "bot");
        await limiter.noteGlobalReset(Date.now() + 2_000, "bot");
        expect(store.getGlobalReset("bot") - Date.now()).toBeGreaterThan(
            55_000,
        );
        expect(store.getGlobalReset("other")).toBe(0);
    });

    test("concurrent extends from many workers through Redis keep the longest", async () => {
        const redis = createFakeRedis();
        const workers = Array.from(
            { length: 8 },
            () => new RedisRateLimitStore({ client: redis.client() }),
        );
        await Promise.all(
            workers.map((w, i) =>
                w.extendGlobalReset!("bot", i === 3 ? 60_000 : 2_000),
            ),
        );
        expect(
            (await workers[0]!.getGlobalReset("bot")) - Date.now(),
        ).toBeGreaterThan(55_000);
    });

    test("a global 429 holds every bucket of that bot, and no other bot", async () => {
        let calls = 0;
        const store = new MemoryRateLimitStore();
        const fetch = async (_url: string, init: RequestInit) => {
            calls++;
            const auth = new Headers(init.headers).get("authorization");
            if (calls === 1)
                return new Response(
                    JSON.stringify({ retry_after: 0.15, global: true }),
                    {
                        status: 429,
                        headers: { "content-type": "application/json" },
                    },
                );
            return new Response(JSON.stringify({ auth }), {
                headers: { "content-type": "application/json" },
            });
        };
        const a = new REST({
            token: "bot.a",
            store,
            retries: 0,
            transport: new HttpTransport({ fetch }),
        });
        const b = new REST({
            token: "bot.b",
            store,
            transport: new HttpTransport({ fetch }),
        });
        await a.get("/users/@me").catch(() => undefined);
        const started = Date.now();
        await b.get("/channels/2");
        expect(Date.now() - started).toBeLessThan(100);
        await a.get("/channels/3");
        expect(Date.now() - started).toBeGreaterThanOrEqual(120);
    });

    test("interaction callbacks do not wait on the bot's global limit", async () => {
        const store = new MemoryRateLimitStore();
        const fp = tokenFingerprint(TOKEN);
        store.extendGlobalReset(fp, 5_000);
        const rest = new REST({
            token: TOKEN,
            store,
            transport: new HttpTransport({
                fetch: async () => new Response(null, { status: 204 }),
            }),
        });
        const started = Date.now();
        await rest.post("/interactions/1/tok/callback", { type: 1 });
        expect(Date.now() - started).toBeLessThan(500);
    });
});

describe("identity", () => {
    test("bot routes, token webhooks, interactions and anonymous requests are told apart", () => {
        const fp = tokenFingerprint(TOKEN);
        expect(fp).toMatch(/^[0-9a-f]{16}$/);
        expect(fp).not.toContain(TOKEN);
        expect(requestIdentity("/channels/1", fp)).toEqual({
            bucket: fp,
            global: fp,
        });
        expect(requestIdentity("/webhooks/1/secret", fp)).toEqual({
            bucket: "shared",
            global: fp,
        });
        expect(requestIdentity("/webhooks/1/secret", undefined)).toEqual({
            bucket: "shared",
            global: "anon",
        });
        expect(requestIdentity("/interactions/1/t/callback", fp)).toEqual({
            bucket: "shared",
        });
        expect(requestIdentity("/channels/1", undefined)).toEqual({
            bucket: "anon",
            global: "anon",
        });
        // A webhook by id only is a bot route.
        expect(requestIdentity("/webhooks/1", fp).bucket).toBe(fp);
    });

    test("two bots sharing one Redis never share a bucket counter", async () => {
        const redis = createFakeRedis();
        const discord = createFakeDiscord({ limit: 2, windowMs: 200 });
        const make = (token: string) =>
            client(discord, {
                token,
                store: new RedisRateLimitStore({ client: redis.client() }),
            });
        const a = make("bot.one");
        const b = make("bot.two");
        const started = Date.now();
        await Promise.all([post(a, 1), post(a, 1), post(b, 1), post(b, 1)]);
        // Each bot has its own window: nobody waits for a reset.
        expect(Date.now() - started).toBeLessThan(150);
        expect(discord.stats.bucket429).toBe(0);
        const keys = [...redis.data.keys()];
        expect(keys.some((k) => k.includes(tokenFingerprint("bot.one")))).toBe(
            true,
        );
        expect(keys.some((k) => k.includes(tokenFingerprint("bot.two")))).toBe(
            true,
        );
        for (const k of keys) {
            expect(k).toStartWith("lunibee:rest:v1:");
            expect(k).not.toContain("bot.one");
            expect(k).not.toContain("bot.two");
        }
    });

    test("setToken moves the client to the new bot's buckets", async () => {
        const store = new MemoryRateLimitStore();
        const rest = new REST({
            token: "first.token",
            store,
            transport: new HttpTransport({
                fetch: async () =>
                    new Response("{}", {
                        headers: {
                            "x-ratelimit-bucket": "h",
                            "x-ratelimit-remaining": "0",
                            "x-ratelimit-reset-after": "5",
                        },
                    }),
            }),
        });
        await rest.get("/channels/1");
        rest.setToken("second.token");
        const started = Date.now();
        await rest.get("/channels/1");
        expect(Date.now() - started).toBeLessThan(500);
    });
});

describe("concurrency", () => {
    test("150 concurrent requests on one limited bucket never overshoot", async () => {
        const discord = createFakeDiscord({
            limit: 10,
            windowMs: 60,
            latencyMs: 2,
        });
        const rest = client(discord, { retries: 0 });
        await Promise.all(Array.from({ length: 150 }, () => post(rest, 1)));
        expect(discord.stats.ok).toBe(150);
        expect(discord.stats.bucket429).toBe(0);
        expect(discord.stats.peak).toBeLessThanOrEqual(10);
    });

    test("independent buckets progress concurrently", async () => {
        const discord = createFakeDiscord({
            limit: 1,
            windowMs: 100,
            latencyMs: 5,
        });
        const rest = client(discord);
        const started = Date.now();
        await Promise.all(
            Array.from({ length: 8 }, (_, i) => [
                post(rest, i + 10),
                post(rest, i + 10),
            ]).flat(),
        );
        // Two windows per channel, all channels at once: about 100 ms, not 800.
        expect(Date.now() - started).toBeLessThan(400);
        expect(discord.stats.bucket429).toBe(0);
    });

    test("several REST instances sharing one Redis never overshoot", async () => {
        const redis = createFakeRedis();
        const discord = createFakeDiscord({
            limit: 5,
            windowMs: 80,
            latencyMs: 3,
        });
        const instances = Array.from({ length: 4 }, () =>
            client(discord, {
                store: new RedisRateLimitStore({ client: redis.client() }),
            }),
        );
        await Promise.all(
            instances.flatMap((rest) =>
                Array.from({ length: 15 }, (_, i) => post(rest, 1 + (i % 2))),
            ),
        );
        expect(discord.stats.ok).toBe(60);
        expect(discord.stats.bucket429).toBe(0);
    });

    test("an unknown bucket is probed by one request across instances", async () => {
        const store = new MemoryRateLimitStore();
        const discord = createFakeDiscord({
            limit: 3,
            windowMs: 1000,
            latencyMs: 20,
        });
        const instances = Array.from({ length: 3 }, () =>
            client(discord, { store }),
        );
        await Promise.all(instances.map((rest) => post(rest, 7)));
        // One probe, then the other two together.
        expect(discord.stats.peak).toBeLessThanOrEqual(2);
        expect(discord.stats.bucket429).toBe(0);
    });

    test("burst after reset: instances waking together send at most the limit", async () => {
        const redis = createFakeRedis();
        const discord = createFakeDiscord({
            limit: 3,
            windowMs: 100,
            latencyMs: 15,
        });
        const instances = Array.from({ length: 4 }, () =>
            client(discord, {
                store: new RedisRateLimitStore({ client: redis.client() }),
            }),
        );
        await Promise.all(
            instances.flatMap((rest) => [
                post(rest, 3),
                post(rest, 3),
                post(rest, 3),
            ]),
        );
        expect(discord.stats.ok).toBe(12);
        expect(discord.stats.bucket429).toBe(0);
        expect(discord.stats.peak).toBeLessThanOrEqual(3);
    });

    test("routes sharing a learned bucket share its counter", async () => {
        let n = 0;
        const store = new MemoryRateLimitStore();
        const rest = new REST({
            token: TOKEN,
            store,
            transport: new HttpTransport({
                fetch: async () =>
                    new Response("{}", {
                        headers: {
                            "x-ratelimit-bucket": "same",
                            "x-ratelimit-limit": "3",
                            "x-ratelimit-remaining": String(
                                Math.max(0, 2 - n++),
                            ),
                            "x-ratelimit-reset-after": "5",
                        },
                    }),
            }),
        });
        await rest.get("/channels/1/pins");
        await rest.get("/channels/1/messages");
        const fp = tokenFingerprint(TOKEN);
        const bucket = store.getBucket(`${fp}/same|1`)!;
        expect(bucket.remaining).toBe(1);
        expect(bucket.limit).toBe(3);
    });
});

describe("Redis failures", () => {
    test("degraded-local: falls back, says so once, and recovers", async () => {
        const redis = createFakeRedis();
        const events: RESTTelemetryEvent[] = [];
        const warnings: string[] = [];
        console.warn = (message: string) => void warnings.push(message);
        const store = new RedisRateLimitStore({
            client: redis.client(),
            telemetry: { emit: (e) => void events.push(e) },
        });
        expect(store.mode).toBe("distributed");
        redis.fault = "error";
        await store.reserve!("k");
        await store.reserve!("k");
        expect(store.mode).toBe("degraded-local");
        expect(store.diagnostics()).toMatchObject({
            mode: "degraded-local",
            failurePolicy: "degraded-local",
            failures: 2,
        });
        expect(store.diagnostics().lastError).toContain("ECONNREFUSED");
        redis.fault = undefined;
        await store.reserve!("k2");
        expect(store.mode).toBe("distributed");
        expect(warnings).toHaveLength(2);
        expect(
            events
                .filter((e) => e.type === "mode")
                .map((e) => (e as { mode: string }).mode),
        ).toEqual(["degraded-local", "distributed"]);
        expect(events.some((e) => e.type === "store" && !e.ok)).toBe(true);
    });

    test("fail-closed: the request fails with a coordination error and is never sent", async () => {
        const redis = createFakeRedis();
        let sent = 0;
        const rest = new REST({
            token: TOKEN,
            store: new RedisRateLimitStore({
                client: redis.client(),
                failurePolicy: "fail-closed",
            }),
            transport: new HttpTransport({
                fetch: async () => {
                    sent++;
                    return new Response("{}");
                },
            }),
        });
        redis.fault = "error";
        const error = (await rest
            .get("/channels/1")
            .catch((e: unknown) => e)) as RESTError;
        expect(error).toBeInstanceOf(RESTError);
        expect(error.kind).toBe("coordination");
        expect(error.retryable).toBe(true);
        expect(sent).toBe(0);
        expect(rest.diagnostics().mode).toBe("unavailable");
        redis.fault = undefined;
        await rest.get("/channels/1");
        expect(sent).toBe(1);
        expect(rest.diagnostics().mode).toBe("distributed");
    });

    test("a hung command times out instead of hanging the request", async () => {
        const redis = createFakeRedis();
        const store = new RedisRateLimitStore({
            client: redis.client(),
            commandTimeout: 30,
            failurePolicy: "fail-closed",
        });
        redis.fault = "hang";
        const started = Date.now();
        const error = await store.reserve!("k").catch((e: unknown) => e);
        expect((error as RESTError).kind).toBe("coordination");
        expect(Date.now() - started).toBeLessThan(500);
        // Writes after a response never fail the request.
        await store.reconcile!("k", { remaining: 1 });
        await store.setBucketHash("r", "h");
    });

    test("a restart that loses every key is safe: the next request probes", async () => {
        const redis = createFakeRedis();
        const discord = createFakeDiscord({ limit: 2, windowMs: 100 });
        const rest = client(discord, {
            store: new RedisRateLimitStore({ client: redis.client() }),
        });
        await post(rest, 1);
        redis.flush();
        await Promise.all([post(rest, 1), post(rest, 1), post(rest, 1)]);
        expect(discord.stats.bucket429).toBe(0);
    });

    test("a server clock ahead of the client's does not change the waits", async () => {
        const redis = createFakeRedis();
        redis.skewMs = 30_000;
        const discord = createFakeDiscord({ limit: 2, windowMs: 80 });
        const rest = client(discord, {
            store: new RedisRateLimitStore({ client: redis.client() }),
        });
        const started = Date.now();
        await Promise.all(Array.from({ length: 6 }, () => post(rest, 1)));
        expect(discord.stats.bucket429).toBe(0);
        expect(Date.now() - started).toBeLessThan(1000);
    });

    test("verify() and requireAtomic catch a client that cannot reserve", async () => {
        const redis = createFakeRedis();
        await new RedisRateLimitStore({ client: redis.client() }).verify();
        const plain = redis.client({ eval: false });
        const store = new RedisRateLimitStore({ client: plain });
        expect(store.mode).toBe("observational");
        expect(store.verify()).rejects.toThrow(TypeError);
        expect(
            () =>
                new RedisRateLimitStore({ client: plain, requireAtomic: true }),
        ).toThrow(TypeError);
        redis.fault = "error";
        expect(
            new RedisRateLimitStore({ client: redis.client() }).verify(),
        ).rejects.toMatchObject({ kind: "coordination" });
    });

    test("invalid options are refused", () => {
        const c = createFakeRedis().client();
        expect(
            () =>
                new RedisRateLimitStore({
                    client: c,
                    failurePolicy: "maybe" as never,
                }),
        ).toThrow(TypeError);
        expect(
            () => new RedisRateLimitStore({ client: c, commandTimeout: 0 }),
        ).toThrow(RangeError);
        expect(
            () => new RateLimiter(new MemoryRateLimitStore(), { probeMs: 0 }),
        ).toThrow(RangeError);
    });

    test("a reply the store cannot read is an error, never a grant", async () => {
        const store = new RedisRateLimitStore({
            client: {
                ...createFakeRedis().client(),
                eval: async () => "OK",
            },
            failurePolicy: "fail-closed",
        });
        expect(store.reserve!("k")).rejects.toMatchObject({
            kind: "coordination",
        });
    });
});

describe("a store that keeps refusing", () => {
    function refusing(reservation: () => Reservation | Promise<Reservation>) {
        let sent = 0;
        const store: RateLimitStore = {
            getBucketHash: () => undefined,
            setBucketHash: () => {},
            getBucket: () => undefined,
            updateBucket: () => {},
            getGlobalReset: () => 0,
            setGlobalReset: () => {},
            reserve: reservation,
        };
        const rest = new REST({
            token: TOKEN,
            store,
            transport: new HttpTransport({
                fetch: async () => {
                    sent++;
                    return new Response("{}");
                },
            }),
        });
        return { rest, sent: () => sent };
    }

    test("refusals without a wait end in a coordination error, nothing sent", async () => {
        const { rest, sent } = refusing(() => ({
            granted: false,
            retryAfterMs: 0,
        }));
        const error = (await rest
            .get("/channels/1")
            .catch((e: unknown) => e)) as RESTError;
        expect(error.kind).toBe("coordination");
        expect(sent()).toBe(0);
    });

    test("a script error ends in a coordination error, nothing sent", async () => {
        const { rest, sent } = refusing(() => {
            throw new Error("ERR script");
        });
        const error = (await rest
            .get("/channels/1")
            .catch((e: unknown) => e)) as RESTError;
        expect(error.kind).toBe("coordination");
        expect(sent()).toBe(0);
    });

    test("an invalid reservation ends in a coordination error", async () => {
        const { rest, sent } = refusing(() => "yes" as never);
        expect(
            ((await rest.get("/c").catch((e: unknown) => e)) as RESTError).kind,
        ).toBe("coordination");
        expect(sent()).toBe(0);
    });

    test("refusals with a wait keep waiting and honour cancellation", async () => {
        const { rest, sent } = refusing(() => ({
            granted: false,
            retryAfterMs: 20,
        }));
        const error = (await rest
            .get("/channels/1", { signal: AbortSignal.timeout(80) })
            .catch((e: unknown) => e)) as RESTError;
        expect(error.kind).toBe("aborted");
        expect(sent()).toBe(0);
    });

    test("refusals never wait beyond twice maxBackoff", async () => {
        const { rest, sent } = refusing(() => ({
            granted: false,
            retryAfterMs: 30,
        }));
        const fast = new REST({
            token: TOKEN,
            store: rest.store,
            maxBackoff: 40,
            transport: new HttpTransport({
                fetch: async () => new Response("{}"),
            }),
        });
        const error = (await fast
            .get("/channels/1")
            .catch((e: unknown) => e)) as RESTError;
        expect(error.kind).toBe("rateLimited");
        expect(sent()).toBe(0);
    });
});

describe("cancellation", () => {
    function slow(ms: number) {
        return new HttpTransport({
            fetch: (_url, init) =>
                new Promise<Response>((resolve, reject) => {
                    const t = setTimeout(() => resolve(new Response("{}")), ms);
                    init.signal?.addEventListener("abort", () => {
                        clearTimeout(t);
                        reject(init.signal!.reason);
                    });
                }),
        });
    }

    test("before dispatch, while queued, while waiting, during transport and between retries", async () => {
        const events: RESTTelemetryEvent[] = [];
        const store = new MemoryRateLimitStore();
        const rest = new REST({
            token: TOKEN,
            store,
            concurrentBuckets: false,
            telemetry: { emit: (e) => void events.push(e) },
            transport: slow(60),
        });
        // Already aborted: refused before anything is queued.
        expect(
            (
                (await rest
                    .get("/channels/1", { signal: AbortSignal.abort() })
                    .catch((e: unknown) => e)) as RESTError
            ).kind,
        ).toBe("aborted");

        // Queued behind a slow request.
        const first = rest.get("/channels/1");
        const queued = new AbortController();
        const second = rest
            .get("/channels/1", { signal: queued.signal })
            .catch((e: unknown) => e);
        await Bun.sleep(10);
        queued.abort();
        expect(((await second) as RESTError).kind).toBe("aborted");

        // During transport.
        const inTransport = new AbortController();
        const third = rest
            .get("/channels/2", { signal: inTransport.signal })
            .catch((e: unknown) => e);
        await Bun.sleep(10);
        inTransport.abort();
        expect(((await third) as RESTError).kind).toBe("aborted");
        await first;

        // While waiting on a spent bucket.
        store.updateBucket(`${tokenFingerprint(TOKEN)}/GET:/channels/:id|3`, {
            remaining: 0,
            resetAt: Date.now() + 5_000,
        });
        const waiting = await rest
            .get("/channels/3", { signal: AbortSignal.timeout(30) })
            .catch((e: unknown) => e);
        expect((waiting as RESTError).kind).toBe("aborted");

        const stages = events
            .filter((e) => e.type === "cancelled")
            .map((e) => (e as { stage: string }).stage);
        expect(stages).toContain("queued");
        expect(stages).toContain("transport");
        expect(stages).toContain("waiting");
        expect(rest.diagnostics()).toMatchObject({ inFlight: 0, queued: 0 });
    });

    test("between retries", async () => {
        const events: RESTTelemetryEvent[] = [];
        const rest = new REST({
            token: TOKEN,
            telemetry: { emit: (e) => void events.push(e) },
            retryPolicy: {
                maxRetries: 3,
                shouldRetry: () => true,
                getDelay: () => 1_000,
            },
            transport: new HttpTransport({
                fetch: async () => new Response("{}", { status: 500 }),
            }),
        });
        const error = await rest
            .get("/channels/1", { signal: AbortSignal.timeout(50) })
            .catch((e: unknown) => e);
        expect((error as RESTError).kind).toBe("aborted");
        expect(events).toContainEqual({ type: "cancelled", stage: "retry" });
    });

    test("a probe cancelled in transport frees the unknown bucket at once", async () => {
        const store = new MemoryRateLimitStore();
        const rest = new REST({ token: TOKEN, store, transport: slow(200) });
        const controller = new AbortController();
        const probe = rest
            .get("/channels/9", { signal: controller.signal })
            .catch(() => undefined);
        await Bun.sleep(10);
        controller.abort();
        await probe;
        const key = `${tokenFingerprint(TOKEN)}/GET:/channels/:id|9`;
        expect(store.getBucket(key)).toBeUndefined();
    });

    test("a unit reserved for a request that never left is given back", async () => {
        const store = new MemoryRateLimitStore();
        const limiter = new RateLimiter(store);
        store.updateBucket("k", { remaining: 2, resetAt: Date.now() + 5_000 });
        const grant = await limiter.acquire("k", undefined, "/p");
        expect(store.getBucket("k")!.remaining).toBe(1);
        await limiter.releaseGrant("k", grant, true);
        expect(store.getBucket("k")!.remaining).toBe(2);
        // A request that may have reached Discord keeps its unit spent.
        const sent = await limiter.acquire("k", undefined, "/p");
        await limiter.releaseGrant("k", sent, false);
        expect(store.getBucket("k")!.remaining).toBe(1);
    });
});

describe("queues and shutdown", () => {
    function held() {
        const gates: Array<() => void> = [];
        const transport = new HttpTransport({
            fetch: () =>
                new Promise<Response>((resolve) =>
                    gates.push(() => resolve(new Response("{}"))),
                ),
        });
        return {
            transport,
            open: () => gates.splice(0).forEach((g) => g()),
            count: () => gates.length,
        };
    }

    test("a full queue refuses with kind overloaded", async () => {
        const h = held();
        const rest = new REST({
            token: TOKEN,
            maxQueuedPerBucket: 1,
            maxQueued: 2,
            transport: h.transport,
        });
        const a = rest.get("/channels/1");
        const b = rest.get("/channels/1");
        const c = (await rest
            .get("/channels/1")
            .catch((e: unknown) => e)) as RESTError;
        expect(c.kind).toBe("overloaded");
        expect(c.retryable).toBe(true);
        const d = rest.get("/channels/2");
        const e = rest.get("/channels/2");
        // Two requests wait in all: a third waiting anywhere is refused...
        const f = (await rest
            .get("/channels/2")
            .catch((x: unknown) => x)) as RESTError;
        expect(f.kind).toBe("overloaded");
        // ...but a request on an idle bucket is not waiting, so it runs.
        const g = rest.get("/channels/3");
        for (let i = 0; i < 4; i++) {
            await Bun.sleep(5);
            h.open();
        }
        await Promise.all([a, b, d, e, g]);
        expect(rest.diagnostics().queued).toBe(0);
        expect(() => new REST({ maxQueued: -1 })).toThrow(RangeError);
    });

    test("close() refuses new requests, cancels queued ones and lets sent ones finish", async () => {
        const h = held();
        const rest = new REST({ token: TOKEN, transport: h.transport });
        const sent = rest.get("/channels/1");
        const queued = rest.get("/channels/1").catch((e: unknown) => e);
        await Bun.sleep(5);
        expect(h.count()).toBe(1);
        const closing = rest.close();
        const again = rest.close();
        expect(((await queued) as RESTError).kind).toBe("aborted");
        expect(
            ((await rest.get("/x").catch((e: unknown) => e)) as RESTError).kind,
        ).toBe("aborted");
        let closed = false;
        void closing.then(() => (closed = true));
        await Bun.sleep(5);
        expect(closed).toBe(false);
        h.open();
        expect(await sent).toBe("{}");
        await Promise.all([closing, again]);
        expect(rest.diagnostics()).toMatchObject({ closed: true, inFlight: 0 });
        await rest.close();
    });
});

describe("telemetry", () => {
    test("RESTMetrics aggregates events with bounded labels and no secrets", async () => {
        const metrics = new RESTMetrics({ maxRoutes: 5 });
        const seen: string[] = [];
        const discord = createFakeDiscord({ limit: 50, windowMs: 1000 });
        const rest = client(discord, {
            telemetry: {
                emit: (e) => {
                    seen.push(JSON.stringify(e));
                    metrics.emit(e);
                },
            },
        });
        for (let i = 0; i < 20; i++) await rest.get(`/channels/${i}/pins`);
        await rest.post("/webhooks/1/super-secret-webhook-token", {});
        await rest.put("/channels/1/messages/2/reactions/%F0%9F%91%8D/@me");
        for (let i = 0; i < 10; i++) await rest.get(`/guilds/1/x${i}`);

        const all = seen.join("\n");
        expect(all).not.toContain(TOKEN);
        expect(all).not.toContain(tokenFingerprint(TOKEN));
        expect(all).not.toContain("super-secret-webhook-token");
        expect(all).not.toContain("%F0");

        const snap = metrics.snapshot();
        const routes = new Set(
            Object.keys(snap.counters)
                .filter((k) => k.startsWith("responses_total"))
                .map((k) => /route="([^"]*)"/.exec(k)![1]),
        );
        expect(routes.size).toBeLessThanOrEqual(6);
        expect(routes.has("other")).toBe(true);
        expect(snap.counters['requests_total{method="GET",outcome="ok"}']).toBe(
            30,
        );
        expect(snap.gauges.in_flight).toBe(0);
        const text = metrics.toPrometheus();
        expect(text).toContain("# TYPE lunibee_rest_requests_total counter");
        expect(text).toContain("lunibee_rest_request_latency_ms_bucket");
        expect(text).toContain('le="+Inf"');
        metrics.reset();
        expect(metrics.snapshot().counters).toEqual({});
    });

    test("every event type is aggregated", () => {
        const metrics = new RESTMetrics();
        const events: RESTTelemetryEvent[] = [
            { type: "rateLimited", route: "r", scope: "user", retryAfterMs: 5 },
            { type: "wait", reason: "bucket", durationMs: 3 },
            { type: "reservation", granted: false, known: true, latencyMs: 1 },
            { type: "retry", route: "r", reason: "server", attempt: 0 },
            { type: "cancelled", stage: "queued" },
            { type: "overloaded" },
            { type: "networkError", timedOut: true },
            { type: "bucket", change: "remapped", route: "r" },
            {
                type: "store",
                operation: "reserve",
                latencyMs: 99999,
                ok: false,
            },
            { type: "mode", mode: "degraded-local", previous: "distributed" },
            { type: "queue", queued: 3, inFlight: 4 },
        ];
        for (const e of events) metrics.emit(e);
        const snap = metrics.snapshot();
        expect(Object.keys(snap.counters).length).toBeGreaterThanOrEqual(10);
        expect(snap.gauges).toEqual({ degraded: 1, queued: 3, in_flight: 4 });
        expect(
            snap.histograms['store_latency_ms{operation="reserve"}']!.buckets[
                "+Inf"
            ],
        ).toBe(1);
    });

    test("a throwing telemetry sink cannot break a request", async () => {
        const rest = new REST({
            token: TOKEN,
            telemetry: {
                emit: () => {
                    throw new Error("sink down");
                },
            },
            transport: new HttpTransport({
                fetch: async () => new Response("{}"),
            }),
        });
        expect(await rest.get<string>("/channels/1")).toBe("{}");
    });
});

describe("memory stays bounded", () => {
    test("10,000 requests over 5,000 channels leave no queue state behind", async () => {
        const store = new MemoryRateLimitStore();
        const rest = new REST({
            token: TOKEN,
            store,
            globalLimit: false,
            transport: new HttpTransport({
                fetch: async () =>
                    new Response("{}", {
                        headers: {
                            "x-ratelimit-bucket": "h",
                            "x-ratelimit-limit": "5",
                            "x-ratelimit-remaining": "4",
                            "x-ratelimit-reset-after": "0.001",
                        },
                    }),
            }),
        });
        const signal = new AbortController().signal;
        for (let round = 0; round < 10; round++)
            await Promise.all(
                Array.from({ length: 1000 }, (_, i) =>
                    rest.get(
                        `/channels/${(round * 1000 + i) % 5000}/messages`,
                        {
                            signal,
                        },
                    ),
                ),
            );
        expect(rest.diagnostics()).toMatchObject({
            queued: 0,
            inFlight: 0,
            buckets: 0,
        });
        expect(store.size).toBeLessThanOrEqual(10_000);
        store.prune(0);
        await Bun.sleep(5);
        store.prune(0);
        expect(store.size).toBe(0);
    });
});

describe("Redis adapters and release", () => {
    test("fromBunRedis maps every command onto send()", async () => {
        const sent: Array<[string, string[]]> = [];
        const c = fromBunRedis({
            send: async (command, args) => {
                sent.push([command, args]);
                return command === "MGET" ? [null] : "OK";
            },
        });
        await c.get("a");
        await c.mget(["a"]);
        await c.set("a", 1);
        await c.set("a", "v", "PX", 5);
        await c.del("a", "b");
        await c.eval!("return 1", 1, "k", 2);
        await c.evalsha!("abc", 0);
        expect(sent).toEqual([
            ["GET", ["a"]],
            ["MGET", ["a"]],
            ["SET", ["a", "1"]],
            ["SET", ["a", "v", "PX", "5"]],
            ["DEL", ["a", "b"]],
            ["EVAL", ["return 1", "1", "k", "2"]],
            ["EVALSHA", ["abc", "0"]],
        ]);
    });

    test("a cancelled probe clears its Redis placeholder; an unsent unit is refunded", async () => {
        const redis = createFakeRedis();
        const s = new RedisRateLimitStore({ client: redis.client() });
        const probe = await s.reserve!("p");
        await s.release!("p", probe as { resetAt: number }, false);
        expect(await s.getBucket("p")).toBeUndefined();
        await s.reconcile!("u", { remaining: 2, resetAfterMs: 5000, limit: 2 });
        const unit = await s.reserve!("u");
        await s.release!("u", unit as { resetAt: number }, true);
        expect((await s.getBucket("u"))!.remaining).toBe(2);
        // A grant without a window has nothing to give back.
        await s.release!("u", {}, true);
        expect((await s.getBucket("u"))!.remaining).toBe(2);
    });

    test("a store that grants without saying whether the limit is known is looked up", async () => {
        const memory = new MemoryRateLimitStore();
        const store: RateLimitStore = {
            getBucketHash: () => undefined,
            setBucketHash: () => {},
            getBucket: (k) => memory.getBucket(k),
            updateBucket: (k, v) => memory.updateBucket(k, v),
            getGlobalReset: () => 0,
            setGlobalReset: () => {},
            reserve: () => ({ granted: true }),
        };
        const limiter = new RateLimiter(store);
        expect(await limiter.acquire("k", undefined, "/p")).toEqual({
            reserved: true,
            known: false,
            resetAt: undefined,
        });
        memory.updateBucket("k", { remaining: 1, resetAt: Date.now() + 1000 });
        expect((await limiter.acquire("k", undefined, "/p")).known).toBe(true);
    });
});

describe("bucket hashes that differ or change", () => {
    test("a route whose hash differs per channel is not split across keys", async () => {
        const windows = new Map<string, { start: number; used: number }>();
        let limited = 0;
        const rest = new REST({
            token: TOKEN,
            retries: 10,
            transport: new HttpTransport({
                fetch: async (url) => {
                    await Bun.sleep(5);
                    const channel = /channels\/(\d+)/.exec(url)![1]!;
                    const now = Date.now();
                    let w = windows.get(channel);
                    if (!w || now - w.start >= 100)
                        windows.set(channel, (w = { start: now, used: 0 }));
                    const resetAfter = (w.start + 100 - now) / 1000;
                    const headers = {
                        "x-ratelimit-bucket": `hash-${channel}`,
                        "x-ratelimit-limit": "3",
                        "x-ratelimit-reset-after": resetAfter.toFixed(3),
                    };
                    if (w.used >= 3) {
                        limited++;
                        return new Response("{}", {
                            status: 429,
                            headers: { ...headers, "retry-after": "0" },
                        });
                    }
                    w.used++;
                    return new Response("{}", {
                        headers: {
                            ...headers,
                            "x-ratelimit-remaining": String(3 - w.used),
                        },
                    });
                },
            }),
        });
        await Promise.all(
            Array.from({ length: 4 }, (_, c) =>
                Array.from({ length: 9 }, () =>
                    rest.get(`/channels/${c + 1}/messages`),
                ),
            ).flat(),
        );
        expect(limited).toBe(0);
    });
});

describe("against the fake Discord's own limits", () => {
    test("uncoordinated instances overshoot, recover through 429s, and the global limit is honoured", async () => {
        const discord = createFakeDiscord({
            limit: 2,
            windowMs: 100,
            globalPerSecond: 8,
        });
        // Two stores: the instances do not coordinate, so Discord says no.
        const a = client(discord, { store: new MemoryRateLimitStore() });
        const b = client(discord, { store: new MemoryRateLimitStore() });
        await Promise.all(
            [a, b].flatMap((rest) =>
                Array.from({ length: 5 }, (_, i) => post(rest, 1 + (i % 3))),
            ),
        );
        expect(discord.stats.ok).toBe(10);
        expect(
            discord.stats.bucket429 + discord.stats.global429,
        ).toBeGreaterThan(0);
        discord.reset();
        expect(discord.stats.requests).toBe(0);
    });

    test("the HTTP fake answers a real request", async () => {
        const discord = startFakeDiscord({ limit: 1, windowMs: 1000 });
        try {
            const rest = new REST({ token: TOKEN, baseURL: discord.url });
            await rest.get("/channels/1/messages");
            expect(discord.stats.ok).toBe(1);
        } finally {
            discord.stop();
        }
    });
});

describe("proactive global limit", () => {
    async function burst(rest: REST, n: number) {
        const started = Date.now();
        await Promise.all(
            Array.from({ length: n }, (_, i) => rest.get(`/channels/${i}`)),
        );
        return Date.now() - started;
    }
    const ok = () =>
        new HttpTransport({ fetch: async () => new Response("{}") });

    test("holds a bot to globalLimit per second across buckets", async () => {
        const rest = new REST({
            token: TOKEN,
            globalLimit: 5,
            transport: ok(),
        });
        expect(await burst(rest, 5)).toBeLessThan(500);
        // The sixth to tenth wait for the next second.
        const store = rest.store as MemoryRateLimitStore;
        const fast = new REST({
            token: TOKEN,
            store,
            globalLimit: 5,
            transport: ok(),
        });
        expect(await burst(fast, 3)).toBeGreaterThan(500);
    });

    test("defaults to 50 and can be turned off", async () => {
        const capped = new REST({ token: TOKEN, transport: ok() });
        expect(await burst(capped, 51)).toBeGreaterThan(500);
        const free = new REST({
            token: TOKEN,
            globalLimit: false,
            transport: ok(),
        });
        expect(await burst(free, 200)).toBeLessThan(500);
        expect(() => new REST({ globalLimit: -1 })).toThrow(RangeError);
    });

    test("is per bot, and interaction callbacks do not count", async () => {
        const store = new MemoryRateLimitStore();
        const a = new REST({
            token: "bot.a",
            store,
            globalLimit: 2,
            transport: ok(),
        });
        const b = new REST({
            token: "bot.b",
            store,
            globalLimit: 2,
            transport: ok(),
        });
        await burst(a, 2);
        expect(await burst(b, 2)).toBeLessThan(500);
        const started = Date.now();
        await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
                a.post(`/interactions/${i}/tok/callback`, { type: 1 }),
            ),
        );
        expect(Date.now() - started).toBeLessThan(500);
    });

    test("is shared through Redis by every process", async () => {
        const redis = createFakeRedis();
        const make = () =>
            new REST({
                token: TOKEN,
                globalLimit: 4,
                store: new RedisRateLimitStore({ client: redis.client() }),
                transport: ok(),
            });
        await burst(make(), 4);
        expect(await burst(make(), 1)).toBeGreaterThan(300);
    });

    test("a store that cannot count it is limited in-process", async () => {
        const memory = new MemoryRateLimitStore();
        const plain: RateLimitStore = {
            getBucketHash: (r) => memory.getBucketHash(r),
            setBucketHash: (r, h) => memory.setBucketHash(r, h),
            getBucket: (k) => memory.getBucket(k),
            updateBucket: (k, v) => memory.updateBucket(k, v),
            getGlobalReset: () => 0,
            setGlobalReset: () => {},
        };
        const observed = new REST({
            token: TOKEN,
            store: plain,
            globalLimit: 3,
            transport: ok(),
        });
        expect(await burst(observed, 6)).toBeGreaterThan(500);
        const reserving = new REST({
            token: TOKEN,
            store: {
                ...plain,
                reserve: () => ({ granted: true, known: true }),
            },
            globalLimit: 3,
            transport: ok(),
        });
        expect(await burst(reserving, 6)).toBeGreaterThan(500);
    });
});

describe("invalid token guard", () => {
    function counting(status: number, headers: Record<string, string> = {}) {
        let sent = 0;
        const transport = new HttpTransport({
            fetch: async () => {
                sent++;
                return new Response(JSON.stringify({ message: "x", code: 0 }), {
                    status,
                    headers: { "content-type": "application/json", ...headers },
                });
            },
        });
        return { transport, sent: () => sent };
    }

    test("after a 401 the token is not used again until setToken()", async () => {
        const events: RESTTelemetryEvent[] = [];
        const c = counting(401);
        const rest = new REST({
            token: TOKEN,
            transport: c.transport,
            telemetry: { emit: (e) => void events.push(e) },
        });
        await rest.get("/users/@me").catch(() => undefined);
        const error = (await rest
            .get("/channels/1")
            .catch((e: unknown) => e)) as RESTError;
        expect(error.kind).toBe("authentication");
        expect(error.status).toBe(401);
        expect(c.sent()).toBe(1);
        expect(rest.diagnostics()).toMatchObject({
            tokenRejected: true,
            invalidRequests: 1,
        });
        expect(events).toContainEqual({ type: "tokenRejected" });
        // Token webhooks and unauthenticated requests are not that token's.
        await rest.post("/webhooks/1/tok", {}).catch(() => undefined);
        await rest.get("/gateway", { auth: false }).catch(() => undefined);
        expect(c.sent()).toBe(3);
        rest.setToken("a.new.token");
        expect(rest.diagnostics().tokenRejected).toBe(false);
        await rest.get("/channels/1").catch(() => undefined);
        expect(c.sent()).toBe(4);
    });

    test("stopOnInvalidToken: false keeps sending", async () => {
        const c = counting(401);
        const rest = new REST({
            token: TOKEN,
            stopOnInvalidToken: false,
            transport: c.transport,
        });
        await rest.get("/a").catch(() => undefined);
        await rest.get("/b").catch(() => undefined);
        expect(c.sent()).toBe(2);
    });

    test("403 and 429 count as invalid requests; shared-scope 429s do not", async () => {
        const forbidden = counting(403);
        const rest = new REST({
            token: TOKEN,
            retries: 0,
            transport: forbidden.transport,
        });
        await rest.get("/a").catch(() => undefined);
        await rest.get("/b").catch(() => undefined);
        expect(rest.diagnostics().invalidRequests).toBe(2);
        const shared = counting(429, {
            "x-ratelimit-scope": "shared",
            "retry-after": "0",
        });
        const s = new REST({
            token: TOKEN,
            retries: 0,
            transport: shared.transport,
        });
        await s.get("/a").catch(() => undefined);
        expect(s.diagnostics().invalidRequests).toBe(0);
    });

    test("the count forgets responses older than ten minutes", async () => {
        const c = counting(403);
        const rest = new REST({ token: TOKEN, transport: c.transport });
        const now = Date.now;
        try {
            await rest.get("/a").catch(() => undefined);
            Date.now = () => now() + 5 * 60_000;
            await rest.get("/b").catch(() => undefined);
            expect(rest.diagnostics().invalidRequests).toBe(2);
            Date.now = () => now() + 11 * 60_000;
            expect(rest.diagnostics().invalidRequests).toBe(1);
            Date.now = () => now() + 60 * 60_000;
            expect(rest.diagnostics().invalidRequests).toBe(0);
        } finally {
            Date.now = now;
        }
    });

    test("RESTMetrics counts rejected tokens", () => {
        const m = new RESTMetrics();
        m.emit({ type: "tokenRejected" });
        expect(m.snapshot().counters.token_rejected_total).toBe(1);
    });
});

describe("hostile rate-limit headers", () => {
    test("an absurd limit or remaining is ignored", () => {
        const parsed = parseRateLimitHeaders(
            new Headers({
                "x-ratelimit-limit": "1e308",
                "x-ratelimit-remaining": "100001",
            }),
        );
        expect(parsed.limit).toBeUndefined();
        expect(parsed.remaining).toBeUndefined();
    });

    test("a window id far from now cannot make real responses stale", async () => {
        const store = new MemoryRateLimitStore();
        const limiter = new RateLimiter(store, { maxBackoff: 60_000 });
        const res = (remaining: number, reset: number) =>
            new Response("{}", {
                headers: {
                    "x-ratelimit-remaining": String(remaining),
                    "x-ratelimit-reset-after": "5",
                    "x-ratelimit-reset": String(reset),
                },
            });
        const now = Date.now() / 1000;
        await limiter.applyResponse(res(4, now + 1e9), "k", "r", "@none");
        expect(store.getBucket("k")!.window).toBeUndefined();
        await limiter.applyResponse(res(1, now + 5), "k", "r", "@none");
        expect(store.getBucket("k")!.remaining).toBe(1);
    });
});

describe("EVALSHA", () => {
    test("scripts run by SHA-1 after the first load, and reload after a flush", async () => {
        const redis = createFakeRedis();
        const store = new RedisRateLimitStore({ client: redis.client() });
        await store.reserve!("a");
        expect(redis.ops.get("EVAL")).toBe(1); // NOSCRIPT once, then loaded
        await store.reserve!("b");
        await store.reconcile!("b", { remaining: 1, resetAfterMs: 1000 });
        await store.reconcile!("b", { remaining: 0, resetAfterMs: 1000 });
        expect(redis.ops.get("EVAL")).toBe(2); // the reconcile script, once
        expect(redis.ops.get("EVALSHA")).toBe(4); // two hit NOSCRIPT
        redis.flushScripts();
        await store.reserve!("c");
        expect(redis.ops.get("EVAL")).toBe(3);
        expect((await store.getBucket("c"))?.probe).toBe(true);
    });

    test("a client without evalsha uses eval; other errors are not retried as eval", async () => {
        const redis = createFakeRedis();
        const plain = new RedisRateLimitStore({
            client: redis.client({ evalsha: false }),
        });
        await plain.reserve!("a");
        await plain.reserve!("b");
        expect(redis.ops.get("EVALSHA")).toBeUndefined();
        expect(redis.ops.get("EVAL")).toBe(2);
        const failing = new RedisRateLimitStore({
            client: {
                ...redis.client(),
                evalsha: async () => {
                    throw new Error("ERR something else");
                },
            },
            failurePolicy: "fail-closed",
        });
        const before = redis.ops.get("EVAL");
        expect(failing.reserve!("x")).rejects.toMatchObject({
            kind: "coordination",
        });
        await Bun.sleep(5);
        expect(redis.ops.get("EVAL")).toBe(before);
    });
});

describe("maxQueueWait", () => {
    test("a request that waits too long for its bucket fails as overloaded, unsent", async () => {
        const store = new MemoryRateLimitStore();
        let sent = 0;
        const rest = new REST({
            token: TOKEN,
            store,
            maxQueueWait: 50,
            transport: new HttpTransport({
                fetch: async () => {
                    sent++;
                    return new Response("{}");
                },
            }),
        });
        store.updateBucket(`${tokenFingerprint(TOKEN)}/GET:/channels/:id|1`, {
            remaining: 0,
            resetAt: Date.now() + 5_000,
        });
        const started = Date.now();
        const error = (await rest
            .get("/channels/1")
            .catch((e: unknown) => e)) as RESTError;
        expect(error.kind).toBe("overloaded");
        expect(error.message).toContain("maxQueueWait (50ms)");
        expect(Date.now() - started).toBeLessThan(1000);
        expect(sent).toBe(0);
        // Per request, it can be raised or lowered; unset, nothing changes.
        expect(
            await rest.get<string>("/channels/2", { maxQueueWait: 1000 }),
        ).toBe("{}");
        expect(() => new REST({ maxQueueWait: -1 })).toThrow(RangeError);
        expect(rest.get("/x", { maxQueueWait: Number.NaN })).rejects.toThrow(
            RangeError,
        );
        const free = new REST({
            token: TOKEN,
            transport: new HttpTransport({
                fetch: async () => new Response("{}"),
            }),
        });
        expect(await free.get<string>("/a")).toBe("{}");
    });

    test("it also bounds the pause between retries, and a caller abort stays an abort", async () => {
        const rest = new REST({
            token: TOKEN,
            maxQueueWait: 60,
            retryPolicy: {
                maxRetries: 3,
                shouldRetry: () => true,
                getDelay: () => 1_000,
            },
            transport: new HttpTransport({
                fetch: async () => new Response("{}", { status: 500 }),
            }),
        });
        expect(
            ((await rest.get("/a").catch((e: unknown) => e)) as RESTError).kind,
        ).toBe("overloaded");
        expect(
            (
                (await rest
                    .get("/b", { signal: AbortSignal.timeout(10) })
                    .catch((e: unknown) => e)) as RESTError
            ).kind,
        ).toBe("aborted");
    });
});
