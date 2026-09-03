/** Voice session lifecycle states. */
export enum VoiceConnectionState {
    Disconnected = "disconnected",
    Connecting = "connecting",
    Connected = "connected",
    Destroyed = "destroyed",
}

/** Voice protocol transport errors. */
export class VoiceError extends Error {
    /** Creates a voice error. @param message Error message. @param options Optional native error options. */
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "VoiceError";
    }
}

/** Options used to establish a voice session. */
export interface VoiceConnectionOptions {
    /** Guild containing the voice channel. */
    guildId: string;
    /** Voice channel to join. */
    channelId?: string;
    /** Whether the self user should be muted. */
    selfMute?: boolean;
    /** Whether the self user should be deafened. */
    selfDeaf?: boolean;
}

/** UDP transport supplied by the runtime-specific voice implementation. */
export interface VoiceUdpTransport {
    /** Sends an RTP/RTCP packet. @param packet Packet bytes. @param host Destination host. @param port Destination port. @returns Optional completion promise. */
    send(packet: Uint8Array, host: string, port: number): Promise<void> | void;
    /** Closes the UDP socket. @returns Nothing. */
    close(): void;
    /** Optional listener for incoming UDP packets. */
    onMessage?(listener: (packet: Uint8Array) => void): void;
}

/** Voice Gateway transport abstraction. */
export interface VoiceGatewayTransport {
    /** Opens the voice gateway. @param endpoint Voice gateway endpoint. @param sessionId Voice session identifier. @returns Promise fulfilled when connected. */
    connect(endpoint: string, sessionId: string): Promise<void>;
    /** Sends a voice gateway payload. @param payload Gateway payload. @returns Nothing. */
    send(payload: unknown): void;
    /** Closes the voice gateway. @param code Optional close code. @param reason Optional close reason. @returns Nothing. */
    close(code?: number, reason?: string): void;
}

/** Speaking flags used by the voice gateway. */
export const SpeakingFlags = {
    Microphone: 1,
    Soundshare: 2,
    Priority: 4,
} as const;

/** Voice session event payloads. */
export interface VoiceEvents {
    /** State transition event. */
    stateChange: [VoiceConnectionState, VoiceConnectionState];
    /** Speaking flag event. */
    speaking: [number, number];
    /** Voice transport error event. */
    error: [VoiceError];
}

type VoiceListener = (...args: any[]) => unknown;

/** Tracks a Discord voice session and exposes transport-independent lifecycle controls. */
export class VoiceConnection {
    /** Current voice connection state. */
    public state: VoiceConnectionState = VoiceConnectionState.Disconnected;
    /** Guild associated with this voice session. */
    public readonly guildId: string;
    /** Voice channel associated with this session. */
    public channelId?: string;
    /** Whether the client is self-muted. */
    public selfMute: boolean;
    /** Whether the client is self-deafened. */
    public selfDeaf: boolean;
    /** Active voice gateway transport, when attached. */
    public gateway?: VoiceGatewayTransport;
    /** Active UDP transport, when attached. */
    public udp?: VoiceUdpTransport;
    /** Registered lifecycle listeners. */
    readonly #listeners = new Map<keyof VoiceEvents, Set<VoiceListener>>();
    /** Receives incoming audio. */
    public readonly receiver: VoiceReceiver;

    /** Creates a voice connection state manager. @param options Guild ID or connection options. @throws {TypeError} If the guild ID is empty. */
    public constructor(options: string | VoiceConnectionOptions) {
        const resolved =
            typeof options === "string" ? { guildId: options } : options;
        if (!resolved.guildId?.trim()) {
            throw new TypeError(
                "A guild ID is required for a voice connection.",
            );
        }
        this.guildId = resolved.guildId;
        this.channelId = resolved.channelId;
        this.selfMute = resolved.selfMute ?? false;
        this.selfDeaf = resolved.selfDeaf ?? false;
        this.receiver = new VoiceReceiver(this);
    }

