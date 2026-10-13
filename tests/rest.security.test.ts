import { describe, expect, test } from "bun:test";
import { getEventListeners } from "node:events";
import { HttpTransport, REST, RESTError } from "../packages/rest/src/index.ts";
import { abortable, sleep } from "../packages/rest/src/errors.ts";

const TOKEN = "OTk5.AAAAAA.token-value-that-must-never-leak-1234";
const WEBHOOK_TOKEN = "wh-secret-0123456789abcdef";

describe("base URL", () => {
    test("accepts https, and plain http only for this machine", () => {
        for (const url of [
            "https://discord.com/api/v10",
            "https://proxy.internal:8443/api/",
            "http://localhost:3000/api",
            "http://127.0.0.1:8080",
            "http://[::1]:8080/api",
        ])
            expect(() => new HttpTransport({ baseURL: url })).not.toThrow();
    });

    test("refuses a URL that would send the token somewhere unsafe", () => {
        const bad = [
            "http://proxy.example.org/api", // cleartext over the network
            "ftp://example.org/api",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "//example.org/api",
            "not a url",
            "",
            "https://user:pass@example.org/api", // credentials in the URL
            "https://example.org/api?x=1", // the path is appended after it
            "https://example.org/api#frag",
        ];
        for (const url of bad)
            expect({
                url,
                threw: threw(() => new HttpTransport({ baseURL: url })),
            }).toEqual({
                url,
                threw: true,
            });
    });

    test("never repeats credentials from the URL in the error", () => {
        try {
            new HttpTransport({ baseURL: "https://user:hunter2@example.org" });
            throw new Error("should have thrown");
        } catch (error) {
            expect(String(error)).not.toContain("hunter2");
            expect(String(error)).toMatch(/baseURL/);
        }
    });

    test("cleartext to a remote host needs an explicit opt-in", () => {
        const url = "http://rest-proxy.internal:8080/api";
        expect(() => new HttpTransport({ baseURL: url })).toThrow(/https/);
        expect(
            () =>
                new HttpTransport({ baseURL: url, allowInsecureBaseURL: true }),
        ).not.toThrow();
        expect(() => new REST({ token: TOKEN, baseURL: url })).toThrow(/https/);
        expect(
            () =>
                new REST({
                    token: TOKEN,
                    baseURL: url,
                    allowInsecureBaseURL: true,
                }),
        ).not.toThrow();
    });

    test("a redirect is never followed, so the token cannot be forwarded", async () => {
        let init: RequestInit | undefined;
        const transport = new HttpTransport({
            fetch: async (_url, i) => {
                init = i;
                return new Response("{}");
            },
        });
        await transport.send({
            method: "GET",
            path: "/users/@me",
            headers: {},
        });
        expect(init?.redirect).toBe("error");
    });
});

describe("secrets in errors and hooks", () => {
    function rest(
        fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
        seen: unknown[],
    ) {
        return new REST({
            token: TOKEN,
            retries: 0,
            transport: new HttpTransport({ fetch: fetchImpl }),
            hooks: {
                onRequest: (c) => seen.push(c),
                onResponse: (c) => seen.push(c),
                onRetry: (c) => seen.push(c),
                onRateLimit: (c) => seen.push(c),
            },
        });
    }
    const everything = (value: unknown): string => {
        const parts: string[] = [];
        let current: unknown = value;
        for (let depth = 0; depth < 6 && current; depth++) {
            if (current instanceof Error)
                parts.push(
                    current.message,
                    current.stack ?? "",
                    String(current),
                    JSON.stringify(
                        current,
                        Object.getOwnPropertyNames(current),
                    ),
                );
            else parts.push(JSON.stringify(current));
            current = (current as { cause?: unknown }).cause;
        }
        return parts.join("\n");
    };

    for (const [name, make] of [
        [
            "a rejected request",
            () =>
                new Response(
                    JSON.stringify({ message: "Unknown Webhook", code: 10015 }),
                    { status: 404 },
                ),
        ],
        ["a server error", () => new Response("oops", { status: 500 })],
        [
            "a rate limit",
            () =>
                new Response(
                    JSON.stringify({ retry_after: 0.01, global: false }),
                    {
                        status: 429,
                        headers: { "retry-after": "0.01" },
                    },
                ),
        ],
    ] as const) {
        test(`${name} leaks neither the bot token nor a webhook token`, async () => {
            const seen: unknown[] = [];
            const client = rest(async () => make(), seen);
            const error = await client
                .post(`/webhooks/123456789012345678/${WEBHOOK_TOKEN}`, {
                    content: "x",
                })
                .catch((e: unknown) => e);
            await new Promise((r) => setTimeout(r, 5));
            expect(error).toBeInstanceOf(RESTError);
            const text = everything(error) + JSON.stringify(seen);
            expect(text).not.toContain(TOKEN);
            expect(text).not.toContain(WEBHOOK_TOKEN);
            expect(seen.length).toBeGreaterThan(0);
        });
    }

    test("a transport failure does not carry the URL with the webhook token", async () => {
        const seen: unknown[] = [];
        const client = rest(async (url) => {
            throw new TypeError(`fetch failed: ${url}`);
        }, seen);
        const error = await client
            .post(`/webhooks/123456789012345678/${WEBHOOK_TOKEN}`, {
                content: "x",
            })
            .catch((e: unknown) => e);
        const text = everything(error) + JSON.stringify(seen);
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain(WEBHOOK_TOKEN);
    });

    test("interaction tokens in the path are redacted the same way", async () => {
        const seen: unknown[] = [];
        const client = rest(
            async () => new Response("{}", { status: 400 }),
            seen,
        );
        const error = await client
            .post(
                `/interactions/123456789012345678/${WEBHOOK_TOKEN}/callback`,
                { type: 4 },
            )
            .catch((e: unknown) => e);
        await new Promise((r) => setTimeout(r, 5));
        expect(everything(error) + JSON.stringify(seen)).not.toContain(
            WEBHOOK_TOKEN,
        );
    });

    test("the Authorization header carries the bot token and a caller cannot override it", async () => {
        let headers: Record<string, string> = {};
        const client = rest(async (_url, init) => {
            headers = init.headers as Record<string, string>;
            return new Response("{}");
        }, []);
        await client.get("/users/@me", {
            headers: { authorization: "Bot evil" },
        });
        const auth = Object.entries(headers).filter(
            ([k]) => k.toLowerCase() === "authorization",
        );
        expect(auth).toHaveLength(1);
        expect(auth[0]![1]).toBe(`Bot ${TOKEN}`);
    });
});

