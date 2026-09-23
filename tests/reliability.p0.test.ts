import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDeflate, constants as zlibConstants } from "node:zlib";
import { REST, createRetryPolicy } from "../packages/rest/src/index.ts";
import { Gateway, GatewayOpcodes } from "../packages/ws/src/index.ts";
import { ShardManager } from "../packages/sharding/src/index.ts";

/**
 * Regression coverage for the P0/P1 reliability findings:
 * an aborted REST request wedging its bucket queue, zlib-stream frames that
 * never decoded, a handshake starved by the send budget, and shards spawned
 * faster than Discord's IDENTIFY limit allows.
 */
describe("REST bucket queue (P0: abort deadlock)", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("an aborted queued request does not wedge later requests on the bucket", async () => {
        globalThis.fetch = (async () => {
            await new Promise((resolve) => setTimeout(resolve, 60));
            return new Response("{}", {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }) as unknown as typeof fetch;

        const rest = new REST({ token: "token" });
        const first = rest.get("/channels/1/messages");
        const controller = new AbortController();
        const aborted = rest
            .get("/channels/1/messages", { signal: controller.signal })
            .then(
                () => "resolved",
                () => "rejected",
            );
        controller.abort();
        const third = rest.get("/channels/1/messages").then(() => "third");

        const outcome = await Promise.race([
            Promise.all([first, aborted, third]),
            new Promise((resolve) =>
                setTimeout(() => resolve("DEADLOCK"), 2000),
            ),
        ]);
        expect(Array.isArray(outcome)).toBe(true);
        expect((outcome as unknown[])[1]).toBe("rejected");
        expect((outcome as unknown[])[2]).toBe("third");
    });

    test("a signal aborted before enqueue leaves the bucket usable", async () => {
        globalThis.fetch = (async () =>
            new Response("{}", {
                status: 200,
                headers: { "content-type": "application/json" },
            })) as unknown as typeof fetch;

        const rest = new REST({ token: "token" });
        const controller = new AbortController();
        controller.abort();
        await expect(
            rest.get("/channels/2/messages", { signal: controller.signal }),
        ).rejects.toThrow();

        const outcome = await Promise.race([
            rest.get("/channels/2/messages").then(() => "ok"),
            new Promise((resolve) =>
                setTimeout(() => resolve("DEADLOCK"), 2000),
            ),
        ]);
        expect(outcome).toBe("ok");
    });
});

describe("REST retry policy (P1: transport failures)", () => {
    test("retries idempotent methods on a transport failure, never unsafe ones", () => {
        const policy = createRetryPolicy(2);
        expect(policy.shouldRetry("GET", 0)).toBe(true);
        expect(policy.shouldRetry("DELETE", 0)).toBe(true);
        expect(policy.shouldRetry("POST", 0)).toBe(false);
        expect(policy.shouldRetry("PATCH", 0)).toBe(false);
        // Existing behaviour is unchanged for real responses.
        expect(policy.shouldRetry("POST", 429)).toBe(true);
        expect(policy.shouldRetry("POST", 500)).toBe(false);
        expect(policy.shouldRetry("GET", 500)).toBe(true);
    });
});

class FakeWebSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];
    readonly url: string;
    readyState = 0;
    binaryType = "blob";
    sent: string[] = [];
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
        if (this.readyState === FakeWebSocket.CLOSED) return;
        this.readyState = FakeWebSocket.CLOSED;
        this.emit("close", { code, reason });
    }
    open(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", {});
    }
    emit(event: string, value: unknown): void {
        for (const listener of this.#listeners.get(event) ?? [])
            listener(value);
    }
}

/** Encodes payloads as Discord does: one zlib stream, Z_SYNC_FLUSH per frame. */
function createFramer(): (payload: unknown) => Promise<Uint8Array> {
    const deflate = createDeflate();
    const chunks: Buffer[] = [];
    deflate.on("data", (chunk: Buffer) => chunks.push(chunk));
    return (payload: unknown) =>
        new Promise<Uint8Array>((resolve) => {
            deflate.write(Buffer.from(JSON.stringify(payload)));
            deflate.flush(zlibConstants.Z_SYNC_FLUSH, () => {
                const merged = Buffer.concat(chunks);
                chunks.length = 0;
                resolve(new Uint8Array(merged));
            });
        });
}

