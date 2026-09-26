import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDeflate, constants as zlibConstants } from "node:zlib";
import {
    Gateway,
    GatewayOpcodes,
    GatewayCloseCodes,
    GatewaySession,
} from "../packages/ws/src/index.ts";

/**
 * Stage 1B acceptance: the session owns session id, sequence, resume host and
 * the IDENTIFY-vs-RESUME decision, and nothing else. Half these tests drive the
 * session directly — which the Gateway's private fields never allowed — and
 * half drive it through a real Gateway to prove the seam is actually wired.
 */
function ready(
    sessionId = "session-1",
    resumeURL = "wss://resume.test",
): unknown {
    return { session_id: sessionId, resume_gateway_url: resumeURL };
}

describe("GatewaySession state", () => {
    test("1-3: READY stores session id, sequence and resume URL", () => {
        const session = new GatewaySession();
        const token = session.beginConnection();
        expect(session.recordSequence(1, token)).toBe(true);
        expect(session.activate(ready(), token)).toBe(true);

        expect(session.sessionId).toBe("session-1");
        expect(session.sequence).toBe(1);
        expect(session.resumeURL).toBe("wss://resume.test");
        expect(session.canResume).toBe(true);
        expect(session.resumeInfo()).toEqual({
            sessionId: "session-1",
            sequence: 1,
            resumeURL: "wss://resume.test",
        });
    });

    test("4: a DISPATCH updates the sequence", () => {
        const session = new GatewaySession();
        const token = session.beginConnection();
        session.recordSequence(1, token);
        session.activate(ready(), token);
        session.recordSequence(7, token);
        expect(session.sequence).toBe(7);
        expect(session.resumeInfo()?.sequence).toBe(7);
    });

    test("5: a valid session asks to RESUME", () => {
        const session = new GatewaySession();
        const token = session.beginConnection();
        session.recordSequence(4, token);
        session.activate(ready("s", "wss://resume.test"), token);
        // Reconnecting takes a new generation; the session must survive it.
        session.beginConnection();
        expect(session.handshake()).toEqual({
            type: "resume",
            sessionId: "s",
            sequence: 4,
            resumeURL: "wss://resume.test",
        });
    });

    test("6: no session asks to IDENTIFY", () => {
        const session = new GatewaySession();
        session.beginConnection();
        expect(session.handshake()).toEqual({ type: "identify" });
        expect(session.canResume).toBe(false);
        expect(session.resumeInfo()).toBeUndefined();
        // A session id with no sequence yet is still not resumable.
        const token = session.generation;
        session.activate(ready(), token);
        expect(session.canResume).toBe(false);
        expect(session.handshake()).toEqual({ type: "identify" });
    });

    test("9: a discarded session cannot accidentally RESUME", () => {
        const session = new GatewaySession();
        const token = session.beginConnection();
        session.recordSequence(12, token);
        session.activate(ready(), token);
        expect(session.canResume).toBe(true);

        expect(session.invalidate(token, "invalid-session")).toBe(true);
        expect(session.sessionId).toBeUndefined();
        expect(session.resumeURL).toBeUndefined();
        expect(session.sequence).toBeNull();
        expect(session.canResume).toBe(false);
        expect(session.handshake()).toEqual({ type: "identify" });
        expect(session.lastInvalidation).toBe("invalid-session");
        // The stale resume host must not be dialled again either.
        expect(session.connectURL("wss://main.test")).toBe("wss://main.test");
    });

    test("10: sequence 0 is preserved, not treated as absent", () => {
        const session = new GatewaySession();
        const token = session.beginConnection();
        session.recordSequence(0, token);
        session.activate(ready(), token);
        expect(session.sequence).toBe(0);
        expect(session.canResume).toBe(true);
        expect(session.handshake()).toEqual({
            type: "resume",
            sessionId: "session-1",
            sequence: 0,
            resumeURL: "wss://resume.test",
        });
    });

    test("11: session state survives transport replacement", () => {
        const session = new GatewaySession();
        const first = session.beginConnection();
        session.recordSequence(5, first);
        session.activate(ready("kept", "wss://resume.test"), first);

        const second = session.beginConnection();
        expect(session.sessionId).toBe("kept");
        expect(session.sequence).toBe(5);
        expect(session.owns(second)).toBe(true);
        expect(session.owns(first)).toBe(false);
        // The new transport continues the same session.
        session.recordSequence(6, second);
        expect(session.resumeInfo()?.sequence).toBe(6);
    });

    test("12: a superseded transport cannot mutate the live session", () => {
        const session = new GatewaySession();
        const stale = session.beginConnection();
        session.recordSequence(5, stale);
        session.activate(ready("live", "wss://resume.test"), stale);

        session.beginConnection(); // a new transport takes ownership

        // Every mutation from the old generation is refused.
        expect(session.recordSequence(999, stale)).toBe(false);
        expect(
            session.activate(ready("hijacked", "wss://evil.test"), stale),
        ).toBe(false);
        expect(session.invalidate(stale)).toBe(false);

        expect(session.sequence).toBe(5);
        expect(session.sessionId).toBe("live");
        expect(session.resumeURL).toBe("wss://resume.test");
    });

    test("malformed READY is rejected without corrupting the session", () => {
        const session = new GatewaySession();
        const token = session.beginConnection();
        session.recordSequence(3, token);
        session.activate(ready("good"), token);

        expect(session.activate({ session_id: "x" }, token)).toBe(false);
        expect(session.activate(null, token)).toBe(false);
        expect(session.recordSequence(Number.NaN, token)).toBe(false);
        expect(session.sessionId).toBe("good");
        expect(session.sequence).toBe(3);
    });
});

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
    receive(payload: unknown): void {
        this.emit("message", { data: JSON.stringify(payload) });
    }
    emit(event: string, value: unknown): void {
        for (const listener of this.#listeners.get(event) ?? [])
            listener(value);
    }
    /** Payloads sent on this socket, decoded. */
    payloads(): Array<{ op: number; d?: any }> {
        return this.sent.map((raw) => JSON.parse(raw));
    }
}