describe("retries", () => {
    const counting = (status: number) => {
        let calls = 0;
        const client = new REST({
            token: TOKEN,
            retries: 2,
            transport: new HttpTransport({
                fetch: async () => {
                    calls++;
                    return new Response("{}", { status });
                },
            }),
        });
        return { client, calls: () => calls };
    };

    test("a failed POST or PATCH is never replayed after a server error", async () => {
        for (const send of [
            (c: REST) => c.post("/channels/1/messages", { content: "x" }),
            (c: REST) => c.patch("/channels/1/messages/2", { content: "x" }),
        ]) {
            const { client, calls } = counting(500);
            await send(client).catch(() => undefined);
            expect(calls()).toBe(1);
        }
    });

    test("a network failure is not replayed for POST, but is for GET, within the budget", async () => {
        let posts = 0;
        const post = new REST({
            token: TOKEN,
            retries: 3,
            transport: new HttpTransport({
                fetch: async () => {
                    posts++;
                    throw new TypeError("network down");
                },
            }),
        });
        await post
            .post("/channels/1/messages", { content: "x" })
            .catch(() => undefined);
        expect(posts).toBe(1);

        let gets = 0;
        const get = new REST({
            token: TOKEN,
            retries: 2,
            retryPolicy: {
                maxRetries: 2,
                shouldRetry: (m, s) => m === "GET" && s === 0,
                getDelay: () => 1,
            },
            transport: new HttpTransport({
                fetch: async () => {
                    gets++;
                    throw new TypeError("network down");
                },
            }),
        });
        await get.get("/users/@me").catch(() => undefined);
        expect(gets).toBe(3);
    });

    test("a 4xx other than 429 is never retried", async () => {
        for (const status of [400, 401, 403, 404]) {
            const { client, calls } = counting(status);
            await client.get("/users/@me").catch(() => undefined);
            expect({ status, calls: calls() }).toEqual({ status, calls: 1 });
        }
    });

    test("cancelling while waiting out a rate limit stops the request", async () => {
        let calls = 0;
        const client = new REST({
            token: TOKEN,
            retries: 3,
            transport: new HttpTransport({
                fetch: async () => {
                    calls++;
                    return new Response(
                        JSON.stringify({ retry_after: 30, global: false }),
                        {
                            status: 429,
                            headers: { "retry-after": "30" },
                        },
                    );
                },
            }),
        });
        const controller = new AbortController();
        const request = client.get("/users/@me", { signal: controller.signal });
        const settled = request.catch((e: unknown) => e);
        await new Promise((r) => setTimeout(r, 20));
        const started = Date.now();
        controller.abort();
        const error = await settled;
        expect(Date.now() - started).toBeLessThan(1000);
        expect(error).toBeInstanceOf(Error);
        await new Promise((r) => setTimeout(r, 50));
        expect(calls).toBe(1);
    });
});

function threw(fn: () => unknown): boolean {
    try {
        fn();
        return false;
    } catch {
        return true;
    }
}