    /** Registers a voice lifecycle listener. @param event Event name. @param listener Listener callback. @returns This connection. @throws {TypeError} If listener is not callable. */
    public on<K extends keyof VoiceEvents>(
        event: K,
        listener: (...args: VoiceEvents[K]) => unknown,
    ): this {
        if (typeof listener !== "function")
            throw new TypeError("Voice listener must be a function.");
        let listeners = this.#listeners.get(event);
        if (!listeners) this.#listeners.set(event, (listeners = new Set()));
        listeners.add(listener);
        return this;
    }

    /** Removes a voice lifecycle listener. @param event Event name. @param listener Listener callback. @returns This connection. */
    public off<K extends keyof VoiceEvents>(
        event: K,
        listener: (...args: VoiceEvents[K]) => unknown,
    ): this {
        this.#listeners.get(event)?.delete(listener);
        return this;
    }

    /** Attaches protocol transports, replacing and cleaning up the old pair when present. @param gateway Voice gateway transport. @param udp UDP transport. @returns This connection. @throws {VoiceError} If the connection is destroyed. @throws {TypeError} If a transport is missing. */
    public attachTransports(
        gateway: VoiceGatewayTransport,
        udp: VoiceUdpTransport,
    ): this {
        this.assertUsable();
        if (!gateway || !udp)
            throw new TypeError(
                "Both voice gateway and UDP transports are required.",
            );
        if (this.gateway || this.udp) this.#closeTransports();
        this.gateway = gateway;
        this.udp = udp;
        // Capture the transport this listener belongs to so that packets from a
        // later-replaced transport (whose listener cannot be unregistered — the
        // VoiceUdpTransport interface exposes no removal API) are ignored.
        const attachedUdp = udp;
        if (attachedUdp.onMessage) {
            attachedUdp.onMessage((packet) => {
                if (this.udp === attachedUdp) this.receiver.onPacket(packet);
            });
        }
        return this;
    }

    /** Begins the connection lifecycle. @returns Nothing. @throws {VoiceError} If the connection is destroyed. */
    public connect(): void {
        this.assertUsable();
        if (this.state === VoiceConnectionState.Connected) return;
        this.#transition(VoiceConnectionState.Connecting);
        if (this.state !== VoiceConnectionState.Connecting) return;
        this.#transition(VoiceConnectionState.Connected);
    }

    /** Disconnects the current voice session. @returns Nothing. */
    public disconnect(): void {
        if (this.state === VoiceConnectionState.Destroyed) return;
        this.#closeTransports();
        this.#transition(VoiceConnectionState.Disconnected);
    }

    /** Permanently destroys this voice connection. @returns Nothing. */
    public destroy(): void {
        if (this.state === VoiceConnectionState.Destroyed) return;
        this.#closeTransports();
        this.channelId = undefined;
        this.#transition(VoiceConnectionState.Destroyed);
        this.#listeners.clear();
    }

    /** Updates the voice channel and connection state. @param channelId Voice channel identifier. @returns Nothing. @throws {VoiceError} If the connection is destroyed. @throws {TypeError} If channelId is empty. */
    public setChannel(channelId: string): void {
        this.assertUsable();
        if (!channelId?.trim())
            throw new TypeError("A voice channel ID is required.");
        this.channelId = channelId;
    }

    /** Updates self mute/deaf state. @param options Suppression flags. @returns Nothing. @throws {VoiceError} If the connection is destroyed. */
    public setSuppression(options: {
        selfMute?: boolean;
        selfDeaf?: boolean;
    }): void {
        this.assertUsable();
        if (options.selfMute !== undefined) this.selfMute = options.selfMute;
        if (options.selfDeaf !== undefined) this.selfDeaf = options.selfDeaf;
    }

    /** Publishes a speaking state through the attached voice gateway. @param flags Speaking flags. @returns Nothing. @throws {VoiceError} If the connection is destroyed or has no gateway transport. */
    public setSpeaking(flags: number = SpeakingFlags.Microphone): void {
        this.assertUsable();
        if (!this.gateway) {
            throw new VoiceError(
                "A voice gateway transport is required to change speaking state.",
            );
        }
        this.gateway.send({ op: 5, d: { speaking: flags, delay: 0, ssrc: 0 } });
        this.#emit("speaking", flags, 0);
    }

