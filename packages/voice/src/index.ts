/** Voice session lifecycle states. */
export type VoiceConnectionState = "disconnected" | "connecting" | "connected" | "destroyed";

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

/** Tracks a Discord voice session and its lifecycle. */
export class VoiceConnection {
    /** Current voice connection state. */
    public state: VoiceConnectionState = "disconnected";
    /** Guild associated with this voice session. */
    public readonly guildId: string;
    /** Voice channel associated with this session. */
    public channelId?: string;
    /** Whether the client is self-muted. */
    public selfMute: boolean;
    /** Whether the client is self-deafened. */
    public selfDeaf: boolean;

    /** Creates a voice connection state manager. */
    public constructor(options: string | VoiceConnectionOptions) {
        const resolved = typeof options === "string" ? { guildId: options } : options;
        if (!resolved.guildId.trim()) throw new TypeError("A guild ID is required for a voice connection.");
        this.guildId = resolved.guildId;
        this.channelId = resolved.channelId;
        this.selfMute = resolved.selfMute ?? false;
        this.selfDeaf = resolved.selfDeaf ?? false;
    }

    /** Begins the connection lifecycle. */
    public connect(): void {
        this.assertUsable();
        if (this.state === "connected") return;
        this.state = "connecting";
        this.state = "connected";
    }

    /** Disconnects the current voice session. */
    public disconnect(): void {
        if (this.state === "destroyed") return;
        this.state = "disconnected";
    }

    /** Permanently destroys this voice connection. */
    public destroy(): void {
        this.state = "destroyed";
        this.channelId = undefined;
    }

    /** Updates the voice channel and connection state. */
    public setChannel(channelId: string): void {
        this.assertUsable();
        if (!channelId.trim()) throw new TypeError("A voice channel ID is required.");
        this.channelId = channelId;
    }

    /** Updates self mute/deaf state. */
    public setSuppression(options: { selfMute?: boolean; selfDeaf?: boolean }): void {
        this.assertUsable();
        if (options.selfMute !== undefined) this.selfMute = options.selfMute;
        if (options.selfDeaf !== undefined) this.selfDeaf = options.selfDeaf;
    }

    private assertUsable(): void {
        if (this.state === "destroyed") throw new Error("Voice connection has been destroyed.");
    }
}
