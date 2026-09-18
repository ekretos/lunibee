import { describe, expect, test } from "bun:test";
import {
    REST,
    RESTError,
    RateLimiter,
    RequestScheduler,
    ResponseDecoder,
    HttpTransport,
    TransportError,
    MemoryRateLimitStore,
    createRouteKey,
    scopeBucket,
    type TransportRequest,
} from "../packages/rest/src/index.ts";

/**
 * The REST pipeline is now Route → Scheduler → Limiter → Transport → Decoder.
 * These tests target each stage on its own, which the monolithic class could
 * not support: every rate-limit or retry assertion had to go through `fetch`.
 */
describe("RouteKey", () => {
    test("separates route shape from major parameter", () => {
        const key = createRouteKey("get", "/channels/123/messages/456");
        expect(key.method).toBe("GET");
        expect(key.route).toBe("GET:/channels/:id/messages/:id");
        expect(key.major).toBe("123");
    });

    test("scopes webhooks by id and token, and unscoped routes by @none", () => {
        expect(createRouteKey("POST", "/webhooks/12/abc").major).toBe("12:abc");
        expect(createRouteKey("GET", "/users/@me").major).toBe("@none");
    });

    test("two channels on one endpoint get independent bucket keys", () => {
        const a = createRouteKey("POST", "/channels/1/messages");
        const b = createRouteKey("POST", "/channels/2/messages");
        expect(a.route).toBe(b.route);
        expect(scopeBucket("hash", a.major)).not.toBe(
            scopeBucket("hash", b.major),
        );
    });
});

describe("RequestScheduler", () => {
    test("serialises work per key and runs distinct keys concurrently", async () => {
        const scheduler = new RequestScheduler();
        const order: string[] = [];
        const slow = scheduler.run("a", undefined, "/a", async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            order.push("a1");
        });
        const queued = scheduler.run("a", undefined, "/a", async () => {
            order.push("a2");
        });
        const other = scheduler.run("b", undefined, "/b", async () => {
            order.push("b1");
        });
        await Promise.all([slow, queued, other]);
        expect(order).toEqual(["b1", "a1", "a2"]);
        expect(scheduler.size).toBe(0);
    });

    test("releases the slot when a task throws", async () => {
        const scheduler = new RequestScheduler();
        await expect(
            scheduler.run("a", undefined, "/a", async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        await expect(
            scheduler.run("a", undefined, "/a", async () => "ok"),
        ).resolves.toBe("ok");
        expect(scheduler.size).toBe(0);
    });

    test("an abort while queued frees the key for later work", async () => {
        const scheduler = new RequestScheduler();
        const controller = new AbortController();
        const blocking = scheduler.run("a", undefined, "/a", async () => {
            await new Promise((resolve) => setTimeout(resolve, 40));
        });
        const aborted = scheduler.run(
            "a",
            controller.signal,
            "/a",
            async () => "never",
        );
        controller.abort();
        await expect(aborted).rejects.toBeInstanceOf(RESTError);
        await blocking;
        await expect(
            scheduler.run("a", undefined, "/a", async () => "ok"),
        ).resolves.toBe("ok");
    });
});

describe("RateLimiter", () => {
    function headers(values: Record<string, string>): Response {
        return new Response("{}", { status: 200, headers: values });
    }

    test("adopts the server bucket hash and keeps the major parameter", async () => {
        const limiter = new RateLimiter(new MemoryRateLimitStore());
        const route = createRouteKey("POST", "/channels/99/messages");
        const before = await limiter.resolveBucketKey(route.route, route.major);
        expect(before).toBe(scopeBucket(route.route, "99"));

        const after = await limiter.applyResponse(
            headers({
                "X-RateLimit-Bucket": "abcdef",
                "X-RateLimit-Remaining": "4",
                "X-RateLimit-Reset-After": "1",
            }),
            before,
            route.route,
            route.major,
        );
        expect(after).toBe("abcdef|99");
        // A second request on the same route now resolves straight to the hash.
        expect(await limiter.resolveBucketKey(route.route, route.major)).toBe(
            "abcdef|99",
        );
        expect((await limiter.store.getBucket(after))?.remaining).toBe(4);
    });

    test("waits out an exhausted bucket and honours cancellation", async () => {
        const store = new MemoryRateLimitStore();
        const limiter = new RateLimiter(store);
        store.updateBucket("k", { remaining: 0, resetAt: Date.now() + 60 });

        const start = Date.now();
        await limiter.acquire("k", undefined, "/p");
        expect(Date.now() - start).toBeGreaterThanOrEqual(40);

        store.updateBucket("k", { remaining: 0, resetAt: Date.now() + 5_000 });
        const controller = new AbortController();
        const pending = limiter.acquire("k", controller.signal, "/p");
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(RESTError);
    });

    test("never shortens a global reset already recorded", async () => {
        const limiter = new RateLimiter(new MemoryRateLimitStore());
        const far = Date.now() + 10_000;
        await limiter.noteGlobalReset(far);
        await limiter.noteGlobalReset(Date.now() + 100);
        expect(await limiter.store.getGlobalReset()).toBe(far);
    });
});

describe("ResponseDecoder", () => {
    const decoder = new ResponseDecoder();

    test("decodes JSON, text and empty bodies", async () => {
        expect(
            await decoder.read(
                new Response(JSON.stringify({ a: 1 }), {
                    headers: { "content-type": "application/json" },
                }),
            ),
        ).toEqual({ a: 1 });
        expect(await decoder.read(new Response("plain"))).toBe("plain");
        expect(await decoder.read(new Response(null, { status: 204 }))).toBe(
            undefined,
        );
    });

    test("prefers the payload retry_after over the header, defaulting to 1s", () => {
        const response = new Response("{}", {
            status: 429,
            headers: { "Retry-After": "3" },
        });
        expect(decoder.retryAfter(response, { retry_after: 0.25 })).toBe(0.25);
        expect(decoder.retryAfter(response, {})).toBe(3);
        expect(
            decoder.retryAfter(new Response("{}", { status: 429 }), {}),
        ).toBe(1);
    });

    test("extracts Discord error metadata defensively", () => {
        expect(
            decoder.errorData({ message: "Bad", code: 50035, global: true }),
        ).toEqual({
            message: "Bad",
            code: 50035,
            retry_after: undefined,
            global: true,
        });
        expect(decoder.errorData("not an object")).toEqual({});
    });
});

describe("HttpTransport", () => {
    test("resolves paths against the base URL and forwards headers", async () => {
        const seen: Array<{ url: string; init: RequestInit }> = [];
        const transport = new HttpTransport({
            baseURL: "https://example.test/api/",
            fetch: async (url, init) => {
                seen.push({ url, init });
                return new Response("{}", { status: 200 });
            },
        });
        const request: TransportRequest = {
            method: "GET",
            path: "/users/@me",
            headers: { "X-Test": "1" },
        };
        const response = await transport.send(request);
        expect(response.status).toBe(200);
        expect(seen[0]!.url).toBe("https://example.test/api/users/@me");
        expect(
            (seen[0]!.init.headers as Record<string, string>)["X-Test"],
        ).toBe("1");
    });

    test("reports a timeout distinctly from a transport failure", async () => {
        const timing = new HttpTransport({
            timeout: 20,
            fetch: (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () =>
                        reject(
                            (init.signal as AbortSignal).reason ??
                                new DOMException("aborted", "AbortError"),
                        ),
                    );
                }),
        });
        const timedOut = await timing
            .send({ method: "GET", path: "/x", headers: {} })
            .catch((error: unknown) => error);
        expect(timedOut).toBeInstanceOf(TransportError);
        expect((timedOut as TransportError).timedOut).toBe(true);

        const broken = new HttpTransport({
            fetch: async () => {
                throw new Error("ECONNRESET");
            },
        });
        const failed = await broken
            .send({ method: "GET", path: "/x", headers: {} })
            .catch((error: unknown) => error);
        expect(failed).toBeInstanceOf(TransportError);
        expect((failed as TransportError).timedOut).toBe(false);
    });
});

