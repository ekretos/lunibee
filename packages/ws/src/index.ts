import type { GatewayPayload } from "@lunibee/types";

/** Gateway operation codes defined by Discord. */
export const GatewayOpcodes = {
    /** Dispatch event. */
    Dispatch: 0,
    /** Client heartbeat. */
    Heartbeat: 1,
    /** Client Identify. */
    Identify: 2,
    /** Client Resume. */
    Resume: 6,
    /** Server requests reconnect. */
    Reconnect: 7,
    /** Server invalidates the session. */
    InvalidSession: 9,
    /** Server Hello. */
    Hello: 10,
    /** Server heartbeat acknowledgement. */
    HeartbeatAck: 11
} as const;

/** Options for a Gateway connection. */
export interface GatewayOptions {
    /** Discord bot token. */
    token: string;
    /** Gateway intents. */
    intents: number;
    /** Shard ID. @default 0 */
    shardId?: number;
    /** Total shard count. @default 1 */
    shardCount?: number;
    /** Automatically reconnect after recoverable disconnects. @default true */
    reconnect?: boolean;
    /** Maximum reconnect attempts. @default Infinity */
    maxReconnectAttempts?: number;
}

type GatewayListener = (data: unknown) => unknown;

/** A lightweight Discord Gateway connection. */
export class Gateway {
    #options: Required<GatewayOptions>;
    #ws?: WebSocket;
    #sequence: number | null = null;
    #sessionId?: string;
    #resumeURL?: string;
    #heartbeatTimer?: ReturnType<typeof setInterval>;
    #heartbeatACK = true;
    #closed = false;
    #attempt = 0;
    #reconnectTimer?: ReturnType<typeof setTimeout>;
    readonly #listeners = new Map<string, Set<GatewayListener>>();

