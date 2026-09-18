import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    Gateway,
    GatewayCloseCodes,
    GatewayOpcodes,
    GatewayState,
    GatewayReconnect,
    classifyCloseCode,
    FATAL_CLOSE_CODES,
    IDENTIFY_CLOSE_CODES,
} from "../packages/ws/src/index.ts";

/**
 * Stage 1B.3 acceptance. Close classification and scheduling are asserted
 * directly on the seam; the Gateway-level tests then prove the wiring, and the
 * WS-003 regression pins the terminal state of a fatal close.
 */
function reconnect(
    options: Partial<{
        enabled: boolean;
        maxAttempts: number;
        baseDelay: number;
        maxDelay: number;
    }> = {},
): GatewayReconnect {
    return new GatewayReconnect({
        enabled: options.enabled ?? true,
        maxAttempts: options.maxAttempts ?? Infinity,
        baseDelay: options.baseDelay ?? 10,
        maxDelay: options.maxDelay ?? 100,
        // Deterministic jitter so delays are exact in tests.
        random: () => 0,
    });
}

const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

describe("close classification", () => {
    test("4: fatal codes never reconnect", () => {
        for (const code of FATAL_CLOSE_CODES) {
            expect(classifyCloseCode(code, true)).toBe("stop");
            expect(classifyCloseCode(code, false)).toBe("stop");
        }
        expect(FATAL_CLOSE_CODES).toContain(
            GatewayCloseCodes.AuthenticationFailed,
        );
    });

    test("5: session-destroying codes require a fresh IDENTIFY", () => {
        for (const code of IDENTIFY_CLOSE_CODES) {
            // Even with a resumable session, these codes forbid resuming.
            expect(classifyCloseCode(code, true)).toBe("identify");
            expect(classifyCloseCode(code, false)).toBe("identify");
        }
        expect(IDENTIFY_CLOSE_CODES).toEqual([
            GatewayCloseCodes.InvalidSeq,
            GatewayCloseCodes.SessionTimedOut,
        ]);
    });

    test("6: a resumable session resumes after an ordinary close", () => {
        expect(classifyCloseCode(1006, true)).toBe("resume");
        expect(classifyCloseCode(1001, true)).toBe("resume");
        expect(classifyCloseCode(GatewayCloseCodes.UnknownError, true)).toBe(
            "resume",
        );
    });

    test("7: an unknown code reconnects, identifying when no session survives", () => {
        // The documented default: outside the two tables, the code does not
        // decide — the survival of the session does.
        expect(classifyCloseCode(4999, true)).toBe("resume");
        expect(classifyCloseCode(4999, false)).toBe("identify");
        expect(classifyCloseCode(1006, false)).toBe("identify");
        // 1000 must stay reconnectable: the Gateway itself sends it after a
        // non-resumable op 9, and that path must re-IDENTIFY, not stop.
        expect(classifyCloseCode(1000, false)).toBe("identify");
    });
});

