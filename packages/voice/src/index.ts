/** Voice session lifecycle states. */
export type VoiceConnectionState = "disconnected" | "connecting" | "connected" | "destroyed";
/** Voice protocol transport errors. */
export class VoiceError extends Error { /** Creates a voice error. @param message Error message. @param options Optional native error options. */ public constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = "VoiceError"; } }
/** Options used to establish a voice session. */
export interface VoiceConnectionOptions { /** Guild containing the voice channel. */ guildId: string; /** Voice channel to join. */ channelId?: string; /** Whether the self user should be muted. */ selfMute?: boolean; /** Whether the self user should be deafened. */ selfDeaf?: boolean; }
/** UDP transport supplied by the runtime-specific voice implementation. */
export interface VoiceUdpTransport { /** Sends an RTP/RTCP packet. @param packet Packet bytes. @param host Destination host. @param port Destination port. @returns Optional completion promise. */ send(packet: Uint8Array, host: string, port: number): Promise<void> | void; /** Closes the UDP socket. @returns Nothing. */ close(): void; }
/** Voice Gateway transport abstraction. */
export interface VoiceGatewayTransport { /** Opens the voice gateway. @param endpoint Voice gateway endpoint. @param sessionId Voice session identifier. @returns Promise fulfilled when connected. */ connect(endpoint: string, sessionId: string): Promise<void>; /** Sends a voice gateway payload. @param payload Gateway payload. @returns Nothing. */ send(payload: unknown): void; /** Closes the voice gateway. @param code Optional close code. @param reason Optional close reason. @returns Nothing. */ close(code?: number, reason?: string): void; }
/** Speaking flags used by the voice gateway. */
export const SpeakingFlags = { Microphone: 1, Soundshare: 2, Priority: 4 } as const;
/** Voice session event payloads. */
export interface VoiceEvents { /** State transition event. */ stateChange: [VoiceConnectionState, VoiceConnectionState]; /** Speaking flag event. */ speaking: [number, number]; /** Voice transport error event. */ error: [VoiceError]; }
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
    /** Registered lifecycle listeners. */ readonly #listeners = new Map<keyof VoiceEvents, Set<VoiceListener>>();

    /** Creates a voice connection state manager. @param options Guild ID or connection options. @throws {TypeError} If the guild ID is empty. */
    public constructor(options: string | VoiceConnectionOptions) { const resolved = typeof options === "string" ? { guildId: options } : options; if (!resolved.guildId.trim()) throw new TypeError("A guild ID is required for a voice connection."); this.guildId = resolved.guildId; this.channelId = resolved.channelId; this.selfMute = resolved.selfMute ?? false; this.selfDeaf = resolved.selfDeaf ?? false; }
    /** Registers a voice lifecycle listener. @param event Event name. @param listener Listener callback. @returns This connection. @throws {TypeError} If listener is not callable. */ public on<K extends keyof VoiceEvents>(event: K, listener: (...args: VoiceEvents[K]) => unknown): this { if (typeof listener !== "function") throw new TypeError("Voice listener must be a function."); let listeners = this.#listeners.get(event); if (!listeners) this.#listeners.set(event, listeners = new Set()); listeners.add(listener); return this; }
    /** Removes a voice lifecycle listener. @param event Event name. @param listener Listener callback. @returns This connection. */ public off<K extends keyof VoiceEvents>(event: K, listener: (...args: VoiceEvents[K]) => unknown): this { this.#listeners.get(event)?.delete(listener); return this; }
    /** Attaches protocol transports, replacing and cleaning up the old pair when present. @param gateway Voice gateway transport. @param udp UDP transport. @returns This connection. @throws {VoiceError} If the connection is destroyed. @throws {TypeError} If a transport is missing. */ public attachTransports(gateway: VoiceGatewayTransport, udp: VoiceUdpTransport): this { this.assertUsable(); if (!gateway || !udp) throw new TypeError("Both voice gateway and UDP transports are required."); if (this.gateway || this.udp) this.#closeTransports(); this.gateway = gateway; this.udp = udp; return this; }
    /** Begins the connection lifecycle. @returns Nothing. @throws {VoiceError} If the connection is destroyed. */ public connect(): void { this.assertUsable(); if (this.state === "connected") return; this.#transition("connecting"); if (this.state !== "connecting") return; this.#transition("connected"); }
    /** Disconnects the current voice session. @returns Nothing. */ public disconnect(): void { if (this.state === "destroyed") return; this.#closeTransports(); this.#transition("disconnected"); }
    /** Permanently destroys this voice connection. @returns Nothing. */ public destroy(): void { if (this.state === "destroyed") return; this.#closeTransports(); this.channelId = undefined; this.#transition("destroyed"); this.#listeners.clear(); }
    /** Updates the voice channel and connection state. @param channelId Voice channel identifier. @returns Nothing. @throws {VoiceError} If the connection is destroyed. @throws {TypeError} If channelId is empty. */ public setChannel(channelId: string): void { this.assertUsable(); if (!channelId.trim()) throw new TypeError("A voice channel ID is required."); this.channelId = channelId; }
    /** Updates self mute/deaf state. @param options Suppression flags. @returns Nothing. @throws {VoiceError} If the connection is destroyed. */ public setSuppression(options: { selfMute?: boolean; selfDeaf?: boolean }): void { this.assertUsable(); if (options.selfMute !== undefined) this.selfMute = options.selfMute; if (options.selfDeaf !== undefined) this.selfDeaf = options.selfDeaf; }
    /** Publishes a speaking state through the attached voice gateway. @param flags Speaking flags. @returns Nothing. @throws {VoiceError} If the connection is destroyed or has no gateway transport. */ public setSpeaking(flags = SpeakingFlags.Microphone): void { this.assertUsable(); if (!this.gateway) throw new VoiceError("A voice gateway transport is required to change speaking state."); this.gateway.send({ op: 5, d: { speaking: flags, delay: 0, ssrc: 0 } }); this.#emit("speaking", flags, 0); }
    /** Ensures the connection is still usable. @returns Nothing. @throws {VoiceError} If destroyed. */
    #assertUsable(): void { if (this.state === "destroyed") throw new VoiceError("Voice connection has been destroyed."); }
    /** Closes both active transports while isolating cleanup failures. @returns Nothing. */
    #closeTransports(): void { try { this.gateway?.close(1000, "Voice connection replaced or closed"); } catch (error) { this.#emit("error", error instanceof VoiceError ? error : new VoiceError("Voice gateway cleanup failed.", { cause: error })); } try { this.udp?.close(); } catch (error) { this.#emit("error", error instanceof VoiceError ? error : new VoiceError("Voice UDP cleanup failed.", { cause: error })); } this.gateway = undefined; this.udp = undefined; }
    /** Transitions to a new lifecycle state and emits the transition event. @param next Next state. @returns Nothing. */
    #transition(next: VoiceConnectionState): void { const previous = this.state; this.state = next; if (previous === next) return; for (const listener of this.#listeners.get("stateChange") ?? []) { try { void listener(next, previous); } catch (error) { this.#emit("error", error instanceof VoiceError ? error : new VoiceError("Voice event listener failed.", { cause: error })); } if (this.state !== next && next !== "destroyed") return; } }
    /** Emits a voice event while isolating consumer failures. @param event Event name. @param args Event arguments. @returns Nothing. */
    #emit<K extends keyof VoiceEvents>(event: K, ...args: VoiceEvents[K]): void { for (const listener of this.#listeners.get(event) ?? []) { try { void listener(...args); } catch { /* Consumer failures are isolated. */ } } }
    /** Ensures the connection is still usable. @returns Nothing. @throws {VoiceError} If destroyed. */
    private assertUsable(): void { this.#assertUsable(); }
}
