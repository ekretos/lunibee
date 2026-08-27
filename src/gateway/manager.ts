import { GatewayError } from "../errors.js";
import type { ClientOptions, GatewayPayload } from "../types.js";

const GATEWAY = "https://discord.com/api/v10/gateway/bot";
const OP = { Dispatch: 0, Heartbeat: 1, Identify: 2, Resume: 6, Reconnect: 7, InvalidSession: 9, Hello: 10, HeartbeatACK: 11 } as const;

export interface GatewayManagerOptions {
    shardId?: number;
    shardCount?: number;
}

export class GatewayManager {
    readonly #options: ClientOptions;
    readonly #gateway: GatewayManagerOptions;
    readonly #dispatch: (payload: GatewayPayload) => void;
    #ws?: WebSocket;
    #sequence: number | null = null;
    #sessionId?: string;
    #resumeURL?: string;
    #heartbeat?: ReturnType<typeof setInterval>;
    #heartbeatStart?: ReturnType<typeof setTimeout>;
    #heartbeatACK = true;
    #reconnect?: ReturnType<typeof setTimeout>;
    #attempt = 0;
    #closed = false;

    public constructor(options: ClientOptions, dispatch: (payload: GatewayPayload) => void, gateway: GatewayManagerOptions = {}) {
        this.#options = options;
        this.#dispatch = dispatch;
        this.#gateway = gateway;
    }

    public async connect(): Promise<void> {
        this.#closed = false;
        const response = await fetch(GATEWAY, { headers: { Authorization: `Bot ${this.#options.token}` } });
        if (!response.ok) throw new GatewayError("Unable to retrieve Discord gateway information", response.status);
        const info = await response.json() as { url: string };
        this.#open(`${this.#resumeURL ?? info.url}?v=10&encoding=json`);
    }

    public close(): void {
        this.#closed = true;
        if (this.#reconnect) clearTimeout(this.#reconnect);
        if (this.#heartbeat) clearInterval(this.#heartbeat);
        if (this.#heartbeatStart) clearTimeout(this.#heartbeatStart);
        this.#ws?.close(1000);
        this.#ws = undefined;
    }

    #open(url: string): void {
        const ws = new WebSocket(url);
        this.#ws = ws;
        ws.addEventListener("open", () => { this.#attempt = 0; });
        ws.addEventListener("message", event => {
            let payload: GatewayPayload;
            try { payload = JSON.parse(String(event.data)) as GatewayPayload; }
            catch { ws.close(1002); return; }
            if (typeof payload.s === "number") this.#sequence = payload.s;
            switch (payload.op) {
                case OP.Dispatch:
                    if (payload.t === "READY") {
                        const data = payload.d as { session_id: string; resume_gateway_url: string };
                        this.#sessionId = data.session_id;
                        this.#resumeURL = data.resume_gateway_url;
                    }
                    this.#dispatch(payload);
                    break;
                case OP.Hello:
                    this.#startHeartbeat((payload.d as { heartbeat_interval: number }).heartbeat_interval);
                    this.#identifyOrResume();
                    break;
                case OP.Heartbeat:
                    this.#heartbeat();
                    break;
                case OP.HeartbeatACK:
                    this.#heartbeatACK = true;
                    break;
                case OP.Reconnect:
                    ws.close(1001);
                    break;
                case OP.InvalidSession:
                    this.#sessionId = undefined;
                    this.#sequence = null;
                    setTimeout(() => this.#identifyOrResume(), 1_000 + Math.random() * 4_000);
                    break;
            }
        });
        ws.addEventListener("close", ({ code }) => {
            if (this.#heartbeat) clearInterval(this.#heartbeat);
            if (this.#heartbeatStart) clearTimeout(this.#heartbeatStart);
            if (this.#closed) return;
            if ([4004, 4010, 4011, 4012, 4013, 4014].includes(code)) return;
            if (code === 4007 || code === 4009) {
                this.#sequence = null;
                this.#sessionId = undefined;
            }
            this.#scheduleReconnect();
        });
    }

    #identifyOrResume(): void {
        if (this.#sessionId && this.#sequence !== null && this.#resumeURL) {
            this.#send({ op: OP.Resume, d: { token: this.#options.token, session_id: this.#sessionId, seq: this.#sequence }, s: null, t: null });
            return;
        }
        const shardId = this.#gateway.shardId ?? 0;
        const shardCount = this.#gateway.shardCount ?? 1;
        this.#send({ op: OP.Identify, d: {
            token: this.#options.token,
            intents: this.#options.intents,
            properties: { os: "linux", browser: "lunibee", device: "lunibee" },
            shard: [shardId, shardCount]
        }, s: null, t: null });
    }

    #startHeartbeat(interval: number): void {
        if (this.#heartbeat) clearInterval(this.#heartbeat);
        if (this.#heartbeatStart) clearTimeout(this.#heartbeatStart);
        this.#heartbeatACK = true;
        this.#heartbeatStart = setTimeout(() => this.#heartbeat(), Math.random() * interval);
        this.#heartbeat = setInterval(() => {
            if (!this.#heartbeatACK) { this.#ws?.close(1001); return; }
            this.#heartbeat();
        }, interval);
    }

    #heartbeat(): void {
        this.#heartbeatACK = false;
        this.#send({ op: OP.Heartbeat, d: this.#sequence, s: null, t: null });
    }

    #send(payload: GatewayPayload): void {
        if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(payload));
    }

    #scheduleReconnect(): void {
        const config = this.#options.gateway;
        if (config?.reconnect === false || this.#closed || this.#reconnect) return;
        const max = config?.maxReconnectAttempts ?? Infinity;
        if (this.#attempt >= max) return;
        const base = config?.reconnectBaseDelay ?? 1_000;
        const maxDelay = config?.reconnectMaxDelay ?? 30_000;
        const delay = Math.min(maxDelay, base * 2 ** this.#attempt++) + Math.random() * 250;
        this.#reconnect = setTimeout(() => {
            this.#reconnect = undefined;
            void this.connect().catch(() => this.#scheduleReconnect());
        }, delay);
    }
}
