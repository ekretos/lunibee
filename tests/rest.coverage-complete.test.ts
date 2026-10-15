import { describe, expect, test } from "bun:test";
import {
    HttpTransport,
    MemoryRateLimitStore,
    RedisRateLimitStore,
    RequestScheduler,
    ResponseDecoder,
    type MinimalRedisClient,
} from "../packages/rest/src/index.ts";
import { serializeQuery } from "../packages/rest/src/route.ts";

/** Fills the corners of the REST package the behaviour suites do not reach. */
describe("ResponseDecoder", () => {
    const decoder = new ResponseDecoder();

    test("malformed JSON and unreadable text decode to undefined", async () => {
        expect(
            await decoder.read(
                new Response("{not json", {
                    headers: { "content-type": "application/json" },
                }),
            ),
        ).toBeUndefined();
        const broken = new Response(
            new ReadableStream({
                start(controller) {
                    controller.error(new Error("socket reset"));
                },
            }),
        );
        expect(await decoder.read(broken)).toBeUndefined();
        expect(
            await decoder.read(new Response(null, { status: 204 })),
        ).toBeUndefined();
        expect(await decoder.read(new Response("plain"))).toBe("plain");
        const used = new Response("x");
        await used.text();
        expect(await decoder.read(used)).toBeUndefined();
    });

    test("error metadata and Retry-After fallbacks", () => {
        expect(decoder.errorData(null)).toEqual({});
        expect(decoder.errorData("x")).toEqual({});
        expect(
            decoder.errorData({ message: 1, code: "x", retry_after: "2" }),
        ).toEqual({
            message: undefined,
            code: undefined,
            retry_after: undefined,
            global: false,
        });
        const none = new Response(null, { status: 429 });
        expect(decoder.retryAfter(none, {})).toBe(1);
        const header = new Response(null, {
            status: 429,
            headers: { "Retry-After": "3" },
        });
        expect(decoder.retryAfter(header, {})).toBe(3);
        expect(decoder.retryAfter(header, { retry_after: -5 })).toBe(0);
    });
});

describe("RequestScheduler", () => {
    test("size counts held slots and drops idle ones", async () => {
        const scheduler = new RequestScheduler();
        let finish!: () => void;
        const held = scheduler.run(
            "k",
            undefined,
            "/p",
            () => new Promise<void>((resolve) => (finish = resolve)),
        );
        expect(scheduler.size).toBe(1);
        await Bun.sleep(1);
        finish();
        await held;
        expect(scheduler.size).toBe(0);
    });

    test("a key that keeps moving still runs on its last hop", async () => {
        const scheduler = new RequestScheduler();
        let n = 0;
        const keys: string[] = [];
        const value = await scheduler.runResolved(
            async () => `k${n++}`,
            undefined,
            "/p",
            async (key, release) => {
                release();
                release();
                keys.push(key);
                return 42;
            },
        );
        expect(value).toBe(42);
        expect(keys).toHaveLength(1);
    });
});

describe("MemoryRateLimitStore", () => {
    test("every operation", () => {
        const store = new MemoryRateLimitStore();
        expect(store.getBucketHash("r")).toBeUndefined();
        store.setBucketHash("r", "h");
        expect(store.getBucketHash("r")).toBe("h");
        expect(store.reserve("b")).toMatchObject({ granted: true });
        const later = Date.now() + 60_000;
        store.updateBucket("b", {
            remaining: 1,
            limit: 2,
            resetAt: later,
        } as never);
        expect(store.reserve("b")).toMatchObject({ granted: true });
        const denied = store.reserve("b");
        expect(denied.granted).toBe(false);
        store.updateBucket("old", {
            remaining: 0,
            limit: 1,
            resetAt: Date.now() - 10,
        } as never);
        store.prune();
        expect(store.getBucket("old")).toBeUndefined();
        store.prune(120_000);
        expect(store.getBucket("b")).toBeDefined();
        store.setGlobalReset(5);
        expect(store.getGlobalReset()).toBe(5);
    });
});

