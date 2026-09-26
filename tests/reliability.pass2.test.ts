import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    REST,
    RedisRateLimitStore,
    type MinimalRedisClient,
} from "../packages/rest/src/index.ts";
import { Gateway, GatewayOpcodes } from "../packages/ws/src/index.ts";
import { Cache } from "../packages/collection/src/cache.ts";
import { Collector } from "../packages/core/src/collector.ts";

class FakeWebSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];
    readonly url: string;
    readyState = 0;
    sent: string[] = [];
    closeCode?: number;
    #listeners = new Map<string, Set<(event: any) => void>>();

    constructor(url: string) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }
    addEventListener(event: string, listener: (event: any) => void): void {
        let listeners = this.#listeners.get(event);
        if (!listeners) this.#listeners.set(event, (listeners = new Set()));
        listeners.add(listener);
    }
    send(data: string): void {
        if (this.readyState !== FakeWebSocket.OPEN)
            throw new Error("socket is not open");
        this.sent.push(data);
    }
    close(code = 1000, reason = ""): void {
        this.closeCode = code;
        if (this.readyState === FakeWebSocket.CLOSED) return;
        this.readyState = FakeWebSocket.CLOSED;
        this.emit("close", { code, reason });
    }
    open(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", {});
    }
    dispatch(event: string, data: unknown, sequence: number): void {
        this.emit("message", {
            data: JSON.stringify({
                op: GatewayOpcodes.Dispatch,
                t: event,
                s: sequence,
                d: data,
            }),
        });
    }
    emit(event: string, value: unknown): void {
        for (const listener of this.#listeners.get(event) ?? [])
            listener(value);
    }
}

describe("Gateway connect idempotency (P1: duplicate sockets)", () => {
    const OriginalWebSocket = globalThis.WebSocket;
    beforeEach(() => {
        FakeWebSocket.instances = [];
        globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    });
    afterEach(() => {
        globalThis.WebSocket = OriginalWebSocket;
    });

    test("connecting an already-live Gateway does not open a second socket", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        const connecting = gateway.connect("wss://example.test");
        FakeWebSocket.instances[0]!.open();
        await connecting;

        await gateway.connect("wss://example.test");
        expect(FakeWebSocket.instances).toHaveLength(1);
        gateway.close();
    });

    test("a superseded socket is closed and its dispatches are ignored", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        const connecting = gateway.connect("wss://example.test");
        const first = FakeWebSocket.instances[0]!;
        first.open();
        await connecting;

        const seen: string[] = [];
        gateway.on("MESSAGE_CREATE", (data) =>
            seen.push((data as { content: string }).content),
        );

        // Drop the socket, then prove it no longer feeds this Gateway.
        first.close(1006);
        const second = FakeWebSocket.instances[1];
        expect(second).toBeUndefined(); // reconnect disabled

        first.dispatch("MESSAGE_CREATE", { content: "from dead socket" }, 42);
        expect(seen).toEqual([]);
        gateway.close();
    });

    test("a manual connect cancels a pending reconnect instead of racing it", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 10,
            reconnectMaxDelay: 10,
        });
        const connecting = gateway.connect("wss://example.test");
        const first = FakeWebSocket.instances[0]!;
        first.open();
        await connecting;

        // Drop the connection so a reconnect is scheduled.
        first.close(1006);
        // Reconnect immediately by hand, then let the scheduled timer elapse.
        const manual = gateway.connect("wss://example.test");
        FakeWebSocket.instances[1]?.open();
        await manual;
        await new Promise((resolve) => setTimeout(resolve, 60));

        expect(FakeWebSocket.instances).toHaveLength(2);
        gateway.close();
    });
});

