import type { GatewayPayload, GatewayProperties, GatewayPresence } from "@lunibee/types";

/** Discord Gateway opcodes. */
export const GatewayOpcodes = { Dispatch: 0, Heartbeat: 1, Identify: 2, PresenceUpdate: 3, VoiceStateUpdate: 4, Resume: 6, Reconnect: 7, RequestGuildMembers: 8, InvalidSession: 9, Hello: 10, HeartbeatAck: 11 } as const;
/** Gateway connection lifecycle states. */
export enum GatewayState {
    /** Initial connection state. */ Connect = "CONNECT",
    /** Gateway HELLO received state. */ Hello = "HELLO",
    /** IDENTIFY operation in progress. */ Identify = "IDENTIFY",
    /** RESUME operation in progress. */ Resume = "RESUME",
    /** Gateway READY state. */ Ready = "READY",
    /** Gateway dispatch processing state. */ Dispatch = "DISPATCH",
    /** Heartbeat processing state. */ Heartbeat = "HEARTBEAT",
    /** Reconnect in progress. */ Reconnect = "RECONNECT",
    /** Gateway is permanently closed. */ Closed = "CLOSED",
}
/** Gateway protocol error. */
export class GatewayError extends Error { /** Gateway close/error code. */ public readonly code?: number; /** Creates a Gateway error. @param message Error message. @param code Optional Gateway code. @param options Optional error metadata. */ public constructor(message: string, code?: number, options?: ErrorOptions) { super(message, options); this.name = "GatewayError"; this.code = code; } }
/** Gateway connection configuration. */
export interface GatewayOptions { /** Authentication token. */ token: string; /** Gateway intent bitfield. */ intents: number; /** Shard identifier. */ shardId?: number; /** Total shard count. */ shardCount?: number; /** Whether automatic reconnect is enabled. */ reconnect?: boolean; /** Maximum reconnect attempts. */ maxReconnectAttempts?: number; /** Initial reconnect delay. */ reconnectBaseDelay?: number; /** Maximum reconnect delay. */ reconnectMaxDelay?: number; /** Heartbeat acknowledgement timeout. */ heartbeatAckTimeout?: number; /** Zombie connection timeout. */ zombieTimeout?: number; /** Identification properties. */ properties?: GatewayProperties; /** Presence data. */ presence?: GatewayPresence; }
/** Gateway event listener. */
type GatewayListener = (data: unknown) => unknown;
/** Manages a Discord Gateway connection. */
export class Gateway {
    /** Current Gateway lifecycle state. */
    public state: GatewayState = GatewayState.Connect;
    #options: Required<Omit<GatewayOptions, "properties" | "presence">> & { properties?: GatewayProperties; presence?: GatewayPresence }; #ws?: WebSocket; #sequence: number | null = null; #sessionId?: string; #resumeURL?: string;
    #heartbeatTimer?: ReturnType<typeof setInterval>; #initialHeartbeat?: ReturnType<typeof setTimeout>; #heartbeatAckTimer?: ReturnType<typeof setTimeout>; #heartbeatACK = true; #heartbeatInterval = 0; #heartbeatSentAt = 0;
    #lastMessageAt = 0; #zombieTimer?: ReturnType<typeof setInterval>; #zombieReported = false; #closed = false; #attempt = 0; #reconnectTimer?: ReturnType<typeof setTimeout>;
    #connectPromise?: Promise<void>; #resolveConnect?: () => void; #rejectConnect?: (error: GatewayError) => void;
    readonly #listeners = new Map<string, Set<GatewayListener>>(); readonly #sendTimestamps: number[] = [];
    /** Creates a Gateway connection manager. @param options Gateway configuration. @throws {TypeError|RangeError} If configuration is invalid. */
    public constructor(options: GatewayOptions) { if (!options.token?.trim()) throw new TypeError("A Gateway token is required."); if (!Number.isInteger(options.intents) || options.intents < 0) throw new TypeError("Gateway intents must be a non-negative integer."); this.#options = { shardId: 0, shardCount: 1, reconnect: true, maxReconnectAttempts: Infinity, reconnectBaseDelay: 1000, reconnectMaxDelay: 30000, heartbeatAckTimeout: 10000, zombieTimeout: 30000, properties: { os: "Android", browser: "Discord Android", device: "Discord Android" }, presence: { status: "online", activities: [], afk: false, since: null }, ...options }; if (this.#options.shardId < 0 || this.#options.shardId >= this.#options.shardCount) throw new RangeError("Gateway shardId must be within the configured shard count."); if (this.#options.zombieTimeout <= this.#options.heartbeatAckTimeout) throw new RangeError("Gateway zombieTimeout must be greater than heartbeatAckTimeout"); }

    /** Opens the Gateway connection. @param url Gateway WebSocket URL. @returns Promise fulfilled when the socket opens. @throws {GatewayError} If permanently closed or unable to connect. */
    public connect(url = "wss://gateway.discord.gg/?v=10&encoding=json"): Promise<void> { if (this.state === GatewayState.Closed) throw new GatewayError("Gateway has been permanently closed."); if (this.#connectPromise) return this.#connectPromise; this.#closed = false; this.#setState(GatewayState.Connect); this.#connectPromise = new Promise<void>((resolve, reject) => { this.#resolveConnect = resolve; this.#rejectConnect = reject; this.#open(url); }); return this.#connectPromise; }
    /** Permanently closes the Gateway connection. */
    public close(): void { this.#closed = true; this.#clearTimers(); this.#settleConnect(new GatewayError("Gateway connection closed before socket open.")); const ws = this.#ws; this.#ws = undefined; try { ws?.close(1000, "Client closed connection"); } catch (error) { this.#emitError(error); } this.#setState(GatewayState.Closed); }
    /** Registers a Gateway event listener. @param event Event name. @param listener Event callback. @returns This Gateway. */
    public on(event: string, listener: GatewayListener): this { if (!event || typeof listener !== "function") throw new TypeError("Gateway event and listener are required."); let listeners = this.#listeners.get(event); if (!listeners) this.#listeners.set(event, listeners = new Set()); listeners.add(listener); return this; }
    /** Removes a Gateway event listener. @param event Event name. @param listener Event callback. @returns This Gateway. */
    public off(event: string, listener: GatewayListener): this { this.#listeners.get(event)?.delete(listener); return this; }
    /** Sends a Gateway payload. @param payload Gateway payload. @returns Whether it was sent. */
    public send(payload: GatewayPayload): boolean { if (!payload || !Number.isInteger(payload.op)) throw new TypeError("Gateway payload must contain an integer opcode."); if (this.#ws?.readyState !== WebSocket.OPEN) return false; const now = Date.now(); while (this.#sendTimestamps.length && now - this.#sendTimestamps[0]! >= 60000) this.#sendTimestamps.shift(); if (this.#sendTimestamps.length >= 115) { this.#emitError(new GatewayError("Gateway send rate budget exhausted.")); return false; } try { this.#ws.send(JSON.stringify(payload)); this.#sendTimestamps.push(now); return true; } catch (error) { this.#emitError(error); return false; } }
    /** Sends a presence update. @param data Presence payload. @returns Whether it was sent. */
    public setPresence(data: GatewayPresence): boolean {
        this.#options.presence = { ...this.#options.presence, ...data };
        const payload = {
            since: this.#options.presence.since ?? null,
            activities: this.#options.presence.activities ?? [],
            status: this.#options.presence.status ?? "online",
            afk: Boolean(this.#options.presence.afk),
        };
        return this.send({ op: GatewayOpcodes.PresenceUpdate, d: payload, s: null, t: null });
    }
    /** Sends a voice state update. @param data Voice state payload. @returns Whether it was sent. */
    public setVoiceState(data: Record<string, unknown>): boolean { return this.send({ op: GatewayOpcodes.VoiceStateUpdate, d: data, s: null, t: null }); }
    /** Requests guild members. @param data Guild member request payload. @returns Whether it was sent. */
    public requestGuildMembers(data: Record<string, unknown>): boolean { return this.send({ op: GatewayOpcodes.RequestGuildMembers, d: data, s: null, t: null }); }
    #open(url: string): void { if (this.#closed) return; let ws: WebSocket; try { ws = new WebSocket(url); } catch (error) { const failure = this.#normalizeError(error); this.#emitError(failure); if (this.#options.reconnect) { this.#setState(GatewayState.Reconnect); this.#scheduleReconnect(); } else this.#settleConnect(failure); return; } this.#ws = ws; ws.addEventListener("open", () => { this.#lastMessageAt = Date.now(); this.#zombieReported = false; this.#startZombieDetection(); this.#emit("open", undefined); this.#settleConnect(); }); ws.addEventListener("message", event => { this.#lastMessageAt = Date.now(); this.#zombieReported = false; this.#message(ws, String(event.data)); }); ws.addEventListener("close", event => this.#close(ws, event.code)); ws.addEventListener("error", () => this.#emitError(new GatewayError("Gateway WebSocket error"))); }
    #startZombieDetection(): void { if (this.#zombieTimer) clearInterval(this.#zombieTimer); const interval = Math.max(1, Math.min(250, this.#options.heartbeatAckTimeout, this.#options.zombieTimeout / 2)); this.#zombieTimer = setInterval(() => { if (this.#closed || this.#ws?.readyState !== WebSocket.OPEN || this.#lastMessageAt === 0) return; const silentFor = Date.now() - this.#lastMessageAt; const deadline = Math.max(this.#options.zombieTimeout, this.#heartbeatInterval + this.#options.heartbeatAckTimeout); if (silentFor < deadline || this.#zombieReported) return; this.#zombieReported = true; const error = new GatewayError(`Gateway connection appears stale after ${silentFor}ms without traffic.`); this.#emit("zombie", { silentFor, timeout: deadline }); this.#emitError(error); try { this.#ws.close(1001, "Zombie Gateway connection"); } catch (closeError) { this.#emitError(closeError); } }, interval); }
    #message(ws: WebSocket, raw: string): void { let payload: GatewayPayload; try { payload = JSON.parse(raw) as GatewayPayload; } catch (error) { this.#emitError(new GatewayError("Gateway returned invalid JSON", undefined, { cause: error })); ws.close(1002, "Invalid JSON"); return; } if (!payload || typeof payload.op !== "number") { this.#emitError(new GatewayError("Gateway returned an invalid payload")); ws.close(1002, "Invalid payload"); return; } if (typeof payload.s === "number") this.#sequence = payload.s; switch (payload.op) { case GatewayOpcodes.Dispatch: this.#setState(GatewayState.Dispatch); this.#handleDispatch(payload.t, payload.d); break; case GatewayOpcodes.Hello: this.#handleHello(payload.d); break; case GatewayOpcodes.Heartbeat: this.#setState(GatewayState.Heartbeat); this.#sendHeartbeat(); break; case GatewayOpcodes.HeartbeatAck: this.#heartbeatACK = true; this.#clearHeartbeatAckTimer(); this.#emit("heartbeatAck", payload.d); break; case GatewayOpcodes.Reconnect: ws.close(1001, "Server requested reconnect"); break; case GatewayOpcodes.InvalidSession: this.#sessionId = undefined; this.#sequence = null; this.#emit("invalidSession", payload.d); ws.close(1000, "Invalid session"); break; } }
    #handleDispatch(event: string | null, data: unknown): void { if (event === "READY") { const ready = data as { session_id?: unknown; resume_gateway_url?: unknown }; if (typeof ready?.session_id !== "string" || typeof ready?.resume_gateway_url !== "string") { this.#emitError(new GatewayError("Gateway READY payload is missing session information")); return; } this.#sessionId = ready.session_id; this.#resumeURL = ready.resume_gateway_url; this.#attempt = 0; this.#setState(GatewayState.Ready); this.#emit("ready", data); } this.#emit(event ?? "dispatch", data); }
    #handleHello(data: unknown): void { const interval = (data as { heartbeat_interval?: unknown })?.heartbeat_interval; if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) { this.#emitError(new GatewayError("Gateway HELLO payload contains an invalid heartbeat interval")); this.#ws?.close(1002, "Invalid heartbeat interval"); return; } this.#heartbeatInterval = interval; this.#setState(this.#sessionId && this.#sequence !== null && this.#resumeURL ? GatewayState.Resume : GatewayState.Hello); this.#startHeartbeat(interval); this.#identifyOrResume(); }
    #identifyOrResume(): void {
        if (this.#sessionId && this.#sequence !== null && this.#resumeURL) {
            this.#setState(GatewayState.Resume);
            this.send({ op: GatewayOpcodes.Resume, d: { token: this.#options.token, session_id: this.#sessionId, seq: this.#sequence }, s: null, t: null });
            return;
        }
        this.#setState(GatewayState.Identify);
        const props = this.#options.properties ?? { os: "Android", browser: "Discord Android", device: "Discord Android" };
        const os = props.os ?? "Android";
        const browser = props.browser ?? "Discord Android";
        const device = props.device ?? "Discord Android";
        this.send({
            op: GatewayOpcodes.Identify,
            d: {
                token: this.#options.token,
                intents: this.#options.intents,
                properties: {
                    os,
                    browser,
                    device,
                    $os: os,
                    $browser: browser,
                    $device: device,
                    ...props,
                },
                presence: {
                    since: this.#options.presence?.since ?? null,
                    activities: this.#options.presence?.activities ?? [],
                    status: this.#options.presence?.status ?? "online",
                    afk: Boolean(this.#options.presence?.afk),
                },
                shard: [this.#options.shardId, this.#options.shardCount],
            },
            s: null,
            t: null,
        });
    }
    #startHeartbeat(interval: number): void { this.#clearHeartbeatTimers(); this.#heartbeatACK = true; this.#initialHeartbeat = setTimeout(() => this.#sendHeartbeat(), Math.random() * interval); this.#heartbeatTimer = setInterval(() => this.#sendHeartbeat(), interval); }
    #sendHeartbeat(): void { this.#heartbeatACK = false; this.#heartbeatSentAt = Date.now(); if (!this.send({ op: GatewayOpcodes.Heartbeat, d: this.#sequence, s: null, t: null })) { this.#emitError(new GatewayError("Unable to send Gateway heartbeat because the WebSocket is not open.")); return; } this.#clearHeartbeatAckTimer(); this.#heartbeatAckTimer = setTimeout(() => { if (!this.#heartbeatACK) { const elapsed = Date.now() - this.#heartbeatSentAt; this.#emitError(new GatewayError(`Gateway heartbeat acknowledgement timed out after ${elapsed}ms.`)); try { this.#ws?.close(1001, "Heartbeat timeout"); } catch (error) { this.#emitError(error); } } }, this.#options.heartbeatAckTimeout); }
    #close(ws: WebSocket, code: number): void { if (this.#ws !== ws) return; this.#ws = undefined; this.#clearTimers(); const action = this.#closeAction(code); this.#emit("close", { code, action }); if (this.#closed || !this.#options.reconnect || action === "stop") { this.#setState(this.#closed ? GatewayState.Closed : GatewayState.Connect); if (this.#connectPromise) this.#settleConnect(new GatewayError(`Gateway closed before READY (code ${code}).`, code)); return; } if (action === "identify") { this.#sequence = null; this.#sessionId = undefined; } this.#setState(GatewayState.Reconnect); this.#scheduleReconnect(); }
    #closeAction(code: number): "resume" | "identify" | "stop" { if ([4004, 4010, 4011, 4012, 4013, 4014].includes(code)) return "stop"; if ([4007, 4009].includes(code)) return "identify"; return this.#sessionId && this.#sequence !== null ? "resume" : "identify"; }
    #scheduleReconnect(): void { if (this.#closed || !this.#options.reconnect || this.#reconnectTimer) return; if (this.#attempt >= this.#options.maxReconnectAttempts) { this.#settleConnect(new GatewayError("Gateway reconnect attempts exhausted.")); this.#setState(GatewayState.Connect); return; } const delay = Math.min(this.#options.reconnectMaxDelay, this.#options.reconnectBaseDelay * 2 ** this.#attempt++); const jitter = Math.random() * Math.min(250, Math.max(1, delay * 0.25)); this.#reconnectTimer = setTimeout(() => { this.#reconnectTimer = undefined; this.#open(this.#resumeURL ?? "wss://gateway.discord.gg/?v=10&encoding=json"); }, delay + jitter); }
    #settleConnect(error?: GatewayError): void { const resolve = this.#resolveConnect; const reject = this.#rejectConnect; this.#resolveConnect = undefined; this.#rejectConnect = undefined; this.#connectPromise = undefined; if (error) reject?.(error); else resolve?.(); }
    #clearHeartbeatAckTimer(): void { if (this.#heartbeatAckTimer) clearTimeout(this.#heartbeatAckTimer); this.#heartbeatAckTimer = undefined; }
    #clearHeartbeatTimers(): void { if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer); if (this.#initialHeartbeat) clearTimeout(this.#initialHeartbeat); this.#clearHeartbeatAckTimer(); this.#heartbeatTimer = undefined; this.#initialHeartbeat = undefined; }
    #clearTimers(): void { if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer); if (this.#zombieTimer) clearInterval(this.#zombieTimer); this.#reconnectTimer = undefined; this.#zombieTimer = undefined; this.#clearHeartbeatTimers(); }
    #normalizeError(error: unknown): GatewayError { return error instanceof GatewayError ? error : new GatewayError("Gateway connection failed.", undefined, { cause: error }); }
    #emitError(error: unknown): void { this.#emit("error", error instanceof Error ? error : new GatewayError(String(error))); }
    #emit(event: string, data: unknown): void { for (const listener of this.#listeners.get(event) ?? []) { try { const result = listener(data); if (result && typeof (result as PromiseLike<unknown>).then === "function") void Promise.resolve(result).catch(error => { if (event !== "error") this.#emitError(error); }); } catch (error) { if (event !== "error") this.#emitError(error); } } }
    /** Changes the Gateway lifecycle state. @param next Next lifecycle state. */
    #setState(next: GatewayState): void { if (this.state === next) return; const previous = this.state; this.state = next; this.#emit("stateChange", { previous, next }); }
}
