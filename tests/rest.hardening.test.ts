import { expect, test } from "bun:test";
import {
    HttpTransport,
    MemoryRateLimitStore,
    REST,
    RedisRateLimitStore,
    RequestScheduler,
    type BucketState,
    type RateLimitStore,
} from "../packages/rest/src/index.ts";
import { tokenFingerprint } from "../packages/rest/src/identity.ts";
import { createFakeRedis } from "./helpers/fake-redis.ts";

const json = (headers: Record<string, string> = {}, status = 200) =>
    new Response("{}", {
        status,
        headers: { "content-type": "application/json", ...headers },
    });

/** A store that only observes (no `reserve`), like a custom or eval-less store. */
function observingStore(): {
    store: RateLimitStore;
    buckets: Map<string, BucketState>;
} {
    const buckets = new Map<string, BucketState>();
    return {
        buckets,
        store: {
            getBucketHash: () => undefined,
            setBucketHash: () => {},
            getBucket: (k) => buckets.get(k),
            updateBucket: (k, s) => void buckets.set(k, s),
            getGlobalReset: () => 0,
            setGlobalReset: () => {},
        },
    };
}

test("aborting a queued request does not let the next one run beside the head", async () => {
    const s = new RequestScheduler();
    let running = 0;
    let max = 0;
    const work = async () => {
        running++;
        max = Math.max(max, running);
        await Bun.sleep(40);
        running--;
    };
    const a = s.run("k", undefined, "/a", work);
    const ctl = new AbortController();
    const b = s.run("k", ctl.signal, "/b", work).catch((e) => e);
    const c = s.run("k", undefined, "/c", work);
    await Bun.sleep(5);
    ctl.abort();
    await Promise.all([a, b, c]);
    expect(max).toBe(1);
    expect((await b).kind).toBe("aborted");
});

test("a worker waiting on another's probe moves to the bucket it revealed", async () => {
    const store = new MemoryRateLimitStore(); // stands in for a shared store
    const sends: number[] = [];
    let windowEnds = 0;
    const transport = () =>
        new HttpTransport({
            fetch: async () => {
                const now = Date.now();
                sends.push(now);
                if (sends.length === 1) {
                    await Bun.sleep(80);
                    windowEnds = Date.now() + 300;
                }
                return json({
                    "X-RateLimit-Limit": "1",
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset-After": "0.3",
                    "X-RateLimit-Bucket": "abcd",
                });
            },
        });
    const w1 = new REST({
        token: "t",
        transport: transport(),
        store,
        retries: 0,
    });
    const w2 = new REST({
        token: "t",
        transport: transport(),
        store,
        retries: 0,
    });
    const a = w1.get("/channels/1/messages");
    await Bun.sleep(10);
    await Promise.all([a, w2.get("/channels/1/messages")]);
    expect(sends).toHaveLength(2);
    // The second send waited for the bucket the first response revealed.
    expect(sends[1]!).toBeGreaterThanOrEqual(windowEnds - 20);
});

test("with a store without reserve, the global slot is taken after the bucket wait", async () => {
    const { store, buckets } = observingStore();
    const sends: number[] = [];
    const transport = new HttpTransport({
        fetch: async () => {
            sends.push(Date.now());
            return json();
        },
    });
    const rest = new REST({ token: "t", transport, store, globalLimit: 2 });
    const t0 = Date.now();
    const fp = tokenFingerprint("t");
    for (const ch of ["1", "2"])
        buckets.set(`${fp}/GET:/channels/:id|${ch}`, {
            remaining: 0,
            resetAt: t0 + 1200,
        });
    const waiting = [rest.get("/channels/1"), rest.get("/channels/2")];
    await Bun.sleep(1100);
    const fresh = [rest.get("/channels/3"), rest.get("/channels/4")];
    await Promise.all([...waiting, ...fresh]);
    sends.sort((a, b) => a - b);
    const worst = Math.max(
        ...sends.map((s) => sends.filter((t) => t >= s && t < s + 1000).length),
    );
    expect(worst).toBeLessThanOrEqual(2);
});

test("degraded-local counts this process's own Redis reservations", async () => {
    const redis = createFakeRedis();
    const store = new RedisRateLimitStore({
        client: redis.client(),
        failurePolicy: "degraded-local",
        commandTimeout: 50,
    });
    const warn = console.warn;
    console.warn = () => {};
    const sends: number[] = [];
    let reset = 0;
    const transport = new HttpTransport({
        fetch: async () => {
            sends.push(Date.now());
            if (sends.length > 1) await Bun.sleep(100);
            return json({
                "X-RateLimit-Limit": "5",
                "X-RateLimit-Remaining": String(Math.max(0, 5 - sends.length)),
                "X-RateLimit-Reset-After": "0.6",
                "X-RateLimit-Bucket": "hh",
            });
        },
    });
    const rest = new REST({
        token: "t",
        transport,
        store,
        globalLimit: false,
        retries: 0,
    });
    try {
        await rest.get("/channels/1");
        reset = Date.now() + 600;
        const inflight = [1, 2, 3, 4].map(() => rest.get("/channels/1"));
        await Bun.sleep(20);
        redis.fault = "error";
        const outage = Date.now();
        const during = [1, 2].map(() =>
            rest.get("/channels/1").catch((e) => e),
        );
        await Promise.all([...inflight, ...during]);
        // Five units were used: the requests made in the outage waited for the reset.
        const early = sends.filter((t) => t >= outage && t < reset - 50);
        expect(early).toHaveLength(0);
        expect(sends).toHaveLength(7);
    } finally {
        console.warn = warn;
    }
});

test("a doubled slash is refused before redaction and routing can miss a token", async () => {
    let fetched = 0;
    const rest = new REST({
        token: "t",
        transport: new HttpTransport({
            fetch: async () => {
                fetched++;
                return json();
            },
        }),
    });
    for (const path of ["//webhooks/1/SECRET", "/channels//1"])
        await expect(rest.post(path, {})).rejects.toThrow(
            "REST paths must not contain empty segments ('//').",
        );
    expect(fetched).toBe(0);
});
