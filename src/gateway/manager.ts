import { GatewayError } from "../errors.js";
import type { ClientOptions, GatewayPayload } from "../types.js";

const GATEWAY = "https://discord.com/api/v10/gateway/bot";
const OP = { Dispatch: 0, Heartbeat: 1, Identify: 2, Resume: 6, Reconnect: 7, InvalidSession: 9, Hello: 10, HeartbeatACK: 11 } as const;

/** Options controlling Gateway shard identity. */
export interface GatewayManagerOptions {
    /** Zero-based shard identifier. */
    shardId?: number;
    /** Total number of shards. */
    shardCount?: number;
}

/** Owns the root package Gateway lifecycle and reconnect timers. */
export class GatewayManager {
    /** Client configuration used for authentication and intents. */
    readonly #options: ClientOptions;
    /** Gateway shard configuration. */
    readonly #gateway: GatewayManagerOptions;
    /** Dispatch callback supplied by the client. */
    readonly #dispatch: (payload: GatewayPayload) => void;
    /** Active WebSocket connection. */
    #ws?: WebSocket;
    /** Latest Gateway sequence number. */
    #sequence: number | null = null;
    /** Active Gateway session identifier. */
    #sessionId?: string;
    /** Gateway-provided resume URL. */
    #resumeURL?: string;
    /** Heartbeat interval timer. */
    #heartbeatTimer?: ReturnType<typeof setInterval>;
    /** Initial heartbeat timeout timer. */
    #heartbeatStartTimer?: ReturnType<typeof setTimeout>;
    /** Whether the last heartbeat was acknowledged. */
    #heartbeatACK = true;
    /** Pending reconnect timer. */
    #reconnect?: ReturnType<typeof setTimeout>;
    /** Number of reconnect attempts made. */
    #attempt = 0;
    /** Whether the manager has been explicitly closed. */
    #closed = false;

    /** Creates a Gateway manager. @param options Client configuration. @param dispatch Gateway dispatch callback. @param gateway Gateway shard configuration. */
    public constructor(options: ClientOptions, dispatch: (payload: GatewayPayload) => void, gateway: GatewayManagerOptions = {}) { this.#options = options; this.#dispatch = dispatch; this.#gateway = gateway; }

    /** Retrieves the Gateway URL and opens a connection. @returns A promise fulfilled after the WebSocket is created. @throws {GatewayError} If Gateway discovery fails. */
    public async connect(): Promise<void> { this.#closed = false; const response = await fetch(GATEWAY, { headers: { Authorization: `Bot ${this.#options.token}` } }); if (!response.ok) throw new GatewayError("Unable to retrieve Discord gateway information", response.status); const info = await response.json() as { url: string }; this.#open(`${this.#resumeURL ?? info.url}?v=10&encoding=json`); }

    /** Explicitly closes the Gateway and cancels all lifecycle timers. @returns Nothing. */
    public close(): void { this.#closed = true; if (this.#reconnect) clearTimeout(this.#reconnect); if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer); if (this.#heartbeatStartTimer) clearTimeout(this.#heartbeatStartTimer); this.#ws?.close(1000); this.#ws = undefined; }

    /** Opens a WebSocket and installs Gateway dispatch handlers. @param url Gateway WebSocket URL. @returns Nothing. */
    #open(url: string): void { const ws = new WebSocket(url); this.#ws = ws; ws.addEventListener("open", () => { this.#attempt = 0; }); ws.addEventListener("message", event => { let payload: GatewayPayload; try { payload = JSON.parse(String(event.data)) as GatewayPayload; } catch { ws.close(1002); return; } if (typeof payload.s === "number") this.#sequence = payload.s; switch (payload.op) { case OP.Dispatch: if (payload.t === "READY") { const data = payload.d as { session_id: string; resume_gateway_url: string }; this.#sessionId = data.session_id; this.#resumeURL = data.resume_gateway_url; } this.#dispatch(payload); break; case OP.Hello: this.#startHeartbeat((payload.d as { heartbeat_interval: number }).heartbeat_interval); this.#identifyOrResume(); break; case OP.Heartbeat: this.#sendHeartbeat(); break; case OP.HeartbeatACK: this.#heartbeatACK = true; break; case OP.Reconnect: ws.close(1001); break; case OP.InvalidSession: this.#sessionId = undefined; this.#sequence = null; setTimeout(() => this.#identifyOrResume(), 1_000 + Math.random() * 4_000); break; } }); ws.addEventListener("close", ({ code }) => { if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer); if (this.#heartbeatStartTimer) clearTimeout(this.#heartbeatStartTimer); if (this.#closed) return; if ([4004, 4010, 4011, 4012, 4013, 4014].includes(code)) return; if (code === 4007 || code === 4009) { this.#sequence = null; this.#sessionId = undefined; } this.#scheduleReconnect(); }); }

    /** Sends a RESUME payload when a valid session exists, otherwise IDENTIFY. @returns Nothing. */
    #identifyOrResume(): void { if (this.#sessionId && this.#sequence !== null && this.#resumeURL) { this.#send({ op: OP.Resume, d: { token: this.#options.token, session_id: this.#sessionId, seq: this.#sequence }, s: null, t: null }); return; } const shardId = this.#gateway.shardId ?? 0; const shardCount = this.#gateway.shardCount ?? 1; this.#send({ op: OP.Identify, d: { token: this.#options.token, intents: this.#options.intents, properties: { os: "linux", browser: "lunibee", device: "lunibee" }, shard: [shardId, shardCount] }, s: null, t: null }); }

    /** Starts the heartbeat cadence and zombie-connection detection. @param interval Heartbeat interval in milliseconds. @returns Nothing. */
    #startHeartbeat(interval: number): void { if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer); if (this.#heartbeatStartTimer) clearTimeout(this.#heartbeatStartTimer); this.#heartbeatACK = true; this.#heartbeatStartTimer = setTimeout(() => this.#sendHeartbeat(), Math.random() * interval); this.#heartbeatTimer = setInterval(() => { if (!this.#heartbeatACK) { this.#ws?.close(1001); return; } this.#sendHeartbeat(); }, interval); }

    /** Sends one Gateway heartbeat and marks the connection as awaiting ACK. @returns Nothing. */
    #sendHeartbeat(): void { this.#heartbeatACK = false; this.#send({ op: OP.Heartbeat, d: this.#sequence, s: null, t: null }); }

    /** Serializes and sends a Gateway payload when the socket is open. @param payload Gateway payload. @returns Nothing. */
    #send(payload: GatewayPayload): void { if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(JSON.stringify(payload)); }

    /** Schedules an exponential-backoff reconnect when permitted. @returns Nothing. */
    #scheduleReconnect(): void { const config = this.#options.gateway; if (config?.reconnect === false || this.#closed || this.#reconnect) return; const max = config?.maxReconnectAttempts ?? Infinity; if (this.#attempt >= max) return; const base = config?.reconnectBaseDelay ?? 1_000; const maxDelay = config?.reconnectMaxDelay ?? 30_000; const delay = Math.min(maxDelay, base * 2 ** this.#attempt++) + Math.random() * 250; this.#reconnect = setTimeout(() => { this.#reconnect = undefined; void this.connect().catch(() => this.#scheduleReconnect()); }, delay); }
}