    /** Ensures the connection is still usable. @returns Nothing. @throws {VoiceError} If destroyed. */
    #assertUsable(): void {
        if (this.state === VoiceConnectionState.Destroyed) {
            throw new VoiceError("Voice connection has been destroyed.");
        }
    }

    /** Closes both active transports while isolating cleanup failures. @returns Nothing. */
    #closeTransports(): void {
        try {
            this.gateway?.close(1000, "Voice connection replaced or closed");
        } catch (error) {
            this.#emit(
                "error",
                error instanceof VoiceError
                    ? error
                    : new VoiceError("Voice gateway cleanup failed.", {
                          cause: error,
                      }),
            );
        }
        try {
            this.udp?.close();
        } catch (error) {
            this.#emit(
                "error",
                error instanceof VoiceError
                    ? error
                    : new VoiceError("Voice UDP cleanup failed.", {
                          cause: error,
                      }),
            );
        }
        this.gateway = undefined;
        this.udp = undefined;
    }

    /** Transitions to a new lifecycle state and emits the transition event. @param next Next state. @returns Nothing. */
    #transition(next: VoiceConnectionState): void {
        const previous = this.state;
        this.state = next;
        if (previous === next) return;
        for (const listener of this.#listeners.get("stateChange") ?? []) {
            try {
                void listener(next, previous);
            } catch (error) {
                this.#emit(
                    "error",
                    error instanceof VoiceError
                        ? error
                        : new VoiceError("Voice event listener failed.", {
                              cause: error,
                          }),
                );
            }
            if (this.state !== next && next !== VoiceConnectionState.Destroyed)
                return;
        }
    }

    /** Emits a voice event while isolating consumer failures. @param event Event name. @param args Event arguments. @returns Nothing. */
    #emit<K extends keyof VoiceEvents>(
        event: K,
        ...args: VoiceEvents[K]
    ): void {
        for (const listener of this.#listeners.get(event) ?? []) {
            try {
                void listener(...args);
            } catch {
                /* Consumer failures are isolated. */
            }
        }
    }

    /** Ensures the connection is still usable. @returns Nothing. @throws {VoiceError} If destroyed. */
    private assertUsable(): void {
        this.#assertUsable();
    }
}

// ─── Audio Pipeline ───────────────────────────────────────────────────────────

/** Audio player lifecycle states. */
export type AudioPlayerState = "idle" | "playing" | "paused" | "stopped";

/** An audio stream — wraps a `ReadableStream<Uint8Array>` with optional metadata. */
export class AudioStream {
    /** Underlying binary stream. */ public readonly stream: ReadableStream<Uint8Array>;
    /** Optional human-readable title for the stream. */ public readonly title?: string;
    /** Optional duration hint in seconds. */ public readonly duration?: number;

    /** Creates an audio stream.
     * @param stream Binary audio data stream.
     * @param metadata Optional metadata: title and duration in seconds.
     */
    public constructor(
        stream: ReadableStream<Uint8Array>,
        metadata?: { title?: string; duration?: number },
    ) {
        this.stream = stream;
        this.title = metadata?.title;
        this.duration = metadata?.duration;
    }
}

type AudioPlayerListener<K extends keyof AudioPlayerEvents> = (
    ...args: AudioPlayerEvents[K]
) => unknown;

interface AudioPlayerEvents {
    stateChange: [from: AudioPlayerState, to: AudioPlayerState];
    error: [error: Error];
    finish: [];
}

/**
 * Lightweight audio player with a simple state machine.
 *
 * States:
 * - `idle` — no stream loaded.
 * - `playing` — actively feeding audio data.
 * - `paused` — temporarily suspended; can be resumed.
 * - `stopped` — stream was stopped and discarded; load a new stream to play again.
 *
 * Events: `stateChange(from, to)`, `error(err)`, `finish()`.
 */
