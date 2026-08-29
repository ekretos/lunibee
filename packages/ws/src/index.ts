/** Gateway operation codes defined by Discord. */
export const GatewayOpcodes = { Dispatch: 0, Heartbeat: 1, Identify: 2, PresenceUpdate: 3, VoiceStateUpdate: 4, Resume: 6, Reconnect: 7, RequestGuildMembers: 8, InvalidSession: 9, Hello: 10, HeartbeatAck: 11 } as const;
import type { GatewayPayload } from "@lunibee/types";

/** Error raised by the Gateway transport or protocol. */
export class GatewayError extends Error {
    /** Gateway close code when one exists. */ public readonly code?: number;
    /** Creates a Gateway error. */
    public constructor(message: string, code?: number, options?: { cause?: unknown }) { super(message, options?.cause === undefined ? undefined : { cause: options.cause }); if (options?.cause !== undefined) this.cause = options.cause; this.name = "GatewayError"; this.code = code; }
}
/** Gateway authentication/protocol error. */
export class GatewayAuthenticationError extends GatewayError { /** Creates an authentication error. */ public constructor(message = "Discord Gateway authentication failed.", code?: number) { super(message, code); this.name = "GatewayAuthenticationError"; } }
/** Gateway close-code policy. */
export type GatewayCloseAction = "reconnect" | "resume" | "identify" | "stop";

/** Configuration for a Gateway connection. */
export interface GatewayOptions { token: string; intents: number; shardId?: number; shardCount?: number; reconnect?: boolean; maxReconnectAttempts?: number; reconnectBaseDelay?: number; reconnectMaxDelay?: number; heartbeatAckTimeout?: number; }
type GatewayListener = (data: unknown) => unknown;

/** Bun-native Discord Gateway connection with heartbeat, resume, and reconnect handling. */
export class Gateway {
    #options: Required<GatewayOptions>; #ws?: WebSocket; #sequence: number | null = null; #sessionId?: string; #resumeURL?: string;
    #heartbeatTimer?: ReturnType<typeof setInterval>; #initialHeartbeat?: ReturnType<typeof setTimeout>; #heartbeatACK = true; #heartbeatSentAt = 0;
    #closed = false; #attempt = 0; #reconnectTimer?: ReturnType<typeof setTimeout>; #initialConnect?: { resolve: () => void; reject: (error: Error) => void; settled: boolean };
    readonly #listeners = new Map<string, Set<GatewayListener>>(); #sendTimestamps: number[] = [];