describe("RedisRateLimitStore failure semantics (P1)", () => {
    /** A client whose every call rejects, simulating a Redis outage. */
    function brokenClient(): MinimalRedisClient {
        const fail = async (): Promise<never> => {
            throw new Error("redis down");
        };
        return {
            get: fail,
            mget: fail,
            set: fail,
            del: fail,
        } as unknown as MinimalRedisClient;
    }

    test("falls back to locally mirrored limits instead of reporting none", async () => {
        const warn = console.warn;
        console.warn = () => {};
        try {
            const store = new RedisRateLimitStore({ client: brokenClient() });
            const resetAt = Date.now() + 30_000;

            await store.updateBucket("abc|123", { remaining: 0, resetAt });
            await store.setBucketHash("GET:/channels/:id/messages", "abc");
            await store.setGlobalReset(resetAt);

            // Redis is down for reads too: the mirror must answer, because
            // "undefined" here means "send freely" to the REST limiter.
            expect(await store.getBucket("abc|123")).toEqual({
                remaining: 0,
                resetAt,
            });
            expect(
                await store.getBucketHash("GET:/channels/:id/messages"),
            ).toBe("abc");
            expect(await store.getGlobalReset()).toBe(resetAt);
            expect(store.isHealthy()).toBe(false);
        } finally {
            console.warn = warn;
        }
    });

    test("REST still waits out a known bucket while Redis is unavailable", async () => {
        const warn = console.warn;
        console.warn = () => {};
        const originalFetch = globalThis.fetch;
        try {
            const store = new RedisRateLimitStore({ client: brokenClient() });
            // Seed the mirror through the store's own write path.
            await store.updateBucket("abc|1", {
                remaining: 0,
                resetAt: Date.now() + 120,
            });

            globalThis.fetch = (async () =>
                new Response("{}", {
                    status: 200,
                    headers: {
                        "content-type": "application/json",
                        "X-RateLimit-Bucket": "abc",
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset-After": "0.12",
                    },
                })) as unknown as typeof fetch;

            const rest = new REST({ token: "token", store });
            // First request discovers the bucket hash "abc" for this route.
            await rest.get("/channels/1/messages");
            const start = Date.now();
            await rest.get("/channels/1/messages");
            expect(Date.now() - start).toBeGreaterThanOrEqual(50);
        } finally {
            globalThis.fetch = originalFetch;
            console.warn = warn;
        }
    });
});

describe("Cache sweeper (P2: process retention)", () => {
    test("the TTL sweeper is unref'd so it cannot hold the process open", () => {
        const originalSetInterval = globalThis.setInterval;
        const handles: Array<{ hasRef?: () => boolean }> = [];
        globalThis.setInterval = ((
            handler: TimerHandler,
            timeout?: number,
            ...args: unknown[]
        ) => {
            const handle = originalSetInterval(
                handler as never,
                timeout,
                ...(args as []),
            );
            handles.push(handle as unknown as { hasRef?: () => boolean });
            return handle;
        }) as unknown as typeof setInterval;

        let cache: Cache<string, number>;
        try {
            cache = new Cache<string, number>({ ttl: 50 });
        } finally {
            globalThis.setInterval = originalSetInterval;
        }
        expect(handles).toHaveLength(1);
        expect(handles[0]!.hasRef?.()).toBe(false);
        cache.dispose();
    });

    test("entries still expire and dispose stops the sweeper", async () => {
        const cache = new Cache<string, number>({ ttl: 20, sweepInterval: 5 });
        cache.set("a", 1);
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(cache.get("a")).toBeUndefined();
        expect(cache.size).toBe(0);
        cache.dispose();
    });
});

describe("Collector.next() (P2: listener growth)", () => {
    test("settled next() calls do not accumulate listeners", async () => {
        const collector = new Collector<string, string>({});
        for (let i = 0; i < 25; i++) {
            const pending = collector.next();
            await collector.handle(`k${i}`, `v${i}`);
            expect(await pending).toBe(`v${i}`);
        }
        expect(collector.listenerCount("end")).toBe(0);
        expect(collector.listenerCount("collect")).toBe(0);
        collector.stop();
    });

    test("a pending next() still rejects when the collector ends", async () => {
        const collector = new Collector<string, string>({});
        const pending = collector.next();
        collector.stop("time");
        await expect(pending).rejects.toThrow(/time/);
    });
});