describe("HttpTransport", () => {
    test("getters and the default fetch", async () => {
        const transport = new HttpTransport({ timeout: 0 });
        expect(transport.timeout).toBe(1);
        expect(transport.baseURL).toBe("https://discord.com/api/v10");
        const original = globalThis.fetch;
        let called = "";
        globalThis.fetch = Object.assign(
            async (input: string | URL | Request) => {
                called = String(input);
                return new Response("{}");
            },
            { preconnect: () => {} },
        ) as typeof fetch;
        try {
            await new HttpTransport().send({
                method: "GET",
                path: "/users/@me",
                headers: {},
            } as never);
            expect(called).toBe("https://discord.com/api/v10/users/@me");
        } finally {
            globalThis.fetch = original;
        }
    });
});

describe("RedisRateLimitStore", () => {
    test("lastError records a failed operation", async () => {
        const failing: MinimalRedisClient = {
            get: () => Promise.reject(new Error("down")),
            mget: () => Promise.reject(new Error("down")),
            set: () => Promise.reject(new Error("down")),
            del: () => Promise.reject(new Error("down")),
        };
        const store = new RedisRateLimitStore({
            client: failing,
            onError: () => {},
        });
        expect(store.lastError).toBeUndefined();
        expect("reserve" in store && typeof store.reserve).not.toBe("function");
        await store.getBucketHash("r");
        expect((store.lastError as Error).message).toBe("down");
    });
});

describe("REST hooks and in-flight abort", () => {
    test("a throwing hook does not reject the request", async () => {
        const { REST } = await import("../packages/rest/src/index.ts");
        let calls = 0;
        const rest = new REST({
            token: "a.b.c-token-0123456789",
            hooks: {
                onRequest: () => {
                    calls++;
                    throw new Error("bad hook");
                },
            },
            transport: new HttpTransport({
                fetch: async () =>
                    new Response("{}", {
                        headers: { "content-type": "application/json" },
                    }),
            }),
        });
        expect(await rest.get<unknown>("/users/@me")).toEqual({});
        await Bun.sleep(1);
        expect(calls).toBe(1);
    });

    test("aborting during fetch aborts the fetch", async () => {
        const controller = new AbortController();
        let seen: AbortSignal | undefined;
        const transport = new HttpTransport({
            fetch: (_url, init) =>
                new Promise<Response>((_resolve, reject) => {
                    seen = init.signal ?? undefined;
                    init.signal?.addEventListener("abort", () =>
                        reject(new DOMException("aborted", "AbortError")),
                    );
                }),
        });
        const pending = transport.send({
            method: "GET",
            path: "/x",
            headers: {},
            signal: controller.signal,
        } as never);
        controller.abort(new Error("stop"));
        await expect(pending).rejects.toThrow();
        expect(seen?.aborted).toBe(true);
    });
});

describe("serializeQuery", () => {
    test("string forms", () => {
        expect(serializeQuery(undefined)).toBe("");
        expect(serializeQuery("")).toBe("");
        expect(serializeQuery("?a=1")).toBe("?a=1");
        expect(serializeQuery("a=1")).toBe("?a=1");
    });
});

describe("onRetry after a network failure", () => {
    test("fires with status 0", async () => {
        const { REST } = await import("../packages/rest/src/index.ts");
        const retries: { status: number; attempt: number }[] = [];
        let calls = 0;
        const rest = new REST({
            token: "a.b.c-token-0123456789",
            retryPolicy: {
                maxRetries: 1,
                shouldRetry: () => true,
                getDelay: () => 1,
            },
            hooks: { onRetry: (ctx) => retries.push(ctx) },
            transport: new HttpTransport({
                fetch: async () => {
                    if (calls++ === 0) throw new Error("socket reset");
                    return new Response("{}", {
                        headers: { "content-type": "application/json" },
                    });
                },
            }),
        });
        await rest.get<unknown>("/users/@me");
        await Bun.sleep(1);
        expect(retries).toMatchObject([{ status: 0, attempt: 0 }]);
    });
});