    /** Creates a Gateway connection manager. */
    public constructor(options: GatewayOptions) {
        if (!options.token?.trim()) throw new TypeError("A Gateway token is required.");
        if (!Number.isInteger(options.intents) || options.intents < 0) throw new RangeError("Gateway intents must be a non-negative integer.");
        this.#options = { shardId: 0, shardCount: 1, reconnect: true, maxReconnectAttempts: Infinity, reconnectBaseDelay: 1000, reconnectMaxDelay: 30000, heartbeatAckTimeout: 10000, ...options };
        if (this.#options.shardCount < 1 || !Number.isInteger(this.#options.shardCount)) throw new RangeError("Gateway shardCount must be a positive integer.");
        if (this.#options.shardId < 0 || this.#options.shardId >= this.#options.shardCount) throw new RangeError("Gateway shardId must be within the configured shard count.");
    }
    /** Opens a Gateway connection and settles when the initial socket opens or fails. */
    public connect(url = "wss://gateway.discord.gg/?v=10&encoding=json"): Promise<void> {
        if (this.#closed) this.#closed = false;
        if (this.#initialConnect && !this.#initialConnect.settled) return new Promise((resolve, reject) => { const p = this.#initialConnect!; const r = p.resolve, j = p.reject; p.resolve = () => { r(); resolve(); }; p.reject = e => { j(e); reject(e); }; });
        return new Promise((resolve, reject) => { this.#initialConnect = { resolve, reject, settled: false }; try { this.#open(url); } catch (error) { this.#settleInitialConnect(this.#normalizeError(error)); } });
    }
    /** Permanently closes the connection. */
    public close(): void { this.#closed = true; this.#clearTimers(); this.#settleInitialConnect(new GatewayError("Gateway connection closed before opening.")); this.#ws?.close(1000, "Client closed connection"); this.#ws = undefined; }
    /** Registers a Gateway event listener. */
    public on(event: string, listener: GatewayListener): this { if (!event || typeof listener !== "function") throw new TypeError("Gateway event and listener are required."); let list = this.#listeners.get(event); if (!list) this.#listeners.set(event, list = new Set()); list.add(listener); return this; }
    /** Removes a Gateway event listener. */ public off(event: string, listener: GatewayListener): this { this.#listeners.get(event)?.delete(listener); return this; }
    /** Sends a protocol payload when the socket and Gateway send budget permit it. */
    public send(payload: GatewayPayload): boolean {
        if (!payload || !Number.isInteger(payload.op)) throw new TypeError("Gateway payload must contain an integer opcode.");
        if (this.#ws?.readyState !== WebSocket.OPEN) return false;
        const now = Date.now(); this.#sendTimestamps = this.#sendTimestamps.filter(time => now - time < 60_000);
        if (this.#sendTimestamps.length >= 115) { this.#emitError(new GatewayError("Gateway send rate budget exhausted.")); return false; }
        try { this.#ws.send(JSON.stringify(payload)); this.#sendTimestamps.push(now); return true; } catch (error) { this.#emitError(error); return false; }
    }
    /** Sends a presence update. */ public setPresence(data: Record<string, unknown>): boolean { return this.send({ op: GatewayOpcodes.PresenceUpdate, d: data, s: null, t: null }); }
    /** Sends a voice-state update. */ public setVoiceState(data: Record<string, unknown>): boolean { return this.send({ op: GatewayOpcodes.VoiceStateUpdate, d: data, s: null, t: null }); }
    /** Requests guild members. */ public requestGuildMembers(data: Record<string, unknown>): boolean { return this.send({ op: GatewayOpcodes.RequestGuildMembers, d: data, s: null, t: null }); }

    #open(url: string): void {
        if (this.#closed) return;
        let ws: WebSocket; try { ws = new WebSocket(url); } catch (error) { const normalized = this.#normalizeError(error); this.#emitError(normalized); this.#settleInitialConnect(normalized); this.#scheduleReconnect(); return; }
        this.#ws = ws; let opened = false;
        ws.addEventListener("open", () => { opened = true; this.#settleInitialConnect(); });
        ws.addEventListener("message", event => this.#message(ws, String(event.data)));
        ws.addEventListener("close", event => { if (!opened) this.#settleInitialConnect(new GatewayError(`Gateway WebSocket closed before opening (code ${event.code}).`, event.code)); this.#close(ws, event.code); });
        ws.addEventListener("error", () => { const error = new GatewayError("Gateway WebSocket error"); this.#emitError(error); if (!opened) this.#settleInitialConnect(error); });
    }
    #settleInitialConnect(error?: Error): void { const pending = this.#initialConnect; if (!pending || pending.settled) return; pending.settled = true; if (error) pending.reject(error); else pending.resolve(); this.#initialConnect = undefined; }
    #message(ws: WebSocket, raw: string): void {
        let payload: GatewayPayload; try { payload = JSON.parse(raw) as GatewayPayload; } catch (error) { this.#emitError(new GatewayError("Gateway returned invalid JSON", undefined, { cause: error })); ws.close(1002, "Invalid JSON"); return; }
        if (!payload || typeof payload.op !== "number") { this.#emitError(new GatewayError("Gateway returned an invalid payload")); ws.close(1002, "Invalid payload"); return; }
        if (typeof payload.s === "number") this.#sequence = payload.s;
        if (payload.op === GatewayOpcodes.Dispatch) { this.#handleDispatch(payload.t, payload.d); return; }
        if (payload.op === GatewayOpcodes.Hello) { this.#handleHello(payload.d); return; }
        if (payload.op === GatewayOpcodes.Heartbeat) { this.#heartbeat(); return; }
        if (payload.op === GatewayOpcodes.HeartbeatAck) { this.#heartbeatACK = true; return; }
        if (payload.op === GatewayOpcodes.Reconnect) { ws.close(1001, "Server requested reconnect"); return; }
        if (payload.op === GatewayOpcodes.InvalidSession) { this.#sessionId = undefined; this.#sequence = null; this.#emit("invalidSession", payload.d); ws.close(1000, "Invalid session"); return; }
    }
    #handleDispatch(event: string | null, data: unknown): void {
        if (event === "READY") { const ready = data as { session_id?: unknown; resume_gateway_url?: unknown }; if (typeof ready?.session_id !== "string" || typeof ready?.resume_gateway_url !== "string") { this.#emitError(new GatewayError("Gateway READY payload is missing session information")); return; } this.#sessionId = ready.session_id; this.#resumeURL = ready.resume_gateway_url; this.#attempt = 0; this.#emit("ready", data); }
        this.#emit(event ?? "dispatch", data);
    }
    #handleHello(data: unknown): void { const interval = (data as { heartbeat_interval?: unknown })?.heartbeat_interval; if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) { this.#emitError(new GatewayError("Gateway HELLO payload contains an invalid heartbeat interval")); this.#ws?.close(1002, "Invalid heartbeat interval"); return; } this.#startHeartbeat(interval); this.#identifyOrResume(); }
    #identifyOrResume(): void {
        if (this.#sessionId && this.#sequence !== null && this.#resumeURL) { this.send({ op: GatewayOpcodes.Resume, d: { token: this.#options.token, session_id: this.#sessionId, seq: this.#sequence }, s: null, t: null }); return; }
        this.send({ op: GatewayOpcodes.Identify, d: { token: this.#options.token, intents: this.#options.intents, properties: { os: "linux", browser: "lunibee", device: "lunibee" }, shard: [this.#options.shardId, this.#options.shardCount] }, s: null, t: null });
    }
    #startHeartbeat(interval: number): void { this.#clearHeartbeatTimers(); this.#heartbeatACK = true; this.#initialHeartbeat = setTimeout(() => this.#heartbeat(), Math.random() * interval); this.#heartbeatTimer = setInterval(() => { if (!this.#heartbeatACK || (this.#heartbeatSentAt > 0 && Date.now() - this.#heartbeatSentAt > this.#options.heartbeatAckTimeout)) { this.#emitError(new GatewayError("Gateway heartbeat acknowledgement timed out.")); this.#ws?.close(1001, "Heartbeat timeout"); return; } this.#heartbeat(); }, interval); }
    #heartbeat(): void { this.#heartbeatACK = false; this.#heartbeatSentAt = Date.now(); if (!this.send({ op: GatewayOpcodes.Heartbeat, d: this.#sequence, s: null, t: null })) this.#emitError(new GatewayError("Unable to send Gateway heartbeat because the WebSocket is not open.")); }
    #close(ws: WebSocket, code: number): void { if (this.#ws !== ws) return; this.#ws = undefined; this.#clearHeartbeatTimers(); const action = this.#closeAction(code); this.#emit("close", { code, action }); if (this.#closed || !this.#options.reconnect || action === "stop") return; if (action === "identify") { this.#sessionId = undefined; this.#sequence = null; } this.#scheduleReconnect(); }
    #closeAction(code: number): GatewayCloseAction { if ([4004, 4010, 4011, 4012, 4013, 4014].includes(code)) return "stop"; if ([4007, 4009].includes(code)) return "identify"; return this.#sessionId && this.#sequence !== null ? "resume" : "reconnect"; }
    #scheduleReconnect(): void { if (this.#closed || !this.#options.reconnect || this.#reconnectTimer || this.#attempt >= this.#options.maxReconnectAttempts) return; const delay = Math.min(this.#options.reconnectMaxDelay, this.#options.reconnectBaseDelay * 2 ** this.#attempt++) + Math.random() * 250; this.#reconnectTimer = setTimeout(() => { this.#reconnectTimer = undefined; this.#open(this.#resumeURL ?? "wss://gateway.discord.gg/?v=10&encoding=json"); }, delay); }
    #clearHeartbeatTimers(): void { if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer); if (this.#initialHeartbeat) clearTimeout(this.#initialHeartbeat); this.#heartbeatTimer = undefined; this.#initialHeartbeat = undefined; }
    #clearTimers(): void { if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer); this.#reconnectTimer = undefined; this.#clearHeartbeatTimers(); }
    #normalizeError(error: unknown): GatewayError { return error instanceof GatewayError ? error : new GatewayError("Gateway connection failed.", undefined, { cause: error }); }
    #emitError(error: unknown): void { this.#emit("error", error instanceof Error ? error : new GatewayError(String(error))); }
    #emit(event: string, data: unknown): void { for (const listener of this.#listeners.get(event) ?? []) { try { const result = listener(data); if (result && typeof (result as PromiseLike<unknown>).then === "function") void Promise.resolve(result).catch(error => event === "error" ? undefined : this.#emitError(error)); } catch (error) { if (event !== "error") this.#emitError(error); } } }
}
