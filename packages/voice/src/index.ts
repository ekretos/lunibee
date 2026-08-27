/** Represents the connection state of a voice session. */
export type VoiceConnectionState = "disconnected" | "connecting" | "connected";

/** Lightweight foundation for Discord voice sessions. */
export class VoiceConnection {
    /** Current voice connection state. */
    public state: VoiceConnectionState = "disconnected";
    /** Guild ID associated with the session. */
    public readonly guildId: string;

    /** Creates a voice connection. */
    public constructor(guildId: string) { this.guildId = guildId; }

    /** Marks the voice connection as connected. */
    public connect(): void { this.state = "connected"; }
    /** Marks the voice connection as disconnected. */
    public disconnect(): void { this.state = "disconnected"; }
}
