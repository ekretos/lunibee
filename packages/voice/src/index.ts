/** Voice session lifecycle states. */
export type VoiceConnectionState = "disconnected" | "connecting" | "connected" | "destroyed";
/** Voice protocol transport errors. */
export class VoiceError extends Error {
    /** Creates a voice error. */
    public constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "VoiceError"; }
}
/** Options used to establish a voice session. */
export interface VoiceConnectionOptions {
    /** Guild containing the voice channel. */ guildId: string;
    /** Voice channel to join. */ channelId?: string;
    /** Whether the self user should be muted. */ selfMute?: boolean;
    /** Whether the self user should be deafened. */ selfDeaf?: boolean;
}
/** UDP transport supplied by the runtime-specific voice implementation. */
export interface VoiceUdpTransport { /** Sends an RTP/RTCP packet. */ send(packet: Uint8Array, host: string, port: number): Promise<void> | void; /** Closes the UDP socket. */ close(): void; }
/** Voice Gateway transport abstraction. */
export interface VoiceGatewayTransport { /** Opens the voice gateway. */ connect(endpoint: string, sessionId: string): Promise<void>; /** Sends a voice gateway payload. */ send(payload: unknown): void; /** Closes the voice gateway. */ close(code?: number, reason?: string): void; }
/** Speaking flags used by the voice gateway. */
export const SpeakingFlags = { Microphone: 1, Soundshare: 2, Priority: 4 } as const;
/** Voice session event payloads. */
export interface VoiceEvents { stateChange: [VoiceConnectionState, VoiceConnectionState]; speaking: [number, number]; error: [VoiceError]; }
type VoiceListener = (...args: any[]) => unknown;

/** Tracks a Discord voice session and exposes transport-independent lifecycle controls. */
export class VoiceConnection {
    /** Current voice connection state. */ public state: VoiceConnectionState = "disconnected";
    /** Guild associated with this voice session. */ public readonly guildId: string;
    /** Voice channel associated with this session. */ public channelId?: string;
    /** Whether the client is self-muted. */ public selfMute: boolean;
    /** Whether the client is self-deafened. */ public selfDeaf: boolean;
    /** Active voice gateway transport, when attached. */ public gateway?: VoiceGatewayTransport;
    /** Active UDP transport, when attached. */ public udp?: VoiceUdpTransport;
    readonly #listeners = new Map<keyof VoiceEvents, Set<VoiceListener>>();

    /** Creates a voice connection state manager. */
    public constructor(options: string | VoiceConnectionOptions) {
        const resolved = typeof options === "string" ? { guildId: options } : options;
        if (!resolved.guildId.trim()) throw new TypeError("A guild ID is required for a voice connection.");
        this.guildId = resolved.guildId;
        this.channelId = resolved.channelId;
        this.selfMute = resolved.selfMute ?? false;
        this.selfDeaf = resolved.selfDeaf ?? false;
    }

    /** Registers a voice lifecycle listener. */
    public on<K extends keyof VoiceEvents>(event: K, listener: (...args: VoiceEvents[K]) => unknown): this { if (typeof listener !== "function") throw new TypeError("Voice listener must be a function."); let listeners = this.#listeners.get(event); if (!listeners) this.#listeners.set(event, listeners = new Set()); listeners.add(listener); return this; }
    /** Removes a voice lifecycle listener. */
    public off<K extends keyof VoiceEvents>(event: K, listener: (...args: VoiceEvents[K]) => unknown): this { this.#listeners.get(event)?.delete(listener); return this; }
    /** Attaches protocol transports supplied by the runtime. */
    public attachTransports(gateway: VoiceGatewayTransport, udp: VoiceUdpTransport): this { this.assertUsable(); this.gateway = gateway; this.udp = udp; return this; }
    /** Begins the connection lifecycle. */
    public connect(): void { this.assertUsable(); if (this.state === "connected") return; this.transition("connecting"); this.transition("connected"); }
    /** Disconnects the current voice session. */
    public disconnect(): void { if (this.state === "destroyed") return; this.gateway?.close(1000, "Voice connection closed"); this.udp?.close(); this.gateway = undefined; this.udp = undefined; this.transition("disconnected"); }
    /** Permanently destroys this voice connection. */
    public destroy(): void { if (this.state === "destroyed") return; this.disconnect(); this.channelId = undefined; this.transition("destroyed"); this.#listeners.clear(); }
    /** Updates the voice channel and connection state. */
    public setChannel(channelId: string): void { this.assertUsable(); if (!channelId.trim()) throw new TypeError("A voice channel ID is required."); this.channelId = channelId; }
    /** Updates self mute/deaf state. */
    public setSuppression(options: { selfMute?: boolean; selfDeaf?: boolean }): void { this.assertUsable(); if (options.selfMute !== undefined) this.selfMute = options.selfMute; if (options.selfDeaf !== undefined) this.selfDeaf = options.selfDeaf; }
    /** Publishes a speaking state through the attached voice gateway. */
    public setSpeaking(flags = SpeakingFlags.Microphone): void { this.assertUsable(); if (!this.gateway) throw new VoiceError("A voice gateway transport is required to change speaking state."); this.gateway.send({ op: 5, d: { speaking: flags, delay: 0, ssrc: 0 } }); this.emit("speaking", flags, 0); }
    private assertUsable(): void { if (this.state === "destroyed") throw new VoiceError("Voice connection has been destroyed."); }
    private transition(next: VoiceConnectionState): void { const previous = this.state; this.state = next; if (previous === next) return; for (const listener of this.#listeners.get("stateChange") ?? []) { try { void listener(next, previous); } catch (error) { this.emit("error", error instanceof VoiceError ? error : new VoiceError("Voice event listener failed.", { cause: error })); } } }
    private emit<K extends keyof VoiceEvents>(event: K, ...args: VoiceEvents[K]): void { for (const listener of this.#listeners.get(event) ?? []) { try { void listener(...args); } catch { /* Consumer failures are isolated. */ } } }
}
