import { GatewaySession } from "./session.js";
import { GatewayHeartbeat, type HeartbeatTimeout } from "./heartbeat.js";
import { GatewayCloseCodes } from "./close-codes.js";
import { GatewayReconnect, type CloseAction } from "./reconnect.js";
import { WebSocketTransport, type SocketFactory } from "./transport.js";
import {
    resolveGatewayIntents,
    type GatewayPayload,
    type GatewayProperties,
    type GatewayPresence,
    type GatewayIntentResolvable,
} from "@lunibee/types";

export {
    WebSocketTransport,
    type TransportHandlers,
    type TransportOptions,
    type SocketFactory,
} from "./transport.js";

export {
    createDecoder,
    PlainTextDecoder,
    ZlibStreamDecoder,
    type GatewayDecoder,
} from "./decoder.js";

export {
    GatewayReconnect,
    classifyCloseCode,
    FATAL_CLOSE_CODES,
    IDENTIFY_CLOSE_CODES,
    type CloseAction,
    type ReconnectOptions,
    type ScheduleResult,
    type ScheduleRefusal,
} from "./reconnect.js";

export {
    GatewayHeartbeat,
    type HeartbeatOptions,
    type HeartbeatTimeout,
} from "./heartbeat.js";

export {
    GatewaySession,
    type ResumeInfo,
    type HandshakeIntent,
    type InvalidationReason,
} from "./session.js";

/** Discord Gateway opcodes. */
export const GatewayOpcodes = {
    Dispatch: 0,
    Heartbeat: 1,
    Identify: 2,
    PresenceUpdate: 3,
    VoiceStateUpdate: 4,
    Resume: 6,
    Reconnect: 7,
    RequestGuildMembers: 8,
    InvalidSession: 9,
    Hello: 10,
    HeartbeatAck: 11,
} as const;
export { GatewayCloseCodes } from "./close-codes.js";

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
/**
 * Discord.js-familiar alias for {@link GatewayState}.
 *
 * Discord.js exposes connection status via a `Status` enum. Lunibee's canonical
 * name is {@link GatewayState}; this is an additive alias so `discord.js` users
 * find the expected name. Note the *values* remain Lunibee's string states
 * (e.g. `"READY"`), not Discord.js's numeric `Status` members — an intentional
 * divergence documented in the compatibility matrix.
 */
export { GatewayState as Status };
/** Gateway protocol error. */
export class GatewayError extends Error {
    /** Gateway close/error code. */ public readonly code?: number;
    /** Creates a Gateway error. @param message Error message. @param code Optional Gateway code. @param options Optional error metadata. */ public constructor(
        message: string,
        code?: number,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = "GatewayError";
        this.code = code;
    }
}
/** Gateway connection configuration. */
export interface GatewayOptions {
    /** Authentication token. */ token: string;
    /** Gateway intent bitfield or resolvable. */ intents: GatewayIntentResolvable;
    /** Shard identifier. */ shardId?: number;
    /** Total shard count. */ shardCount?: number;
    /** Whether automatic reconnect is enabled. */ reconnect?: boolean;
    /** Maximum reconnect attempts. */ maxReconnectAttempts?: number;
    /** Initial reconnect delay. */ reconnectBaseDelay?: number;
    /** Maximum reconnect delay. */ reconnectMaxDelay?: number;
    /** Heartbeat acknowledgement timeout. */ heartbeatAckTimeout?: number;
    /** Zombie connection timeout. */ zombieTimeout?: number;
    /** Identification properties. */ properties?: GatewayProperties;
    /** Presence data. */ presence?: GatewayPresence;
    /**
     * Whether to enable zlib-stream transport compression.
     * Decoded with a persistent `node:zlib` inflate stream, matching
     * Discord's zlib-wrapped stream framing (`Z_SYNC_FLUSH` boundaries).
     * When enabled, appends `&compress=zlib-stream` to the Gateway URL.
     */
    compress?: boolean;
    /**
     * Constructs the underlying socket. Defaults to the ambient `WebSocket`.
     * Injected to run the Gateway on an alternative transport, or on a stub.
     */
    createSocket?: SocketFactory;
}
/** Discord's main Gateway endpoint, used when no resume host is known. */
const DEFAULT_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

