import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    Gateway,
    GatewayCloseCodes,
    GatewayOpcodes,
    GatewayState,
    Status,
} from "./index.ts";

/**
 * Discord.js-familiarity + reconnect/resume regression suite for the Gateway.
 *
 * Complements `tests/gateway.integration.test.ts` (owned lifecycle coverage)
 * with the compatibility guarantees Vikram (T3-gateway) is accountable for:
 * the additive `Status` / `GatewayCloseCodes` surface, resumable INVALID_SESSION
 * handling, RESUMED backoff reset, and identify-path resume-URL hygiene.
 */
class FakeWebSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];
    readonly url: string;
    readyState = 0;
    sent: string[] = [];
    closeCode?: number;
    closeReason?: string;
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
        this.closeReason = reason;
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
}

const OriginalWebSocket = globalThis.WebSocket;
const DEFAULT_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";

/** Drives a Gateway to a READY session over a fake socket and returns both. */
async function connectReady(options: Record<string, unknown> = {}) {
    const gateway = new Gateway({
        token: "token",
        intents: 1,
        reconnectBaseDelay: 1,
        reconnectMaxDelay: 1,
        ...options,
    });
    const promise = gateway.connect();
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.open();
    await promise;
    socket.receive({
        op: GatewayOpcodes.Hello,
        d: { heartbeat_interval: 100 },
    });
    socket.receive({
        op: GatewayOpcodes.Dispatch,
        t: "READY",
        s: 5,
        d: { session_id: "sess", resume_gateway_url: "wss://resume.test" },
    });
    return { gateway, socket };
}

beforeEach(() => {
    FakeWebSocket.instances = [];
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
});

describe("Gateway Discord.js-familiar surface", () => {
    test("Status is an additive alias of GatewayState", () => {
        expect(Status).toBe(GatewayState);
        expect(Status.Ready).toBe(GatewayState.Ready);
    });

    test("GatewayCloseCodes match the Discord protocol values", () => {
        expect(GatewayCloseCodes.AuthenticationFailed).toBe(4004);
        expect(GatewayCloseCodes.InvalidSeq).toBe(4007);
        expect(GatewayCloseCodes.RateLimited).toBe(4008);
        expect(GatewayCloseCodes.SessionTimedOut).toBe(4009);
        expect(GatewayCloseCodes.DisallowedIntents).toBe(4014);
    });
});

describe("Gateway resume / reconnect behaviour", () => {
    test("keeps the session and resumes on a resumable INVALID_SESSION (d=true)", async () => {
        const { gateway, socket } = await connectReady();
        const invalid: unknown[] = [];
        gateway.on("invalidSession", (d) => invalid.push(d));

        socket.receive({ op: GatewayOpcodes.InvalidSession, d: true });
        expect(invalid).toEqual([true]);
        // Non-1000 close so the lifecycle takes the resume branch.
        expect(socket.closeCode).toBe(GatewayCloseCodes.UnknownError);

        await Bun.sleep(10);
        const next = FakeWebSocket.instances.at(-1)!;
        expect(next).not.toBe(socket);
        // Reconnect targets the resume URL, then RESUMEs the same session.
        expect(next.url).toBe("wss://resume.test");
        next.open();
        next.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 100 },
        });
        const resume = JSON.parse(next.sent[0]!);
        expect(resume.op).toBe(GatewayOpcodes.Resume);
        expect(resume.d.session_id).toBe("sess");
        expect(resume.d.seq).toBe(5);
        gateway.close();
    });

    test("drops the session and re-identifies on a fatal INVALID_SESSION (d=false)", async () => {
        const { gateway, socket } = await connectReady();
        socket.receive({ op: GatewayOpcodes.InvalidSession, d: false });
        expect(socket.closeCode).toBe(1000);

        await Bun.sleep(10);
        const next = FakeWebSocket.instances.at(-1)!;
        // Session + resume URL cleared → reconnect hits the main Gateway.
        expect(next.url).toBe(DEFAULT_GATEWAY);
        next.open();
        next.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 100 },
        });
        const identify = JSON.parse(next.sent[0]!);
        expect(identify.op).toBe(GatewayOpcodes.Identify);
        gateway.close();
    });

    test("emits `resumed` and resets reconnect backoff after RESUMED", async () => {
        const { gateway, socket } = await connectReady();
        const resumed: unknown[] = [];
        gateway.on("resumed", (d) => resumed.push(d));

        // Recoverable drop → resume path.
        socket.close(1001, "server reconnect");
        await Bun.sleep(10);
        const next = FakeWebSocket.instances.at(-1)!;
        next.open();
        next.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 100 },
        });
        expect(JSON.parse(next.sent[0]!).op).toBe(GatewayOpcodes.Resume);

        next.receive({
            op: GatewayOpcodes.Dispatch,
            t: "RESUMED",
            s: 6,
            d: {},
        });
        expect(resumed.length).toBe(1);
        expect(gateway.state).toBe(GatewayState.Ready);

        // Backoff was reset: the next drop reconnects promptly (attempt 0).
        const before = FakeWebSocket.instances.length;
        next.close(1001, "again");
        await Bun.sleep(10);
        expect(FakeWebSocket.instances.length).toBe(before + 1);
        gateway.close();
    });

    test("4009 session timeout forces a fresh identify to the main Gateway", async () => {
        const { gateway, socket } = await connectReady();
        socket.close(GatewayCloseCodes.SessionTimedOut);
        await Bun.sleep(10);
        const next = FakeWebSocket.instances.at(-1)!;
        expect(next.url).toBe(DEFAULT_GATEWAY);
        next.open();
        next.receive({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 100 },
        });
        expect(JSON.parse(next.sent[0]!).op).toBe(GatewayOpcodes.Identify);
        gateway.close();
    });

    test("4014 disallowed intents is fatal and stops reconnecting", async () => {
        const { gateway, socket } = await connectReady();
        const before = FakeWebSocket.instances.length;
        socket.close(GatewayCloseCodes.DisallowedIntents);
        await Bun.sleep(10);
        expect(FakeWebSocket.instances.length).toBe(before);
        expect(gateway.state).toBe(GatewayState.Connect);
        gateway.close();
    });
});