    /** Creates a Gateway connection manager. */
    public constructor(options: GatewayOptions) {
        this.#options = {
            shardId: 0,
            shardCount: 1,
            reconnect: true,
            maxReconnectAttempts: Infinity,
            ...options
        };
    }

    /** Connects to Discord's Gateway. */
    public async connect(url = "wss://gateway.discord.gg/?v=10&encoding=json"): Promise<void> {
        this.#closed = false;
        this.#open(url);
    }

    /** Permanently closes the Gateway connection and clears timers. */
    public close(): void {
        this.#closed = true;
        this.#clearTimers();
        this.#ws?.close(1000);
        this.#ws = undefined;
    }

    /** Registers a Gateway event listener. */
    public on(event: string, listener: GatewayListener): this {
        let listeners = this.#listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.#listeners.set(event, listeners);
        }
        listeners.add(listener);
        return this;
    }

    /** Sends a raw Gateway payload when the socket is open. */
    public send(payload: GatewayPayload): boolean {
        if (this.#ws?.readyState !== WebSocket.OPEN) return false;
        this.#ws.send(JSON.stringify(payload));
        return true;
    }

    #open(url: string): void {
        let ws: WebSocket;
        try {
            ws = new WebSocket(url);
        } catch (error) {
            this.#emitError(error);
            this.#scheduleReconnect();
            return;
        }

        this.#ws = ws;
        ws.addEventListener("message", event => this.#message(ws, String(event.data)));
        ws.addEventListener("close", event => this.#close(ws, event.code));
        ws.addEventListener("error", () => this.#emitError(new Error("Gateway WebSocket error")));
    }

    #message(ws: WebSocket, raw: string): void {
        let payload: GatewayPayload;
        try {
            payload = JSON.parse(raw) as GatewayPayload;
        } catch (error) {
            this.#emitError(new Error("Gateway returned invalid JSON", { cause: error }));
            ws.close(1002, "Invalid JSON");
            return;
        }

        if (!payload || typeof payload.op !== "number") {
            this.#emitError(new Error("Gateway returned an invalid payload"));
            ws.close(1002, "Invalid payload");
            return;
        }

        if (typeof payload.s === "number") this.#sequence = payload.s;

        switch (payload.op) {
            case GatewayOpcodes.Dispatch:
                this.#handleDispatch(payload.t, payload.d);
                break;
            case GatewayOpcodes.Hello:
                this.#handleHello(payload.d);
                break;
            case GatewayOpcodes.Heartbeat:
                this.#heartbeat();
                break;
            case GatewayOpcodes.HeartbeatAck:
                this.#heartbeatACK = true;
                break;
            case GatewayOpcodes.Reconnect:
                ws.close(1001, "Server requested reconnect");
                break;
            case GatewayOpcodes.InvalidSession:
                this.#sessionId = undefined;
                this.#sequence = null;
                ws.close(1000, "Invalid session");
                break;
        }
    }

    #handleDispatch(event: string | null, data: unknown): void {
        if (event === "READY") {
            const ready = data as { session_id?: unknown; resume_gateway_url?: unknown };
            if (typeof ready?.session_id !== "string" || typeof ready?.resume_gateway_url !== "string") {
                this.#emitError(new Error("Gateway READY payload is missing session information"));
                return;
            }
            this.#sessionId = ready.session_id;
            this.#resumeURL = ready.resume_gateway_url;
            this.#attempt = 0;
        }
        this.#emit(event ?? "dispatch", data);
    }

    #handleHello(data: unknown): void {
        const interval = (data as { heartbeat_interval?: unknown })?.heartbeat_interval;
        if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) {
            this.#emitError(new Error("Gateway HELLO payload contains an invalid heartbeat interval"));
            this.#ws?.close(1002, "Invalid heartbeat interval");
            return;
        }
        this.#startHeartbeat(interval);
        this.#identifyOrResume();
    }

    #identifyOrResume(): void {
        if (this.#sessionId && this.#sequence !== null && this.#resumeURL) {
            this.send({ op: GatewayOpcodes.Resume, d: { token: this.#options.token, session_id: this.#sessionId, seq: this.#sequence }, s: null, t: null });
            return;
        }
        this.send({ op: GatewayOpcodes.Identify, d: { token: this.#options.token, intents: this.#options.intents, properties: { os: "linux", browser: "lunibee", device: "lunibee" }, shard: [this.#options.shardId, this.#options.shardCount] }, s: null, t: null });
    }

    #startHeartbeat(interval: number): void {
        if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
        this.#heartbeatACK = true;
        setTimeout(() => this.#heartbeat(), Math.random() * interval);
        this.#heartbeatTimer = setInterval(() => {
            if (!this.#heartbeatACK) {
                this.#ws?.close(1001, "Heartbeat timeout");
                return;
            }
            this.#heartbeat();
        }, interval);
    }

    #heartbeat(): void {
        this.#heartbeatACK = false;
        if (!this.send({ op: GatewayOpcodes.Heartbeat, d: this.#sequence, s: null, t: null })) {
            this.#emitError(new Error("Unable to send Gateway heartbeat because the WebSocket is not open"));
        }
    }

    #close(ws: WebSocket, code: number): void {
        if (this.#ws !== ws) return;
        this.#ws = undefined;
        if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
        this.#heartbeatTimer = undefined;
        if (this.#closed || !this.#options.reconnect || [4004, 4010, 4011, 4012, 4013, 4014].includes(code)) return;
        if (code === 4007 || code === 4009) {
            this.#sequence = null;
            this.#sessionId = undefined;
        }
        this.#scheduleReconnect();
    }

    #scheduleReconnect(): void {
        if (this.#closed || !this.#options.reconnect || this.#reconnectTimer || this.#attempt >= this.#options.maxReconnectAttempts) return;
        const delay = Math.min(30_000, 1_000 * 2 ** this.#attempt++) + Math.random() * 250;
        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = undefined;
            try {
                this.#open(this.#resumeURL ?? "wss://gateway.discord.gg/?v=10&encoding=json");
            } catch (error) {
                this.#emitError(error);
                this.#scheduleReconnect();
            }
        }, delay);
    }

    #clearTimers(): void {
        if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
        if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
        this.#reconnectTimer = undefined;
        this.#heartbeatTimer = undefined;
    }

    #emitError(error: unknown): void {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.#emit("error", normalized);
    }

    #emit(event: string, data: unknown): void {
        for (const listener of this.#listeners.get(event) ?? []) {
            try {
                const result = listener(data);
                if (result && typeof (result as PromiseLike<unknown>).then === "function") {
                    void Promise.resolve(result).catch(error => this.#emitError(error));
                }
            } catch (error) {
                this.#emitError(error);
            }
        }
    }
}