describe("reconnect scheduling", () => {
    test("1: a reconnect is scheduled once, with backoff", async () => {
        const policy = reconnect({ baseDelay: 10, maxDelay: 100 });
        let runs = 0;
        const first = policy.schedule(() => runs++);
        expect(first).toMatchObject({
            scheduled: true,
            delayMs: 10,
            attempt: 0,
        });
        expect(policy.pending).toBe(true);
        await wait(30);
        expect(runs).toBe(1);
        expect(policy.pending).toBe(false);

        const second = policy.schedule(() => runs++);
        expect(second).toMatchObject({ scheduled: true, delayMs: 20 });
        policy.cancel();
    });

    test("2: repeated closes do not stack timers", async () => {
        const policy = reconnect({ baseDelay: 10 });
        let runs = 0;
        const results = [0, 1, 2].map(() => policy.schedule(() => runs++));
        expect(results[0]!.scheduled).toBe(true);
        expect(results[1]).toEqual({ scheduled: false, reason: "pending" });
        expect(results[2]).toEqual({ scheduled: false, reason: "pending" });
        expect(policy.attempts).toBe(1);
        await wait(40);
        expect(runs).toBe(1);
        policy.cancel();
    });

    test("3: an armed reconnect can be cancelled", async () => {
        const policy = reconnect({ baseDelay: 10 });
        let runs = 0;
        policy.schedule(() => runs++);
        policy.cancel();
        expect(policy.pending).toBe(false);
        await wait(40);
        expect(runs).toBe(0);
        // Cancelling again is harmless.
        policy.cancel();
    });

    test("10: reset clears the attempt counter", () => {
        const policy = reconnect({ baseDelay: 10 });
        policy.schedule(() => {});
        policy.cancel();
        policy.schedule(() => {});
        policy.cancel();
        expect(policy.attempts).toBe(2);
        policy.reset();
        expect(policy.attempts).toBe(0);
        expect(policy.exhausted).toBe(false);
    });

    test("11: each scheduled attempt increments the counter and the delay", () => {
        const policy = reconnect({ baseDelay: 10, maxDelay: 45 });
        const delays: number[] = [];
        for (let i = 0; i < 4; i++) {
            const result = policy.schedule(() => {});
            if (result.scheduled) delays.push(result.delayMs);
            policy.cancel();
        }
        expect(delays).toEqual([10, 20, 40, 45]);
        expect(policy.attempts).toBe(4);
    });

    test("12: the attempt budget is respected, and disabled means never", () => {
        const bounded = reconnect({ maxAttempts: 2, baseDelay: 5 });
        expect(bounded.canReconnect()).toBe(true);
        bounded.schedule(() => {});
        bounded.cancel();
        bounded.schedule(() => {});
        bounded.cancel();
        expect(bounded.exhausted).toBe(true);
        expect(bounded.canReconnect()).toBe(false);
        expect(bounded.schedule(() => {})).toEqual({
            scheduled: false,
            reason: "exhausted",
        });

        const off = reconnect({ enabled: false });
        expect(off.canReconnect()).toBe(false);
        expect(off.schedule(() => {})).toEqual({
            scheduled: false,
            reason: "disabled",
        });
    });
});

describe("connection attempt coordination", () => {
    test("9: concurrent attempts coalesce into one operation", async () => {
        const policy = reconnect();
        let starts = 0;
        const a = policy.attempt(() => starts++);
        const b = policy.attempt(() => starts++);
        const c = policy.attempt(() => starts++);
        expect(starts).toBe(1);
        expect(a).toBe(b);
        expect(b).toBe(c);
        expect(policy.connecting).toBe(true);

        policy.settle();
        await expect(a).resolves.toBeUndefined();
        expect(policy.connecting).toBe(false);

        // A later attempt starts a genuinely new operation.
        const next = policy.attempt(() => starts++);
        expect(starts).toBe(2);
        expect(next).not.toBe(a);
        policy.settle();
        await next;
    });

    test("a rejected attempt settles every joined caller", async () => {
        const policy = reconnect();
        const first = policy.attempt(() => {});
        const joined = policy.attempt(() => {});
        policy.settle(new Error("closed before READY"));
        await expect(first).rejects.toThrow("closed before READY");
        await expect(joined).rejects.toThrow("closed before READY");
        expect(policy.connecting).toBe(false);
    });
});

class FakeWebSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];
    readonly url: string;
    readyState = 0;
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
    receive(payload: unknown): void {
        this.emit("message", { data: JSON.stringify(payload) });
    }
    emit(event: string, value: unknown): void {
        for (const listener of this.#listeners.get(event) ?? [])
            listener(value);
    }
    payloads(): Array<{ op: number; d?: any }> {
        return this.sent.map((raw) => JSON.parse(raw));
    }
}

/** Connects a Gateway and drives it to READY with a resumable session. */
async function connectReady(gateway: Gateway): Promise<FakeWebSocket> {
    const connecting = gateway.connect("wss://main.test");
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
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
            s: 5,
            d: {
                session_id: "session-1",
                resume_gateway_url: "wss://resume.test",
            },
        }),
    });
    return socket;
}