describe("REST composition", () => {
    test("accepts an injected transport, so no global fetch stub is needed", async () => {
        const calls: TransportRequest[] = [];
        const rest = new REST({
            token: "token",
            transport: new HttpTransport({
                fetch: async (url, init) => {
                    calls.push({
                        method: init.method as string,
                        path: url,
                        headers: init.headers as Record<string, string>,
                    });
                    return new Response(JSON.stringify({ id: "1" }), {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    });
                },
            }),
        });
        const result = await rest.get<{ id: string }>("/users/@me", {
            query: { limit: 2 },
        });
        expect(result).toEqual({ id: "1" });
        expect(calls[0]!.path).toContain("/users/@me?limit=2");
        expect(calls[0]!.headers["Authorization"]).toBe("Bot token");
        expect(rest.store).toBeInstanceOf(MemoryRateLimitStore);
    });

    test("retries a 429 against the injected transport and then succeeds", async () => {
        let attempts = 0;
        const rest = new REST({
            token: "token",
            retries: 2,
            transport: new HttpTransport({
                fetch: async () => {
                    attempts++;
                    if (attempts === 1)
                        return new Response(
                            JSON.stringify({ retry_after: 0.01 }),
                            {
                                status: 429,
                                headers: {
                                    "content-type": "application/json",
                                    "Retry-After": "0.01",
                                },
                            },
                        );
                    return new Response(JSON.stringify({ ok: true }), {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    });
                },
            }),
        });
        await expect(rest.post("/channels/1/messages", {})).resolves.toEqual({
            ok: true,
        });
        expect(attempts).toBe(2);
    });
});