export class AudioPlayer {
    #state: AudioPlayerState = "idle";
    #stream?: AudioStream;
    #reader?: ReadableStreamDefaultReader<Uint8Array>;
    /** Resolves the pump's pause await when the player is resumed or stopped. */
    #resumeSignal?: () => void;
    readonly #listeners = new Map<
        string,
        Set<AudioPlayerListener<keyof AudioPlayerEvents>>
    >();

    /** Current player state. */
    public get state(): AudioPlayerState {
        return this.#state;
    }

    /** The audio stream currently loaded, if any. */
    public get current(): AudioStream | undefined {
        return this.#stream;
    }

    /**
     * Begins playing an audio stream.
     * If a stream is already playing, it is stopped first; the previous
     * stream's reader cancellation is awaited before the new stream starts so
     * the old and new pump loops cannot run concurrently.
     * @param audioStream Stream to play.
     */
    public async play(audioStream: AudioStream): Promise<void> {
        if (this.#state === "playing" || this.#state === "paused")
            await this.stop();
        this.#stream = audioStream;
        this.#reader = audioStream.stream.getReader();
        this.#transition("playing");
        this.#pump().catch((err) => this.#emitError(err));
    }

    /** Pauses a currently-playing stream. No-op if not playing. */
    public pause(): void {
        if (this.#state !== "playing") return;
        this.#transition("paused");
    }

    /** Resumes a paused stream. No-op if not paused. */
    public resume(): void {
        if (this.#state !== "paused") return;
        this.#transition("playing");
        // Wake the existing pump loop rather than starting a second one.
        const signal = this.#resumeSignal;
        this.#resumeSignal = undefined;
        signal?.();
    }

    /**
     * Stops and discards the current stream. The returned promise resolves once
     * the underlying reader's cancellation has settled, so a subsequent `play`
     * never overlaps with the previous pump loop.
     */
    public async stop(): Promise<void> {
        if (this.#state === "idle" || this.#state === "stopped") return;
        const reader = this.#reader;
        this.#reader = undefined;
        this.#stream = undefined;
        this.#transition("stopped");
        // Release a pump loop that is currently awaiting a resume.
        const signal = this.#resumeSignal;
        this.#resumeSignal = undefined;
        signal?.();
        if (reader) {
            try {
                await reader.cancel();
            } catch {
                /* Cancellation failures are non-fatal. */
            }
        }
    }

    /** Registers an event listener. @returns `this` for chaining. */
    public on<K extends keyof AudioPlayerEvents>(
        event: K,
        listener: AudioPlayerListener<K>,
    ): this {
        let set = this.#listeners.get(event) as
            Set<AudioPlayerListener<K>> | undefined;
        if (!set) {
            this.#listeners.set(
                event,
                (set = new Set() as unknown as Set<
                    AudioPlayerListener<keyof AudioPlayerEvents>
                >),
            );
        }
        (set as unknown as Set<AudioPlayerListener<K>>).add(listener);
        return this;
    }

    /** Removes an event listener. @returns `this` for chaining. */
    public off<K extends keyof AudioPlayerEvents>(
        event: K,
        listener: AudioPlayerListener<K>,
    ): this {
        (
            this.#listeners.get(event) as
                Set<AudioPlayerListener<K>> | undefined
        )?.delete(listener);
        return this;
    }

    /**
     * Handles a decoded audio chunk. The base implementation is a no-op;
     * subclasses override this to pipe audio to a UDP socket or other sink.
     * @param chunk A chunk of audio bytes read from the current stream.
     */
    protected onChunk(chunk: Uint8Array): void {
        void chunk;
    }

    /** Reads chunks from the reader while the player is in a playing state. */
    async #pump(): Promise<void> {
        const reader = this.#reader;
        if (!reader) return;
        while (true) {
            // Suspend without polling: park until resume()/stop() signals us.
            if (this.#state === "paused") {
                await new Promise<void>((resolve) => {
                    this.#resumeSignal = resolve;
                });
            }
            // Abort if stopped/idle (e.g. resolved by stop()).
            if (this.#state !== "playing") return;
            const { done, value } = await reader.read();
            if (done) {
                if (this.#state === "playing" || this.#state === "paused") {
                    this.#transition("idle");
                    this.#stream = undefined;
                    this.#reader = undefined;
                    this.#emit("finish");
                }
                return;
            }
            // A stop() during the read wins — drop the chunk and exit.
            if (this.#state !== "playing" && this.#state !== "paused") return;
            // Deliver the chunk to the sink hook; loop back to honour pause state.
            this.onChunk(value);
        }
    }

    #transition(next: AudioPlayerState): void {
        if (this.#state === next) return;
        const from = this.#state;
        this.#state = next;
        this.#emit("stateChange", from, next);
    }

    #emitError(err: unknown): void {
        this.#emit(
            "error",
            err instanceof Error ? err : new VoiceError(String(err)),
        );
    }

    #emit<K extends keyof AudioPlayerEvents>(
        event: K,
        ...args: AudioPlayerEvents[K]
    ): void {
        for (const listener of this.#listeners.get(event) ?? []) {
            try {
                void (listener as (...a: unknown[]) => unknown)(...args);
            } catch {
                /* Listener failures are isolated. */
            }
        }
    }
}

// ─── Audio Receive Pipeline ───────────────────────────────────────────────────

/** Tracks incoming audio and maps SSRCs to readable streams per user. */
export class VoiceReceiver {
    /** The connection this receiver is attached to. */
    public readonly connection: VoiceConnection;
    readonly #ssrcMap = new Map<number, string>();
    /** Active stream controllers per user; a Set so multiple subscribers to the
     * same user all receive audio instead of the last one overwriting earlier ones. */
    readonly #streams = new Map<
        string,
        Set<ReadableStreamDefaultController<Uint8Array>>
    >();

