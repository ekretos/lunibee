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
    readonly #listeners = new Map<string, Set<(data: unknown) => void>>();

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
        if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
        if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
        this.#ws?.close(1000);
        this.#ws = undefined;
    }

    /** Registers a Gateway event listener. */
    public on(event: string, listener: (data: unknown) => void): this {
        let listeners = this.#listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.#listeners.set(event, listeners);
        }
        listeners.add(listener);
        return this;
    }

    /** Sends a raw Gateway payload. */
    public send(payload: GatewayPayload): void {
        if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(payload));
    }

    #open(url: string): void {
        const ws = new WebSocket(url);
        this.#ws = ws;
        ws.addEventListener("message", event => this.#message(ws, String(event.data)));
        ws.addEventListener("close", event => this.#close(event.code));
        ws.addEventListener("error", () => this.#emit("error", new Error("Gateway WebSocket error")));
    }

    #message(ws: WebSocket, raw: string): void {
        let payload: GatewayPayload;
        try { payload = JSON.parse(raw) as GatewayPayload; } catch { ws.close(1002); return; }
        if (typeof payload.s === "number") this.#sequence = payload.s;
        switch (payload.op) {
            case GatewayOpcodes.Dispatch:
                if (payload.t === "READY") {
                    const data = payload.d as { session_id: string; resume_gateway_url: string };
                    this.#sessionId = data.session_id;
                    this.#resumeURL = data.resume_gateway_url;
                    this.#attempt = 0;
                }
                this.#emit(payload.t ?? "dispatch", payload.d);
                break;
            case GatewayOpcodes.Hello:
                this.#startHeartbeat((payload.d as { heartbeat_interval: number }).heartbeat_interval);
                this.#identifyOrResume();
                break;
            case GatewayOpcodes.Heartbeat:
                this.#heartbeat();
                break;
            case GatewayOpcodes.HeartbeatAck:
                this.#heartbeatACK = true;
                break;
            case GatewayOpcodes.Reconnect:
                ws.close(1001);
                break;
            case GatewayOpcodes.InvalidSession:
                this.#sessionId = undefined;
                this.#sequence = null;
                ws.close(1000);
                break;
        }
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
            if (!this.#heartbeatACK) { this.#ws?.close(1001); return; }
            this.#heartbeat();
        }, interval);
    }

    #heartbeat(): void {
        this.#heartbeatACK = false;
        this.send({ op: GatewayOpcodes.Heartbeat, d: this.#sequence, s: null, t: null });
    }

    #close(code: number): void {
        if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
        if (this.#closed || !this.#options.reconnect || [4004, 4010, 4011, 4012, 4013, 4014].includes(code)) return;
        if (code === 4007 || code === 4009) { this.#sequence = null; this.#sessionId = undefined; }
        if (this.#attempt >= this.#options.maxReconnectAttempts) return;
        const delay = Math.min(30_000, 1_000 * 2 ** this.#attempt++) + Math.random() * 250;
        this.#reconnectTimer = setTimeout(() => { this.#reconnectTimer = undefined; void this.connect(this.#resumeURL ?? undefined); }, delay);
    }

    #emit(event: string, data: unknown): void {
        for (const listener of this.#listeners.get(event) ?? []) void listener(data);
    }
}