describe("Gateway zlib-stream (P0: compressed payloads)", () => {
    const OriginalWebSocket = globalThis.WebSocket;
    beforeEach(() => {
        FakeWebSocket.instances = [];
        globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    });
    afterEach(() => {
        globalThis.WebSocket = OriginalWebSocket;
    });

    test("decodes compressed dispatches in arrival order", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
            compress: true,
        });
        const seen: string[] = [];
        gateway.on("MESSAGE_CREATE", (data) =>
            seen.push((data as { content: string }).content),
        );

        // Take the socket this connect() creates (synchronously), not index 0:
        // a gateway left over from another test file may reconnect into the
        // shared stub while this test runs.
        const created = FakeWebSocket.instances.length;
        const connecting = gateway.connect("wss://example.test");
        const socket = FakeWebSocket.instances[created]!;
        socket.open();
        await connecting;
        expect(socket.binaryType).toBe("arraybuffer");

        const frame = createFramer();
        for (const content of ["one", "two", "three"]) {
            const bytes = await frame({
                op: GatewayOpcodes.Dispatch,
                t: "MESSAGE_CREATE",
                s: 1,
                d: { content },
            });
            socket.emit("message", { data: bytes.buffer });
        }
        // Drain the serialised decompression chain.
        for (let i = 0; i < 20 && seen.length < 3; i++)
            await new Promise((resolve) => setTimeout(resolve, 10));

        expect(seen).toEqual(["one", "two", "three"]);
        gateway.close();
    });

    test("waits for the Z_SYNC_FLUSH boundary before parsing a split payload", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
            compress: true,
        });
        const seen: string[] = [];
        const errors: unknown[] = [];
        gateway.on("MESSAGE_CREATE", (data) =>
            seen.push((data as { content: string }).content),
        );
        gateway.on("error", (error) => errors.push(error));

        // Take the socket this connect() creates (synchronously), not index 0:
        // a gateway left over from another test file may reconnect into the
        // shared stub while this test runs.
        const created = FakeWebSocket.instances.length;
        const connecting = gateway.connect("wss://example.test");
        const socket = FakeWebSocket.instances[created]!;
        socket.open();
        await connecting;

        const frame = createFramer();
        const bytes = await frame({
            op: GatewayOpcodes.Dispatch,
            t: "MESSAGE_CREATE",
            s: 1,
            d: { content: "split across frames" },
        });
        const split = Math.max(1, bytes.length - 6);
        socket.emit("message", { data: bytes.slice(0, split).buffer });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(seen).toEqual([]);
        expect(errors).toEqual([]);

        socket.emit("message", { data: bytes.slice(split).buffer });
        for (let i = 0; i < 20 && seen.length < 1; i++)
            await new Promise((resolve) => setTimeout(resolve, 10));
        expect(seen).toEqual(["split across frames"]);
        gateway.close();
    });
});

describe("Gateway handshake budget (P1: starved IDENTIFY)", () => {
    const OriginalWebSocket = globalThis.WebSocket;
    beforeEach(() => {
        FakeWebSocket.instances = [];
        globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    });
    afterEach(() => {
        globalThis.WebSocket = OriginalWebSocket;
    });

    test("IDENTIFY is sent even when the application send budget is spent", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        // Take the socket this connect() creates (synchronously), not index 0:
        // a gateway left over from another test file may reconnect into the
        // shared stub while this test runs.
        const created = FakeWebSocket.instances.length;
        const connecting = gateway.connect("wss://example.test");
        const socket = FakeWebSocket.instances[created]!;
        socket.open();
        await connecting;

        // Burn the whole non-privileged budget with presence updates.
        for (let i = 0; i < 200; i++) gateway.setPresence({ status: "online" });
        const burned = socket.sent.length;
        expect(burned).toBeLessThan(200);

        socket.emit("message", {
            data: JSON.stringify({
                op: GatewayOpcodes.Hello,
                d: { heartbeat_interval: 45_000 },
            }),
        });

        const identify = socket.sent
            .slice(burned)
            .map((raw) => JSON.parse(raw))
            .find((payload) => payload.op === GatewayOpcodes.Identify);
        expect(identify).toBeDefined();
        gateway.close();
    });
});

describe("ShardManager IDENTIFY pacing (P1)", () => {
    test("defaults to Discord's 5s IDENTIFY interval and validates overrides", () => {
        const manager = new ShardManager({
            token: "token",
            intents: 0,
            shardCount: 2,
        });
        // The resolved delay is private; assert the documented constant and
        // let the pacing test below prove it is the default in use.
        expect(ShardManager.IDENTIFY_INTERVAL).toBe(5000);
        manager.destroy();

        expect(
            () =>
                new ShardManager({
                    token: "token",
                    intents: 0,
                    shardCount: 1,
                    spawnDelay: -1,
                }),
        ).toThrow(RangeError);
    });

    test("paces shard starts by the default interval", async () => {
        const manager = new ShardManager({
            token: "token",
            intents: 0,
            shardCount: 2,
        });
        for (const shard of manager.shards.values())
            (shard as unknown as { connect: () => Promise<void> }).connect =
                async () => {};

        const originalSetTimeout = globalThis.setTimeout;
        const delays: number[] = [];
        globalThis.setTimeout = ((
            handler: TimerHandler,
            timeout?: number,
            ...args: unknown[]
        ) => {
            delays.push(timeout ?? 0);
            return originalSetTimeout(handler as never, 0, ...(args as []));
        }) as unknown as typeof setTimeout;
        try {
            await manager.connect();
        } finally {
            globalThis.setTimeout = originalSetTimeout;
        }
        expect(delays).toContain(5000);
        manager.destroy();
    });
});