/** Gateway event listener. */
type GatewayListener = (data: unknown) => unknown;
/** Manages a Discord Gateway connection. */
export class Gateway {
    /** Current Gateway lifecycle state. */
    public state: GatewayState = GatewayState.Connect;
    #options: Required<
        Omit<
            GatewayOptions,
            "properties" | "presence" | "compress" | "createSocket"
        >
    > & {
        properties?: GatewayProperties;
        presence?: GatewayPresence;
        compress?: boolean;
    };
    /**
     * The socket this connection runs on.
     *
     * The Gateway never touches a `WebSocket` directly: construction, listener
     * wiring, replacement and decoding all belong to the transport.
     */
    readonly #transport: WebSocketTransport;
    /**
     * Session identity and the IDENTIFY-vs-RESUME decision.
     *
     * The Gateway holds no session fields of its own: every read and write goes
     * through the session, which rejects mutations from a superseded socket.
     */
    readonly #session = new GatewaySession();
    /** Token of the socket this Gateway currently owns. */
    #token = 0;
    /**
     * Heartbeat, acknowledgement deadline and staleness watch.
     *
     * The Gateway holds no heartbeat timers of its own; it supplies the socket
     * and decides what to close when liveness fails.
     */
    readonly #heartbeat: GatewayHeartbeat;
    #closed = false;
    /**
     * Close classification, backoff, scheduling, and the coordination that
     * keeps at most one logical connection attempt in flight.
     */
    readonly #reconnect: GatewayReconnect;
    readonly #listeners = new Map<string, Set<GatewayListener>>();
    readonly #sendTimestamps: number[] = [];
    public ping: number = -1;
    /** Creates a Gateway connection manager. @param options Gateway configuration. @throws {TypeError|RangeError} If configuration is invalid. */
    public constructor(options: GatewayOptions) {
        if (!options.token?.trim())
            throw new TypeError("A Gateway token is required.");
        const resolvedIntents = resolveGatewayIntents(options.intents);
        if (!Number.isInteger(resolvedIntents) || resolvedIntents < 0)
            throw new TypeError(
                "Gateway intents must be a non-negative integer.",
            );
        this.#options = {
            shardId: 0,
            shardCount: 1,
            reconnect: true,
            maxReconnectAttempts: Infinity,
            reconnectBaseDelay: 1000,
            reconnectMaxDelay: 30000,
            heartbeatAckTimeout: 10000,
            zombieTimeout: 30000,
            properties: {
                os: "Android",
                browser: "Discord Android",
                device: "Discord Android",
            },
            presence: {
                status: "online",
                activities: [],
                afk: false,
                since: null,
            },
            ...options,
        };
        if (
            this.#options.shardId < 0 ||
            this.#options.shardId >= this.#options.shardCount
        )
            throw new RangeError(
                "Gateway shardId must be within the configured shard count.",
            );
        if (this.#options.zombieTimeout <= this.#options.heartbeatAckTimeout)
            throw new RangeError(
                "Gateway zombieTimeout must be greater than heartbeatAckTimeout",
            );
        this.#transport = new WebSocketTransport({
            compress: this.#options.compress,
            createSocket: options.createSocket,
            handlers: {
                onOpen: () => this.#onOpen(),
                onFrame: (raw) => this.#message(raw, this.#token),
                onClose: (code) => this.#close(code, this.#token),
                // Transport failures reach consumers as GatewayError, the
                // type every other Gateway error path already uses.
                onError: (error) =>
                    this.#emitError(
                        error instanceof GatewayError
                            ? error
                            : new GatewayError(error.message, undefined, {
                                  cause: error,
                              }),
                    ),
            },
        });
        this.#reconnect = new GatewayReconnect({
            enabled: this.#options.reconnect,
            maxAttempts: this.#options.maxReconnectAttempts,
            baseDelay: this.#options.reconnectBaseDelay,
            maxDelay: this.#options.reconnectMaxDelay,
        });
        this.#heartbeat = new GatewayHeartbeat({
            ackTimeout: this.#options.heartbeatAckTimeout,
            zombieTimeout: this.#options.zombieTimeout,
            // Heartbeats are privileged: application traffic must never starve
            // the one payload that keeps the connection alive.
            send: (sequence) =>
                this.#dispatch(
                    {
                        op: GatewayOpcodes.Heartbeat,
                        d: sequence,
                        s: null,
                        t: null,
                    },
                    true,
                ),
            sequence: () => this.#session.sequence,
            isConnected: () => !this.#closed && this.#transport.connected,
            onTimeout: (timeout) => this.#onHeartbeatTimeout(timeout),
            onError: (error) => this.#emitError(error),
        });
    }

    /**
     * Closes a connection that failed a liveness check.
     *
     * The heartbeat decides *that* the connection is dead; the Gateway decides
     * what to do about it, because only the Gateway owns the socket.
     */
    #onHeartbeatTimeout(timeout: HeartbeatTimeout): void {
        if (timeout.type === "zombie") {
            this.#emit("zombie", {
                silentFor: timeout.silentFor,
                timeout: timeout.deadline,
            });
            this.#emitError(
                new GatewayError(
                    `Gateway connection appears stale after ${timeout.silentFor}ms without traffic.`,
                ),
            );
        } else {
            this.#emitError(
                new GatewayError(
                    `Gateway heartbeat acknowledgement timed out after ${timeout.elapsedMs}ms.`,
                ),
            );
        }
        this.#transport.close(
            1001,
            timeout.type === "zombie"
                ? "Zombie Gateway connection"
                : "Heartbeat timeout",
        );
    }

    /** Opens the Gateway connection. @param url Gateway WebSocket URL. @returns Promise fulfilled when the socket opens. @throws {GatewayError} If permanently closed or unable to connect. */
    public connect(url = DEFAULT_GATEWAY_URL): Promise<void> {
        if (this.state === GatewayState.Closed)
            throw new GatewayError("Gateway has been permanently closed.");
        // At most one logical connection attempt is active: concurrent callers
        // join the in-flight attempt rather than opening competing sockets.
        const inFlight = this.#reconnect.attemptPromise;
        if (inFlight) return inFlight;
        // Connecting an already-live Gateway must be a no-op. Opening a second
        // socket leaves the first one unmanaged but still dispatching, which
        // interleaves two sequence streams (corrupting a later RESUME) and
        // sends a second IDENTIFY on the same session.
        if (this.#transport.live) return Promise.resolve();
        // A manual connect supersedes a scheduled reconnect; leaving the timer
        // armed would open a second socket once it fires.
        this.#reconnect.cancel();
        this.#closed = false;
        this.#setState(GatewayState.Connect);
        // Append compression parameter if enabled
        const connectURL = this.#options.compress
            ? url.includes("compress=")
                ? url
                : `${url}&compress=zlib-stream`
            : url;
        return this.#reconnect.attempt(() => this.#open(connectURL));
    }
    /** Permanently closes the Gateway connection. */
    public close(): void {
        this.#closed = true;
        this.#clearTimers();
        this.#settleConnect(
            new GatewayError("Gateway connection closed before socket open."),
        );
        // Abandon rather than close-and-listen: the Gateway has already decided
        // the connection is over and must not be woken by its close event.
        this.#transport.destroy(1000, "Client closed connection");
        this.#setState(GatewayState.Closed);
    }
    /** Registers a Gateway event listener. @param event Event name. @param listener Event callback. @returns This Gateway. */
    /** Emits an event to all registered listeners. @param event Event name. @param data Event payload. */
    public emit(event: string, data?: unknown): void {
        this.#emit(event, data);
    }
    public on(event: string, listener: GatewayListener): this {
        if (!event || typeof listener !== "function")
            throw new TypeError("Gateway event and listener are required.");
        let listeners = this.#listeners.get(event);
        if (!listeners) this.#listeners.set(event, (listeners = new Set()));
        listeners.add(listener);
        return this;
    }
    /** Removes a Gateway event listener. @param event Event name. @param listener Event callback. @returns This Gateway. */
    public off(event: string, listener: GatewayListener): this {
        this.#listeners.get(event)?.delete(listener);
        return this;
    }
    /** Sends a Gateway payload. @param payload Gateway payload. @returns Whether it was sent. */
    public send(payload: GatewayPayload): boolean {
        if (!payload || !Number.isInteger(payload.op))
            throw new TypeError(
                "Gateway payload must contain an integer opcode.",
            );
        return this.#dispatch(payload, false);
    }
    /**
     * Writes a payload to the socket. Heartbeats pass `privileged` so they are
     * never starved by application traffic: the 115 budget sits below
     * Discord's real 120/60s limit precisely to leave room for them, so
     * spending that headroom on heartbeats is what it is reserved for. They
     * are still recorded, keeping the true total under Discord's limit.
     */
    #dispatch(payload: GatewayPayload, privileged: boolean): boolean {
        if (!this.#transport.connected) return false;
        const now = Date.now();
        while (
            this.#sendTimestamps.length &&
            now - this.#sendTimestamps[0]! >= 60000
        )
            this.#sendTimestamps.shift();
        if (!privileged && this.#sendTimestamps.length >= 115) {
            this.#emitError(
                new GatewayError("Gateway send rate budget exhausted."),
            );
            return false;
        }
        if (!this.#transport.send(JSON.stringify(payload))) return false;
        this.#sendTimestamps.push(now);
        return true;
    }
    /** Sends a presence update. @param data Presence payload. @returns Whether it was sent. */
    public setPresence(data: GatewayPresence): boolean {
        this.#options.presence = { ...this.#options.presence, ...data };
        const payload = {
            since: this.#options.presence.since ?? null,
            activities: this.#options.presence.activities ?? [],
            status: this.#options.presence.status ?? "online",
            afk: Boolean(this.#options.presence.afk),
        };
        return this.send({
            op: GatewayOpcodes.PresenceUpdate,
            d: payload,
            s: null,
            t: null,
        });
    }
    /** Sends a voice state update. @param data Voice state payload. @returns Whether it was sent. */
    public setVoiceState(data: Record<string, unknown>): boolean {
        return this.send({
            op: GatewayOpcodes.VoiceStateUpdate,
            d: data,
            s: null,
            t: null,
        });
    }
    /** Requests guild members. @param data Guild member request payload. @returns Whether it was sent. */
    public requestGuildMembers(data: Record<string, unknown>): boolean {
        return this.send({
            op: GatewayOpcodes.RequestGuildMembers,
            d: data,
            s: null,
            t: null,
        });
    }
    /**
     * Starts one connection attempt.
     *
     * Ownership of the session moves to this attempt before the socket exists,
     * so a frame from the socket being replaced can never be mistaken for one
     * belonging to this connection.
     */
    #open(url: string): void {
        if (this.#closed) return;
        this.#token = this.#session.beginConnection();
        const result = this.#transport.connect(url);
        if (result.ok) return;
        // The socket could not be constructed. The caller's attempt fails with
        // the underlying reason, so a thrown GatewayError keeps its message.
        const failure = this.#normalizeError(result.error);
        this.#emitError(failure);
        if (this.#options.reconnect) {
            this.#setState(GatewayState.Reconnect);
            this.#scheduleReconnect();
        } else {
            this.#settleConnect(failure);
        }
    }
    #onOpen(): void {
        // Watch for silence from the moment the socket opens: a connection
        // that never reaches HELLO must still be detected as dead.
        this.#heartbeat.watch();
        this.#emit("open", undefined);
        this.#settleConnect();
    }
    #message(raw: string, token: number): void {
        // The transport already drops frames from a replaced socket; this
        // second check keeps the session authoritative about who may mutate it.
        if (!this.#session.owns(token)) return;
        let payload: GatewayPayload;
        try {
            payload = JSON.parse(raw) as GatewayPayload;
        } catch (error) {
            this.#emitError(
                new GatewayError("Gateway returned invalid JSON", undefined, {
                    cause: error,
                }),
            );
            this.#transport.close(1002, "Invalid JSON");
            return;
        }
        if (!payload || typeof payload.op !== "number") {
            this.#emitError(
                new GatewayError("Gateway returned an invalid payload"),
            );
            this.#transport.close(1002, "Invalid payload");
            return;
        }
        // The session ignores a sequence from a superseded connection, so a
        // late dispatch on an old socket cannot advance the live one.
        if (typeof payload.s === "number")
            this.#session.recordSequence(payload.s, token);
        switch (payload.op) {
            case GatewayOpcodes.Dispatch:
                this.#setState(GatewayState.Dispatch);
                this.#handleDispatch(payload.t, payload.d, token);
                break;
            case GatewayOpcodes.Hello:
                this.#handleHello(payload.d);
                break;
            case GatewayOpcodes.Heartbeat:
                this.#setState(GatewayState.Heartbeat);
                this.#heartbeat.sendHeartbeat();
                break;
            case GatewayOpcodes.HeartbeatAck:
                this.#heartbeat.acknowledge();
                this.ping = this.#heartbeat.latency;
                this.#emit("heartbeatAck", payload.d);
                break;
            case GatewayOpcodes.Reconnect:
                this.#transport.close(1001, "Server requested reconnect");
                break;
            case GatewayOpcodes.InvalidSession: {
                // Op 9 `d` is a boolean: true = the session is resumable, so we
                // keep session state and RESUME on reconnect; false = the
                // session is dead and we must re-IDENTIFY from scratch. Matches
                // Discord/Discord.js semantics rather than always re-identifying.
                const resumable = payload.d === true;
                if (!resumable)
                    this.#session.invalidate(token, "invalid-session");
                this.#emit("invalidSession", resumable);
                this.#transport.close(
                    resumable ? GatewayCloseCodes.UnknownError : 1000,
                    resumable
                        ? "Invalid session (resumable)"
                        : "Invalid session",
                );
                break;
            }
        }
    }
    #handleDispatch(event: string | null, data: unknown, token: number): void {
        if (event === "READY") {
            if (!this.#session.activate(data, token)) {
                // Either the payload lacked session information or this socket
                // no longer owns the session; only the former is an error.
                if (this.#session.owns(token))
                    this.#emitError(
                        new GatewayError(
                            "Gateway READY payload is missing session information",
                        ),
                    );
                return;
            }
            this.#reconnect.reset();
            this.#setState(GatewayState.Ready);
            this.#emit("ready", data);
        } else if (event === "RESUMED") {
            // A successful RESUME ends the reconnect cycle just like READY:
            // reset the backoff counter so a later disconnect starts from the
            // base delay, mark the connection READY, and surface a Discord.js-
            // familiar `resumed` event.
            this.#reconnect.reset();
            this.#setState(GatewayState.Ready);
            this.#emit("resumed", data);
        }
        this.#emit("RAW", { event: event ?? "UNKNOWN", data });
        if (this.#closed) return;
        this.#emit(event ?? "dispatch", data);
    }
    #handleHello(data: unknown): void {
        const interval = (data as { heartbeat_interval?: unknown })
            ?.heartbeat_interval;
        if (
            typeof interval !== "number" ||
            !Number.isFinite(interval) ||
            interval <= 0
        ) {
            this.#emitError(
                new GatewayError(
                    "Gateway HELLO payload contains an invalid heartbeat interval",
                ),
            );
            this.#transport.close(1002, "Invalid heartbeat interval");
            return;
        }
        this.#setState(
            this.#session.canResume ? GatewayState.Resume : GatewayState.Hello,
        );
        this.#heartbeat.start(interval);
        this.#identifyOrResume();
    }
    #identifyOrResume(): void {
        const intent = this.#session.handshake();
        if (intent.type === "resume") {
            this.#setState(GatewayState.Resume);
            // IDENTIFY/RESUME are privileged for the same reason heartbeats
            // are: dropping one leaves the shard connected but never READY,
            // recoverable only via the zombie timeout. Application traffic
            // must never starve the handshake out of the send budget.
            this.#dispatch(
                {
                    op: GatewayOpcodes.Resume,
                    d: {
                        token: this.#options.token,
                        session_id: intent.sessionId,
                        seq: intent.sequence,
                    },
                    s: null,
                    t: null,
                },
                true,
            );
            return;
        }
        this.#setState(GatewayState.Identify);
        const props = this.#options.properties ?? {
            os: "Android",
            browser: "Discord Android",
            device: "Discord Android",
        };
        const os = props.os ?? "Android";
        const browser = props.browser ?? "Discord Android";
        const device = props.device ?? "Discord Android";
        this.#dispatch(
            {
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
            },
            true,
        );
    }
    #close(code: number, token: number): void {
        this.#clearTimers();
        const action: CloseAction = this.#reconnect.classifyClose(
            code,
            this.#session.canResume,
        );
        this.#emit("close", { code, action });
        if (this.#closed || !this.#reconnect.enabled || action === "stop") {
            // A fatal close is terminal: the condition behind 4004/4013/4014
            // cannot fix itself, so the Gateway settles as CLOSED rather than
            // sitting in CONNECT looking like it is about to try again (WS-003).
            if (action === "stop") this.#closed = true;
            this.#setState(
                this.#closed ? GatewayState.Closed : GatewayState.Connect,
            );
            if (this.#reconnect.connecting)
                this.#reconnect.settle(
                    new GatewayError(
                        `Gateway closed before READY (code ${code}).`,
                        code,
                    ),
                );
            return;
        }
        if (action === "identify")
            // Fresh IDENTIFY: drop the session AND its resume host so the
            // reconnect targets the main Gateway, not a stale resume URL.
            this.#session.invalidate(token, "session-timeout");
        this.#setState(GatewayState.Reconnect);
        this.#scheduleReconnect();
    }
    #scheduleReconnect(): void {
        if (this.#closed) return;
        const result = this.#reconnect.schedule(() =>
            this.#open(this.#session.connectURL(DEFAULT_GATEWAY_URL)),
        );
        if (result.scheduled || result.reason !== "exhausted") return;
        this.#reconnect.settle(
            new GatewayError("Gateway reconnect attempts exhausted."),
        );
        this.#setState(GatewayState.Connect);
    }
    #settleConnect(error?: GatewayError): void {
        this.#reconnect.settle(error);
    }
    #clearTimers(): void {
        this.#reconnect.cancel();
        this.#heartbeat.stop();
    }
    #normalizeError(error: unknown): GatewayError {
        return error instanceof GatewayError
            ? error
            : new GatewayError("Gateway connection failed.", undefined, {
                  cause: error,
              });
    }
    #emitError(error: unknown): void {
        this.#emit(
            "error",
            error instanceof Error ? error : new GatewayError(String(error)),
        );
    }
    #emit(event: string, data: unknown): void {
        for (const listener of this.#listeners.get(event) ?? []) {
            try {
                const result = listener(data);
                if (
                    result &&
                    typeof (result as PromiseLike<unknown>).then === "function"
                )
                    void Promise.resolve(result).catch((error) => {
                        if (event !== "error") this.#emitError(error);
                    });
            } catch (error) {
                if (event !== "error") this.#emitError(error);
            }
        }
    }
    /** Changes the Gateway lifecycle state. @param next Next lifecycle state. */
    #setState(next: GatewayState): void {
        if (this.state === next) return;
        const previous = this.state;
        this.state = next;
        this.#emit("stateChange", { previous, next });
    }
}