    /** Creates a VoiceReceiver. @param connection Voice connection. */
    public constructor(connection: VoiceConnection) {
        this.connection = connection;
    }

    /** Maps an SSRC to a User ID (usually from gateway speaking events). */
    public mapSsrc(ssrc: number, userId: string): void {
        this.#ssrcMap.set(ssrc, userId);
    }

    /** Subscribes to incoming audio from a specific user. @param userId User identifier. @returns A binary readable stream of the audio. */
    public subscribe(userId: string): AudioStream {
        let controllerRef: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
                controllerRef = controller;
                let set = this.#streams.get(userId);
                if (!set) this.#streams.set(userId, (set = new Set()));
                set.add(controller);
            },
            cancel: () => {
                const set = this.#streams.get(userId);
                if (set) {
                    set.delete(controllerRef);
                    if (set.size === 0) this.#streams.delete(userId);
                }
            },
        });
        return new AudioStream(stream, { title: `User ${userId} Audio` });
    }

    /** Processes an incoming UDP packet, extracting SSRC and routing the audio
     * payload (RTP header stripped) to every subscriber for the mapped user. */
    public onPacket(packet: Uint8Array): void {
        if (packet.length < 12) return;

        const view = new DataView(
            packet.buffer,
            packet.byteOffset,
            packet.byteLength,
        );
        const ssrc = view.getUint32(8, false);

        const userId = this.#ssrcMap.get(ssrc);
        if (!userId) return;
        const controllers = this.#streams.get(userId);
        if (!controllers || controllers.size === 0) return;

        // Compute the RTP payload offset: 12-byte fixed header + CSRC list, plus
        // the extension header when the X bit is set.
        const csrcCount = packet[0] & 0x0f;
        let offset = 12 + csrcCount * 4;
        const hasExtension = (packet[0] & 0x10) !== 0;
        if (hasExtension) {
            if (packet.length < offset + 4) return;
            const extWords = view.getUint16(offset + 2, false);
            offset += 4 + extWords * 4;
        }
        if (packet.length < offset) return;
        const payload = packet.slice(offset);

        for (const controller of controllers) {
            try {
                controller.enqueue(payload);
            } catch {
                // Ignore errors on closed streams.
            }
        }
    }
}