describe("abort listeners", () => {
    const count = (signal: AbortSignal) =>
        getEventListeners(signal, "abort").length;

    test("sleep() leaves no listener behind, however it ends", async () => {
        const controller = new AbortController();
        for (let i = 0; i < 50; i++) await sleep(1, controller.signal, "/x");
        expect(count(controller.signal)).toBe(0);

        const pending = sleep(10_000, controller.signal, "/x");
        const settled = pending.catch((e: unknown) => e);
        expect(count(controller.signal)).toBe(1);
        controller.abort();
        expect(await settled).toBeInstanceOf(Error);
        expect(count(controller.signal)).toBe(0);

        // Already aborted: nothing is registered.
        await expect(sleep(5, controller.signal, "/x")).rejects.toThrow();
        expect(count(controller.signal)).toBe(0);
        // No delay, no signal needed.
        await sleep(0, controller.signal, "/x");
        await sleep(5, undefined, "/x");
    });

    test("abortable() leaves no listener behind when the work finishes first or fails", async () => {
        const controller = new AbortController();
        for (let i = 0; i < 50; i++)
            await abortable(Promise.resolve(), controller.signal, "/x");
        expect(count(controller.signal)).toBe(0);
        await expect(
            abortable(
                Promise.reject(new Error("boom")),
                controller.signal,
                "/x",
            ),
        ).rejects.toThrow("boom");
        expect(count(controller.signal)).toBe(0);

        let finish!: () => void;
        const slow = new Promise<void>((resolve) => (finish = resolve));
        const racing = abortable(slow, controller.signal, "/x");
        expect(count(controller.signal)).toBe(1);
        finish();
        await racing;
        expect(count(controller.signal)).toBe(0);

        const never = new Promise<void>(() => undefined);
        const aborted = abortable(never, controller.signal, "/x").catch(
            (e: unknown) => e,
        );
        controller.abort();
        expect(await aborted).toBeInstanceOf(Error);
        expect(count(controller.signal)).toBe(0);
        await expect(
            abortable(never, controller.signal, "/x"),
        ).rejects.toThrow();
        expect(
            await abortable(Promise.resolve(), undefined, "/x"),
        ).toBeUndefined();
    });

    test("one signal reused for many requests does not accumulate listeners", async () => {
        const controller = new AbortController();
        const client = new REST({
            token: TOKEN,
            transport: new HttpTransport({
                fetch: async () => new Response("{}"),
            }),
        });
        for (let i = 0; i < 100; i++)
            await client.get("/users/@me", { signal: controller.signal });
        expect(count(controller.signal)).toBe(0);
    });
});

describe("server-controlled backoff", () => {
    const limited = (retryAfter: string, extra: Record<string, string> = {}) =>
        new Response(
            JSON.stringify({
                message: "rate limited",
                retry_after: Number(retryAfter),
                global: false,
            }),
            {
                status: 429,
                headers: { "retry-after": retryAfter, ...extra },
            },
        );

    function client(
        maxBackoff: number | undefined,
        responses: (n: number) => Response,
    ) {
        let calls = 0;
        const rest = new REST({
            token: TOKEN,
            retries: 2,
            maxBackoff,
            transport: new HttpTransport({
                fetch: async () => responses(++calls),
            }),
        });
        return { rest, calls: () => calls };
    }

    test("a Retry-After longer than maxBackoff fails the request at once instead of sleeping", async () => {
        const { rest, calls } = client(200, () => limited("86400"));
        const started = Date.now();
        const error = await rest.get("/users/@me").catch((e: unknown) => e);
        expect(Date.now() - started).toBeLessThan(500);
        expect(error).toBeInstanceOf(RESTError);
        expect((error as RESTError).status).toBe(429);
        expect((error as RESTError).message).toMatch(/86400s.*maxBackoff/);
        expect(calls()).toBe(1);
    });

    test("a hostile global limit cannot wedge later requests beyond maxBackoff", async () => {
        const { rest } = client(150, (n) =>
            n === 1
                ? limited("86400", { "x-ratelimit-global": "true" })
                : new Response("{}"),
        );
        await rest.get("/users/@me").catch(() => undefined);
        const started = Date.now();
        await rest.get("/channels/1");
        const waited = Date.now() - started;
        // The gate holds for about maxBackoff and then opens; it neither blocks for a day nor opens at once.
        expect(waited).toBeGreaterThanOrEqual(100);
        expect(waited).toBeLessThan(1000);
    });

    test("a limit too large for setTimeout still gates", async () => {
        const { rest } = client(120, (n) =>
            n === 1
                ? limited("1e20", {
                      "x-ratelimit-global": "true",
                      "x-ratelimit-reset-after": "1e20",
                  })
                : new Response("{}"),
        );
        await rest.get("/users/@me").catch(() => undefined);
        const started = Date.now();
        await rest.get("/channels/1");
        expect(Date.now() - started).toBeGreaterThanOrEqual(80);
    });

    test("a bucket's reset-after is capped too", async () => {
        const { rest } = client(100, (n) =>
            n === 1
                ? new Response("{}", {
                      headers: {
                          "x-ratelimit-bucket": "b",
                          "x-ratelimit-remaining": "0",
                          "x-ratelimit-reset-after": "99999",
                      },
                  })
                : new Response("{}"),
        );
        await rest.get("/channels/5/messages");
        const started = Date.now();
        await rest.get("/channels/5/messages");
        const waited = Date.now() - started;
        expect(waited).toBeGreaterThanOrEqual(60);
        expect(waited).toBeLessThan(1000);
    });

    test("a normal Retry-After is still honoured and retried", async () => {
        const { rest, calls } = client(5000, (n) =>
            n === 1 ? limited("0.05") : new Response("{}"),
        );
        const started = Date.now();
        await rest.get("/users/@me");
        expect(calls()).toBe(2);
        expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    });

    test("the default ceiling is ten minutes, and sleep() survives delays beyond setTimeout's limit", async () => {
        const controller = new AbortController();
        let resolved = false;
        const waiting = sleep(3_000_000_000, controller.signal, "/x").then(
            () => (resolved = true),
        );
        waiting.catch(() => undefined);
        await new Promise((r) => setTimeout(r, 40));
        expect(resolved).toBe(false); // a clamped timer would have fired at once
        controller.abort();
        await expect(waiting).rejects.toThrow();
        const { rest } = client(undefined, () => limited("700"));
        const error = await rest.get("/users/@me").catch((e: unknown) => e);
        expect((error as RESTError).message).toMatch(/700s.*maxBackoff/);
        expect(() => new REST({ token: TOKEN, maxBackoff: -1 })).toThrow(
            RangeError,
        );
        expect(
            () => new REST({ token: TOKEN, maxBackoff: Number.NaN }),
        ).toThrow(RangeError);
    });
});

