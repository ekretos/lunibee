import { describe, expect, test } from "bun:test";
import { createDeflate, constants as zlibConstants } from "node:zlib";
import {
    WebSocketTransport,
    ZlibStreamDecoder,
    PlainTextDecoder,
    createDecoder,
    type GatewayDecoder,
    type TransportHandlers,
} from "../packages/ws/src/index.ts";

/**
 * Stage 1B.4 acceptance. These target the states that are hard to reach from a
 * Gateway: a socket that has been replaced but is still firing, a frame that
 * finishes decoding after its socket is gone, and a payload split across
 * WebSocket messages.
 */
class StubSocket {
    static instances: StubSocket[] = [];
    readonly url: string;
    readyState = 0;
    sent: string[] = [];
    closeCalls: Array<{ code: number; reason: string }> = [];
    binaryType = "blob";
    throwOnSend = false;
    #listeners = new Map<string, Set<(event: any) => void>>();

    constructor(url: string) {
        this.url = url;
        StubSocket.instances.push(this);
    }
    addEventListener(event: string, listener: (event: any) => void): void {
        let listeners = this.#listeners.get(event);
        if (!listeners) this.#listeners.set(event, (listeners = new Set()));
        listeners.add(listener);
    }
    send(data: string): void {
        if (this.throwOnSend) throw new Error("send failed");
        this.sent.push(data);
    }
    close(code = 1000, reason = ""): void {
        this.closeCalls.push({ code, reason });
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.emit("close", { code, reason });
    }
    open(): void {
        this.readyState = 1;
        this.emit("open", {});
    }
    emit(event: string, value: unknown): void {
        for (const listener of this.#listeners.get(event) ?? [])
            listener(value);
    }
}

interface Harness {
    transport: WebSocketTransport;
    events: string[];
    frames: string[];
    errors: Error[];
    sockets: StubSocket[];
}

function harness(options: { decoder?: GatewayDecoder } = {}): Harness {
    StubSocket.instances = [];
    const events: string[] = [];
    const frames: string[] = [];
    const errors: Error[] = [];
    const handlers: TransportHandlers = {
        onOpen: () => events.push("open"),
        onFrame: (raw) => {
            events.push("frame");
            frames.push(raw);
        },
        onClose: (code) => events.push(`close:${code}`),
        onError: (error) => {
            events.push("error");
            errors.push(error);
        },
    };
    const transport = new WebSocketTransport({
        handlers,
        decoder: options.decoder,
        createSocket: (url) => new StubSocket(url) as unknown as WebSocket,
    });
    return { transport, events, frames, errors, sockets: StubSocket.instances };
}

const tick = (ms = 5): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

describe("WebSocketTransport lifecycle", () => {
    test("constructs a socket, reports open, and sends only once open", () => {
        const h = harness();
        expect(h.transport.connect("wss://a.test")).toEqual({ ok: true });
        expect(h.sockets[0]!.url).toBe("wss://a.test");
        expect(h.transport.live).toBe(true);
        expect(h.transport.connected).toBe(false);
        // Sending before open must fail rather than throw.
        expect(h.transport.send("early")).toBe(false);

        h.sockets[0]!.open();
        expect(h.events).toEqual(["open"]);
        expect(h.transport.connected).toBe(true);
        expect(h.transport.send("payload")).toBe(true);
        expect(h.sockets[0]!.sent).toEqual(["payload"]);
    });

    test("a construction failure is returned, not reported as an error event", () => {
        const events: string[] = [];
        const transport = new WebSocketTransport({
            handlers: {
                onOpen: () => events.push("open"),
                onFrame: () => events.push("frame"),
                onClose: () => events.push("close"),
                onError: () => events.push("error"),
            },
            createSocket: () => {
                throw new Error("dns failure");
            },
        });
        const result = transport.connect("wss://a.test");
        expect(result.ok).toBe(false);
        expect((result as { error: Error }).error.message).toBe("dns failure");
        // The caller owns the failure: no out-of-band event fires.
        expect(events).toEqual([]);
        expect(transport.live).toBe(false);
    });

    test("a send failure is reported and answered with false", () => {
        const h = harness();
        h.transport.connect("wss://a.test");
        h.sockets[0]!.open();
        h.sockets[0]!.throwOnSend = true;
        expect(h.transport.send("x")).toBe(false);
        expect(h.errors[0]!.message).toBe("send failed");
    });

    test("socket errors and closes are reported with their code", () => {
        const h = harness();
        h.transport.connect("wss://a.test");
        h.sockets[0]!.open();
        h.sockets[0]!.emit("error", {});
        h.sockets[0]!.close(4000, "bye");
        expect(h.events).toEqual(["open", "error", "close:4000"]);
        expect(h.transport.live).toBe(false);
    });

    test("close() asks the socket to close; the close event still reports", () => {
        const h = harness();
        h.transport.connect("wss://a.test");
        h.sockets[0]!.open();
        h.transport.close(1001, "going away");
        expect(h.sockets[0]!.closeCalls).toEqual([
            { code: 1001, reason: "going away" },
        ]);
        expect(h.events).toContain("close:1001");
    });

    test("destroy() abandons the socket without reporting its close", () => {
        const h = harness();
        h.transport.connect("wss://a.test");
        h.sockets[0]!.open();
        h.transport.destroy(1000, "shutdown");
        expect(h.sockets[0]!.closeCalls).toHaveLength(1);
        expect(h.events).toEqual(["open"]);
        expect(h.transport.live).toBe(false);
    });
});

describe("WebSocketTransport replacement", () => {
    test("connecting again closes the predecessor and silences it", () => {
        const h = harness();
        h.transport.connect("wss://a.test");
        const first = h.sockets[0]!;
        first.open();
        h.transport.connect("wss://b.test");
        const second = h.sockets[1]!;

        expect(first.closeCalls).toHaveLength(1);
        // Every event the abandoned socket can still fire is ignored.
        first.emit("open", {});
        first.emit("message", { data: "stale frame" });
        first.emit("error", {});
        first.emit("close", { code: 1006, reason: "" });
        expect(h.events).toEqual(["open"]);

        second.open();
        second.emit("message", { data: "live frame" });
        expect(h.frames).toEqual(["live frame"]);
    });

    test("an old socket's open must not complete the replacement's connection", () => {
        const h = harness();
        h.transport.connect("wss://a.test");
        const first = h.sockets[0]!;
        h.transport.connect("wss://b.test");
        // WS-B is still CONNECTING when WS-A finally opens.
        first.open();
        expect(h.events).toEqual([]);
        expect(h.transport.connected).toBe(false);

        h.sockets[1]!.open();
        expect(h.events).toEqual(["open"]);
    });

    test("a closed socket cannot speak again", () => {
        const h = harness();
        h.transport.connect("wss://a.test");
        const socket = h.sockets[0]!;
        socket.open();
        socket.close(1006);
        // A late frame, a second close, an error: all belong to a dead socket.
        socket.emit("message", { data: "after close" });
        socket.emit("close", { code: 1006, reason: "" });
        socket.emit("error", {});
        expect(h.events).toEqual(["open", "close:1006"]);
        expect(h.frames).toEqual([]);
    });

    test("two replacements in a row leave only the newest speaking", () => {
        const h = harness();
        h.transport.connect("wss://a.test");
        h.transport.connect("wss://b.test");
        h.transport.connect("wss://c.test");
        const [a, b, c] = h.sockets as [StubSocket, StubSocket, StubSocket];
        a.open();
        b.open();
        a.emit("message", { data: "a" });
        b.emit("message", { data: "b" });
        c.open();
        c.emit("message", { data: "c" });
        expect(h.frames).toEqual(["c"]);
        expect(h.events.filter((event) => event === "open")).toHaveLength(1);
    });

    test("a frame still decoding when the socket is replaced is dropped", async () => {
        // A decoder that resolves on demand, so the replacement lands while a
        // frame is mid-flight.
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const slow: GatewayDecoder = {
            push: async (data) => {
                await gate;
                return [String(data)];
            },
            reset: () => {},
        };
        const h = harness({ decoder: slow });
        h.transport.connect("wss://a.test");
        h.sockets[0]!.open();
        h.sockets[0]!.emit("message", { data: "in flight" });

        h.transport.connect("wss://b.test");
        release();
        await tick(10);
        expect(h.frames).toEqual([]);
    });
});

describe("PlainTextDecoder", () => {
    test("returns each frame synchronously", () => {
        const decoder = new PlainTextDecoder();
        expect(decoder.push("hello")).toEqual(["hello"]);
        decoder.reset();
        expect(decoder.push("again")).toEqual(["again"]);
    });

    test("createDecoder picks the decoder for the connection", () => {
        expect(createDecoder(false)).toBeInstanceOf(PlainTextDecoder);
        expect(createDecoder(undefined)).toBeInstanceOf(PlainTextDecoder);
        expect(createDecoder(true)).toBeInstanceOf(ZlibStreamDecoder);
    });
});

/** Encodes payloads as Discord does: one zlib stream, Z_SYNC_FLUSH per frame. */
function framer(): (payload: unknown) => Promise<Uint8Array> {
    const deflate = createDeflate();
    const chunks: Buffer[] = [];
    deflate.on("data", (chunk: Buffer) => chunks.push(chunk));
    return (payload) =>
        new Promise<Uint8Array>((resolve) => {
            deflate.write(Buffer.from(JSON.stringify(payload)));
            deflate.flush(zlibConstants.Z_SYNC_FLUSH, () => {
                const merged = Buffer.concat(chunks);
                chunks.length = 0;
                resolve(new Uint8Array(merged));
            });
        });
}

describe("ZlibStreamDecoder", () => {
    test("a complete frame decodes to exactly one payload", async () => {
        const decoder = new ZlibStreamDecoder();
        const frame = framer();
        const bytes = await frame({ op: 0, t: "READY" });
        expect(await decoder.push(bytes)).toEqual([
            JSON.stringify({ op: 0, t: "READY" }),
        ]);
    });

    test("a split payload yields nothing, then exactly one payload", async () => {
        const decoder = new ZlibStreamDecoder();
        const frame = framer();
        const bytes = await frame({ op: 0, t: "MESSAGE_CREATE", d: { a: 1 } });
        const cut = Math.max(1, bytes.length - 6);

        expect(await decoder.push(bytes.slice(0, cut))).toEqual([]);
        const completed = await decoder.push(bytes.slice(cut));
        expect(completed).toHaveLength(1);
        expect(JSON.parse(completed[0]!)).toEqual({
            op: 0,
            t: "MESSAGE_CREATE",
            d: { a: 1 },
        });
    });

    test("three frames in sequence decode to three payloads, in order", async () => {
        const decoder = new ZlibStreamDecoder();
        const frame = framer();
        const decoded: string[] = [];
        for (const t of ["A", "B", "C"]) {
            const bytes = await frame({ op: 0, t });
            decoded.push(...(await decoder.push(bytes)));
        }
        expect(decoded.map((raw) => JSON.parse(raw).t)).toEqual([
            "A",
            "B",
            "C",
        ]);
    });

    test("a payload split into three chunks is retained until its boundary", async () => {
        const decoder = new ZlibStreamDecoder();
        const frame = framer();
        const bytes = await frame({ op: 0, t: "BIG", d: "x".repeat(500) });
        const third = Math.floor(bytes.length / 3);

        expect(await decoder.push(bytes.slice(0, third))).toEqual([]);
        expect(await decoder.push(bytes.slice(third, third * 2))).toEqual([]);
        const done = await decoder.push(bytes.slice(third * 2));
        expect(done).toHaveLength(1);
        expect(JSON.parse(done[0]!).d).toHaveLength(500);
    });

    test("malformed compressed bytes surface as an error", async () => {
        const decoder = new ZlibStreamDecoder();
        const garbage = new Uint8Array([1, 2, 3, 0x00, 0x00, 0xff, 0xff]);
        await expect(decoder.push(garbage)).rejects.toBeInstanceOf(Error);
    });

    test("an unsupported frame type is rejected", async () => {
        const decoder = new ZlibStreamDecoder();
        await expect(decoder.push(42)).rejects.toBeInstanceOf(TypeError);
    });

    test("reset() discards stream state so a new connection starts clean", async () => {
        const decoder = new ZlibStreamDecoder();
        const first = framer();
        const bytes = await first({ op: 0, t: "A" });
        await decoder.push(bytes);

        decoder.reset();
        // A brand-new stream, as a reconnect would produce.
        const second = framer();
        const fresh = await second({ op: 0, t: "B" });
        const decoded = await decoder.push(fresh);
        expect(JSON.parse(decoded[0]!).t).toBe("B");
    });

    test("reset() clears a previous failure", async () => {
        const decoder = new ZlibStreamDecoder();
        await expect(
            decoder.push(new Uint8Array([9, 9, 9, 0x00, 0x00, 0xff, 0xff])),
        ).rejects.toBeInstanceOf(Error);

        decoder.reset();
        const frame = framer();
        const bytes = await frame({ op: 0, t: "AFTER_RESET" });
        const decoded = await decoder.push(bytes);
        expect(JSON.parse(decoded[0]!).t).toBe("AFTER_RESET");
    });

    test("a text frame passes through without touching the inflater", () => {
        const decoder = new ZlibStreamDecoder();
        // Synchronous: delivery timing is observable, and Discord's own text
        // frames must not be delayed behind the inflater.
        expect(decoder.push('{"op":11}')).toEqual(['{"op":11}']);
    });
});

import { SendBudget } from "../packages/ws/src/send-budget.ts";

describe("SendBudget", () => {
    test("caps application sends per window but never privileged ones", () => {
        const budget = new SendBudget(2, 1000);
        expect(budget.allows(false, 0)).toBe(true);
        budget.record(0);
        budget.record(10);
        expect(budget.allows(false, 20)).toBe(false);
        expect(budget.allows(true, 20)).toBe(true);
        budget.record(20);
        expect(budget.used).toBe(3);
        expect(budget.allows(false, 1005)).toBe(false);
        expect(budget.allows(false, 1021)).toBe(true);
        expect(budget.used).toBe(0);
    });
});