/** Drives a Gateway to a READY session on its first socket. */
async function connectReady(gateway: Gateway, sequence = 1): Promise<void> {
    const connecting = gateway.connect("wss://main.test");
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    await connecting;
    socket.receive({
        op: GatewayOpcodes.Hello,
        d: { heartbeat_interval: 45_000 },
    });
    socket.emit("message", {
        data: JSON.stringify({
            op: GatewayOpcodes.Dispatch,
            t: "READY",
            s: sequence,
            d: ready(),
        }),
    });
}

describe("Gateway session wiring", () => {
    const OriginalWebSocket = globalThis.WebSocket;
    beforeEach(() => {
        FakeWebSocket.instances = [];
        globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    });
    afterEach(() => {
        globalThis.WebSocket = OriginalWebSocket;
    });

    test("5: a dropped connection reconnects to the resume host and RESUMEs", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 5,
            reconnectMaxDelay: 5,
        });
        await connectReady(gateway, 3);
        FakeWebSocket.instances[0]!.close(1006);
        await new Promise((resolve) => setTimeout(resolve, 40));

        const second = FakeWebSocket.instances[1]!;
        expect(second.url).toBe("wss://resume.test");
        second.open();
        second.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });
        const resume = second
            .payloads()
            .find((p) => p.op === GatewayOpcodes.Resume);
        expect(resume?.d).toMatchObject({
            session_id: "session-1",
            seq: 3,
        });
        gateway.close();
    });

    test("7: op 9 resumable keeps the session for the next connection", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 5,
            reconnectMaxDelay: 5,
        });
        await connectReady(gateway, 9);
        const invalidations: unknown[] = [];
        gateway.on("invalidSession", (resumable) =>
            invalidations.push(resumable),
        );
        FakeWebSocket.instances[0]!.receive({
            op: GatewayOpcodes.InvalidSession,
            d: true,
        });
        expect(invalidations).toEqual([true]);
        await new Promise((resolve) => setTimeout(resolve, 40));

        const second = FakeWebSocket.instances[1]!;
        expect(second.url).toBe("wss://resume.test");
        second.open();
        second.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });
        expect(
            second.payloads().some((p) => p.op === GatewayOpcodes.Resume),
        ).toBe(true);
        gateway.close();
    });

    test("8: op 9 non-resumable forces a fresh IDENTIFY on the main host", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 5,
            reconnectMaxDelay: 5,
        });
        await connectReady(gateway, 9);
        FakeWebSocket.instances[0]!.receive({
            op: GatewayOpcodes.InvalidSession,
            d: false,
        });
        await new Promise((resolve) => setTimeout(resolve, 40));

        const second = FakeWebSocket.instances[1]!;
        expect(second.url).not.toBe("wss://resume.test");
        second.open();
        second.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });
        const payloads = second.payloads();
        expect(payloads.some((p) => p.op === GatewayOpcodes.Identify)).toBe(
            true,
        );
        expect(payloads.some((p) => p.op === GatewayOpcodes.Resume)).toBe(
            false,
        );
        gateway.close();
    });

    test("8: a session-invalidating close code forces IDENTIFY", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 5,
            reconnectMaxDelay: 5,
        });
        await connectReady(gateway, 2);
        FakeWebSocket.instances[0]!.close(GatewayCloseCodes.SessionTimedOut);
        await new Promise((resolve) => setTimeout(resolve, 40));

        const second = FakeWebSocket.instances[1]!;
        expect(second.url).not.toBe("wss://resume.test");
        second.open();
        second.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });
        expect(
            second.payloads().some((p) => p.op === GatewayOpcodes.Identify),
        ).toBe(true);
        gateway.close();
    });

    test("12: a frame still decompressing when its socket is replaced is discarded", async () => {
        // The decisive case for generation tokens: decompression is async, so a
        // compressed frame can finish decoding after its socket was replaced.
        // The synchronous `#ws === ws` check has already passed by then — only
        // the token the frame carries can still refuse it.
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 5,
            reconnectMaxDelay: 5,
            compress: true,
        });
        const connecting = gateway.connect("wss://main.test");
        const first = FakeWebSocket.instances[0]!;
        first.open();
        await connecting;
        first.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });

        const deflate = createDeflate();
        const chunks: Buffer[] = [];
        deflate.on("data", (chunk: Buffer) => chunks.push(chunk));
        const frame = (payload: unknown): Promise<Uint8Array> =>
            new Promise((resolve) => {
                deflate.write(Buffer.from(JSON.stringify(payload)));
                deflate.flush(zlibConstants.Z_SYNC_FLUSH, () => {
                    const merged = Buffer.concat(chunks);
                    chunks.length = 0;
                    resolve(new Uint8Array(merged));
                });
            });

        const readyFrame = await frame({
            op: GatewayOpcodes.Dispatch,
            t: "READY",
            s: 2,
            d: ready(),
        });
        first.emit("message", { data: readyFrame.buffer });
        for (let i = 0; i < 20 && !gateway.state; i++)
            await new Promise((resolve) => setTimeout(resolve, 5));
        await new Promise((resolve) => setTimeout(resolve, 20));

        const lateFrame = await frame({
            op: GatewayOpcodes.Dispatch,
            t: "MESSAGE_CREATE",
            s: 8888,
            d: { content: "late" },
        });
        const seen: unknown[] = [];
        gateway.on("MESSAGE_CREATE", (data) => seen.push(data));

        // Deliver the frame, then replace the socket before decoding finishes.
        first.emit("message", { data: lateFrame.buffer });
        first.close(1006);
        await new Promise((resolve) => setTimeout(resolve, 40));

        const second = FakeWebSocket.instances[1]!;
        expect(second.url).toBe("wss://resume.test");
        second.open();
        second.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });

        expect(seen).toEqual([]);
        const resume = second
            .payloads()
            .find((p) => p.op === GatewayOpcodes.Resume);
        expect(resume?.d.seq).toBe(2);
        gateway.close();
    });

    test("12: a dispatch on a superseded socket cannot corrupt the RESUME", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 5,
            reconnectMaxDelay: 5,
        });
        await connectReady(gateway, 4);
        const stale = FakeWebSocket.instances[0]!;
        stale.close(1006);
        await new Promise((resolve) => setTimeout(resolve, 40));

        const second = FakeWebSocket.instances[1]!;
        second.open();

        // The abandoned socket delivers a late dispatch with a bogus sequence.
        const seen: unknown[] = [];
        gateway.on("MESSAGE_CREATE", (data) => seen.push(data));
        stale.emit("message", {
            data: JSON.stringify({
                op: GatewayOpcodes.Dispatch,
                t: "MESSAGE_CREATE",
                s: 9999,
                d: { content: "late" },
            }),
        });
        expect(seen).toEqual([]);

        second.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });
        const resume = second
            .payloads()
            .find((p) => p.op === GatewayOpcodes.Resume);
        expect(resume?.d.seq).toBe(4);
        gateway.close();
    });
});