describe("custom transport errors", () => {
    test("a webhook token in a thrown error does not reach the cause", async () => {
        class Leaky extends HttpTransport {
            public override async send(): Promise<never> {
                throw new Error(
                    `connect failed https://discord.com/api/webhooks/1/${WEBHOOK_TOKEN}`,
                );
            }
        }
        const rest = new REST({
            token: TOKEN,
            transport: new Leaky(),
            retry: { maxRetries: 0 },
        } as never);
        const error = await rest.get("/x").catch((e: unknown) => e);
        expect(
            JSON.stringify(error, Object.getOwnPropertyNames(error)),
        ).not.toContain(WEBHOOK_TOKEN);
        const cause = (error as { cause?: Error }).cause;
        expect(`${cause?.message}${cause?.stack}`).not.toContain(WEBHOOK_TOKEN);
    });
});

describe("input normalisation", () => {
    test("baseURL is normalised and bare ? or # is refused", () => {
        expect(
            new HttpTransport({ baseURL: "https://discord.com/api/v10/" })
                .baseURL,
        ).toBe("https://discord.com/api/v10");
        expect(
            () => new HttpTransport({ baseURL: "https://discord.com/api?" }),
        ).toThrow(TypeError);
    });

    test("multipart file names cannot inject part headers", async () => {
        let body: FormData | undefined;
        const rest = new REST({
            token: TOKEN,
            transport: new HttpTransport({
                fetch: (async (_u: unknown, init: RequestInit) => {
                    body = init.body as FormData;
                    return new Response("{}", { status: 200 });
                }) as never,
            }),
        });
        await rest.postWithFiles("/channels/1/messages", {}, [
            { name: 'a"\r\nX-Evil: 1.png', data: new Uint8Array([1]) },
        ] as never);
        const file = body!.get("files[0]") as File;
        expect(file.name).not.toMatch(/[\r\n"]/);
    });
});

describe("rate-limit store bounds", () => {
    test("the memory store keeps a bounded number of buckets", async () => {
        const { MemoryRateLimitStore } =
            await import("../packages/rest/src/store.ts");
        const store = new MemoryRateLimitStore();
        const far = Date.now() + 3.15e10;
        for (let i = 0; i < 12_000; i++) {
            store.setBucketHash(`r${i}`, `h${i}`);
            store.updateBucket(`b${i}`, {
                remaining: 1,
                limit: 1,
                resetAt: far,
            } as never);
        }
        expect(store.getBucketHash("r0")).toBeUndefined();
        expect(store.getBucket("b0")).toBeUndefined();
        expect(store.getBucketHash("r11999")).toBe("h11999");
        expect(store.getBucket("b11999")).toBeDefined();
    });
});