describe("Gateway reconnect wiring", () => {
    const OriginalWebSocket = globalThis.WebSocket;
    beforeEach(() => {
        FakeWebSocket.instances = [];
        globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    });
    afterEach(() => {
        globalThis.WebSocket = OriginalWebSocket;
    });

    test("8: connecting while an attempt is in flight does not open a second socket", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: false,
        });
        const first = gateway.connect("wss://main.test");
        const second = gateway.connect("wss://main.test");
        const third = gateway.connect("wss://main.test");
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(second).toBe(first);
        expect(third).toBe(first);

        FakeWebSocket.instances[0]!.open();
        await first;
        expect(FakeWebSocket.instances).toHaveLength(1);
        gateway.close();
    });

    test("6: a resumable close reconnects to the resume host", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 5,
            reconnectMaxDelay: 5,
        });
        const socket = await connectReady(gateway);
        socket.close(1006);
        await wait(40);
        expect(FakeWebSocket.instances[1]!.url).toBe("wss://resume.test");
        gateway.close();
    });

    test("5: a session-destroying close reconnects to the main host and identifies", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 5,
            reconnectMaxDelay: 5,
        });
        const socket = await connectReady(gateway);
        const actions: unknown[] = [];
        gateway.on("close", (data) =>
            actions.push((data as { action: string }).action),
        );
        socket.close(GatewayCloseCodes.SessionTimedOut);
        await wait(40);

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

    test("2: repeated closes on the same Gateway produce one reconnect", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 15,
            reconnectMaxDelay: 15,
        });
        const socket = await connectReady(gateway);
        socket.close(1006);
        // Further close events on the same socket must not arm more timers.
        socket.emit("close", { code: 1006, reason: "" });
        socket.emit("close", { code: 1006, reason: "" });
        await wait(60);
        expect(FakeWebSocket.instances).toHaveLength(2);
        gateway.close();
    });

    test("13-14: shutdown cancels a pending reconnect — no resurrection", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 25,
            reconnectMaxDelay: 25,
        });
        const socket = await connectReady(gateway);
        socket.close(1006);
        // A reconnect is now armed; shutting down must disarm it.
        gateway.close();
        expect(gateway.state).toBe(GatewayState.Closed);
        await wait(80);
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(() => gateway.connect()).toThrow(/permanently closed/);
    });

    test("14-15: WS-003 — a fatal close leaves the Gateway CLOSED", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            reconnectBaseDelay: 5,
            reconnectMaxDelay: 5,
        });
        const socket = await connectReady(gateway);
        const closes: Array<{ code: number; action: string }> = [];
        gateway.on("close", (data) =>
            closes.push(data as { code: number; action: string }),
        );

        socket.close(GatewayCloseCodes.AuthenticationFailed);
        await wait(40);

        expect(closes).toHaveLength(1);
        expect(closes[0]!.action).toBe("stop");
        // No reconnect, and the state reports the connection as terminal rather
        // than as though an attempt were imminent.
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(gateway.state).toBe(GatewayState.Closed);
        expect(() => gateway.connect()).toThrow(/permanently closed/);
    });

    test("10: a successful reconnect clears the attempt state", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            maxReconnectAttempts: 2,
            reconnectBaseDelay: 5,
            reconnectMaxDelay: 5,
        });
        const socket = await connectReady(gateway);
        socket.close(1006);
        await wait(40);

        // Reaching RESUMED resets the budget, so a later drop can retry again.
        const second = FakeWebSocket.instances[1]!;
        second.open();
        second.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 45_000 },
        });
        second.emit("message", {
            data: JSON.stringify({
                op: GatewayOpcodes.Dispatch,
                t: "RESUMED",
                s: 6,
                d: {},
            }),
        });
        expect(gateway.state).toBe(GatewayState.Ready);

        second.close(1006);
        await wait(40);
        expect(FakeWebSocket.instances).toHaveLength(3);
        gateway.close();
    });

    test("12: exhausting the budget stops reconnecting without going CLOSED", async () => {
        const gateway = new Gateway({
            token: "token",
            intents: 1,
            reconnect: true,
            maxReconnectAttempts: 1,
            reconnectBaseDelay: 5,
            reconnectMaxDelay: 5,
        });
        const socket = await connectReady(gateway);
        socket.close(1006);
        await wait(30);
        FakeWebSocket.instances[1]!.close(1006);
        await wait(30);
        // The budget is spent: no third socket, but the Gateway is not fatally
        // closed — a caller may still connect() again deliberately.
        expect(FakeWebSocket.instances).toHaveLength(2);
        expect(gateway.state).toBe(GatewayState.Connect);
        gateway.close();
    });
});
