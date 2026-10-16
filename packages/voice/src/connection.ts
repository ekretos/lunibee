import {
    VoiceNetworking,
    type NetworkingState,
    type VoiceNetworkingOptions,
} from "./networking.js";
import type { AudioPlayer, AudioSink } from "./player.js";
import { Emitter } from "./emitter.js";
import { VoiceError } from "./protocol.js";
import { VoiceReceiver } from "./receiver.js";

/** Where a {@link VoiceConnection} is. */
export const VoiceConnectionStatus = {
    /** Asked Discord to join (op 4); waiting for the voice state and server. */
    Signalling: "signalling",
    /** Connecting to the voice server. */
    Connecting: "connecting",
    /** Can send and receive audio. */
    Ready: "ready",
    /** Not in a channel (left, removed, timed out or failed). `rejoin()` brings it back. */
    Disconnected: "disconnected",
    /** Gone for good. */
    Destroyed: "destroyed",
} as const;
export type VoiceConnectionStatus =
    (typeof VoiceConnectionStatus)[keyof typeof VoiceConnectionStatus];

/** The bot's own VOICE_STATE_UPDATE, as the adapter forwards it. */
export interface VoiceStateData {
    guild_id?: string;
    channel_id: string | null;
    user_id: string;
    session_id: string;
}

/** VOICE_SERVER_UPDATE. `endpoint` is null while Discord moves the guild to another server. */
export interface VoiceServerData {
    guild_id: string;
    token: string;
    endpoint: string | null;
}

/** What a connection gives its adapter. */
export interface VoiceAdapterMethods {
    onVoiceStateUpdate(data: VoiceStateData): void;
    onVoiceServerUpdate(data: VoiceServerData): void;
    /** The adapter is gone (its client was destroyed): destroy without sending anything. */
    destroy(): void;
}

/** An op 4 (Voice State Update) payload. */
export interface VoiceStatePayload {
    op: 4;
    d: {
        guild_id: string;
        channel_id: string | null;
        self_mute: boolean;
        self_deaf: boolean;
    };
}

/** How a connection reaches the main Gateway: send op 4, and be told about voice events. */
export interface VoiceAdapter {
    /** Sends op 4 through the shard that owns the guild. @returns Whether it was sent. */
    sendPayload(payload: VoiceStatePayload): boolean;
    destroy(): void;
}

/** Builds an adapter for a guild. `@discordjs/voice`'s adapter shape. */
export type VoiceAdapterCreator = (
    methods: VoiceAdapterMethods,
) => VoiceAdapter;

/** Options for {@link joinVoiceChannel}. */
export interface JoinVoiceChannelOptions {
    guildId: string;
    channelId: string;
    selfMute?: boolean;
    selfDeaf?: boolean;
    adapterCreator: VoiceAdapterCreator;
    /** Ms to wait for Discord's voice events and the voice server. Default 15,000. */
    timeout?: number;
    /** Offer DAVE end-to-end encryption (needs `@snazzah/davey`). Default true. */
    dave?: boolean;
    debug?: (message: string) => void;
    /** Socket factories and URL override, for tests. */
    networking?: Pick<
        VoiceNetworkingOptions,
        "socketFactory" | "udpFactory" | "url" | "daveModule"
    >;
}

/** Why a connection is disconnected. */
export interface DisconnectReason {
    /**
     * `"left"` (disconnect()), `"removed"` (moved out or kicked), `"timeout"`,
     * `"closed"` (the voice server closed the session), `"unsent"` (op 4 could
     * not be sent: the client is not connected).
     */
    reason: "left" | "removed" | "timeout" | "closed" | "unsent";
    /** The voice gateway close code, for `"closed"`. */
    code?: number;
    message?: string;
}

/** What a {@link VoiceConnection} emits. */
export interface VoiceConnectionEvents {
    /** Note the order: the new status first. */
    stateChange: [next: VoiceConnectionStatus, previous: VoiceConnectionStatus];
    error: [error: Error];
    debug: [message: string];
}

/** A player subscribed to a connection. */
export interface PlayerSubscription {
    readonly connection: VoiceConnection;
    readonly player: AudioPlayer;
    unsubscribe(): void;
}

/**
 * The bot's voice session in one guild: it asks Discord to join (op 4),
 * connects to the voice server when the voice state and server arrive,
 * reconnects when the server or channel changes, and sends a subscribed
 * player's audio. Create it with `client.voice.join()` or
 * {@link joinVoiceChannel}.
 */
export class VoiceConnection extends Emitter<VoiceConnectionEvents> {
    public status: VoiceConnectionStatus = "signalling";
    public readonly guildId: string;
    public channelId: string;
    public selfMute: boolean;
    public selfDeaf: boolean;
    /** Why it is disconnected, while it is. */
    public disconnectReason?: DisconnectReason;
    /** Incoming audio. */
    public readonly receiver = new VoiceReceiver();
    readonly #options: JoinVoiceChannelOptions;
    readonly #adapter: VoiceAdapter;
    #networking?: VoiceNetworking;
    #sessionId?: string;
    #userId?: string;
    #token?: string;
    #endpoint?: string;
    #timer?: ReturnType<typeof setTimeout>;
    #leaving = false;
    #subscription?: PlayerSubscription;
    readonly #sink: AudioSink;

    public constructor(options: JoinVoiceChannelOptions) {
        super();
        if (!options.guildId?.trim())
            throw new TypeError("A guild ID is required.");
        if (!options.channelId?.trim())
            throw new TypeError("A voice channel ID is required.");
        if (typeof options.adapterCreator !== "function")
            throw new TypeError("An adapterCreator is required.");
        this.#options = { ...options };
        this.guildId = options.guildId;
        this.channelId = options.channelId;
        this.selfMute = options.selfMute ?? false;
        this.selfDeaf = options.selfDeaf ?? false;
        const self = this;
        this.#sink = {
            get ready() {
                return self.status === "ready";
            },
            sendFrame: (frame) => this.#networking?.sendFrame(frame) ?? false,
            setSpeaking: (speaking) => this.#networking?.setSpeaking(speaking),
        };
        this.#adapter = options.adapterCreator({
            onVoiceStateUpdate: (data) => this.#onState(data),
            onVoiceServerUpdate: (data) => this.#onServer(data),
            destroy: () => this.destroy(false),
        });
        this.#signal();
    }

    /** Heartbeat round trip of the voice gateway in ms, or -1. */
    public get ping(): number {
        return this.#networking?.ping ?? -1;
    }

    /** The voice privacy code (DAVE) users can compare, or `null`. */
    public get voicePrivacyCode(): string | null {
        return this.#networking?.dave?.voicePrivacyCode ?? null;
    }

    /** Whether audio is end-to-end encrypted (DAVE) right now. */
    public get endToEndEncrypted(): boolean {
        return this.#networking?.dave?.active ?? false;
    }

    /** The subscribed player's subscription, if any. */
    public get subscription(): PlayerSubscription | undefined {
        return this.#subscription;
    }

    #debug(message: string): void {
        this.#options.debug?.(message);
        this.emit("debug", message);
    }

    #setStatus(next: VoiceConnectionStatus, reason?: DisconnectReason): void {
        if (this.status === "destroyed") return;
        this.disconnectReason = next === "disconnected" ? reason : undefined;
        if (next === "ready" || next === "disconnected" || next === "destroyed")
            this.#clearTimer();
        if (this.status === next) return;
        const previous = this.status;
        this.status = next;
        this.emit("stateChange", next, previous);
        this.#subscription?.player.refresh();
    }

    #clearTimer(): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = undefined;
    }

    /** Sends op 4 for the current channel and waits for Discord, with the timeout. */
    #signal(): boolean {
        this.#leaving = false;
        this.#setStatus("signalling");
        this.#clearTimer();
        const timeout = this.#options.timeout ?? 15_000;
        this.#timer = setTimeout(() => {
            this.#timer = undefined;
            if (this.status !== "signalling" && this.status !== "connecting")
                return;
            this.#networking?.destroy();
            this.#networking = undefined;
            this.#setStatus("disconnected", {
                reason: "timeout",
                message: `No voice connection within ${timeout} ms.`,
            });
            this.emit(
                "error",
                new VoiceError(
                    `Joining the voice channel timed out after ${timeout} ms.`,
                ),
            );
        }, timeout);
        (this.#timer as { unref?: () => void }).unref?.();
        if (this.#send(this.channelId)) return true;
        this.#setStatus("disconnected", {
            reason: "unsent",
            message:
                "The voice state update could not be sent: the client is not connected, or the guild is on another shard.",
        });
        return false;
    }

    #send(channelId: string | null): boolean {
        try {
            return this.#adapter.sendPayload({
                op: 4,
                d: {
                    guild_id: this.guildId,
                    channel_id: channelId,
                    self_mute: this.selfMute,
                    self_deaf: this.selfDeaf,
                },
            });
        } catch (error) {
            this.emit(
                "error",
                error instanceof Error ? error : new VoiceError(String(error)),
            );
            return false;
        }
    }

    #onState(data: VoiceStateData): void {
        if (this.status === "destroyed") return;
        if (data.channel_id === null) {
            this.#networking?.destroy();
            this.#networking = undefined;
            this.receiver.close();
            this.#setStatus("disconnected", {
                reason: this.#leaving ? "left" : "removed",
            });
            return;
        }
        const moved = data.channel_id !== this.channelId;
        const newSession = data.session_id !== this.#sessionId;
        this.#sessionId = data.session_id;
        this.#userId = data.user_id;
        this.channelId = data.channel_id;
        // A move (by us or a moderator) changes the DAVE group: reconnect.
        if (moved || newSession || !this.#networking) this.#connect();
    }

    #onServer(data: VoiceServerData): void {
        if (this.status === "destroyed") return;
        if (data.endpoint === null) {
            // Discord is moving the guild to another voice server; a new update follows.
            this.#networking?.destroy();
            this.#networking = undefined;
            if (this.status === "ready") this.#setStatus("connecting");
            return;
        }
        this.#token = data.token;
        this.#endpoint = data.endpoint;
        this.#connect();
    }

    #connect(): void {
        const { channelId } = this;
        const sessionId = this.#sessionId;
        const userId = this.#userId;
        const token = this.#token;
        const endpoint = this.#endpoint;
        if (!sessionId || !userId || !token || !endpoint) return;
        this.#networking?.destroy();
        this.#setStatus("connecting");
        // The join's timer covers a first connect; a reconnect gets its own.
        if (!this.#timer) this.#armReconnectTimeout();
        this.#debug(`Connecting to voice server ${endpoint}.`);
        const networking: VoiceNetworking = new VoiceNetworking(
            {
                guildId: this.guildId,
                channelId,
                userId,
                sessionId,
                token,
                endpoint,
            },
            {
                state: (state: NetworkingState) => {
                    if (this.#networking !== networking) return;
                    if (state === "ready") this.#setStatus("ready");
                    else if (state === "resuming")
                        this.#setStatus("connecting");
                },
                close: (code, reason) => {
                    if (this.#networking !== networking) return;
                    this.#networking = undefined;
                    this.#setStatus("disconnected", {
                        reason: "closed",
                        code,
                        message: reason,
                    });
                    if (reason)
                        this.emit(
                            "error",
                            new VoiceError(
                                `Voice server closed the session (${code}): ${reason}`,
                            ),
                        );
                },
                error: (error) => this.emit("error", error),
                audio: (user, frame) => this.receiver.push(user, frame),
                speaking: (user, ssrc) => this.receiver.mapUser(user, ssrc),
                clientDisconnect: (user) => this.receiver.forgetUser(user),
            },
            {
                dave: this.#options.dave,
                debug: (message) => this.#debug(message),
                ...this.#options.networking,
            },
        );
        this.#networking = networking;
    }

    /** A reconnect (new server or channel) gets the same time limit as the first join. */
    #armReconnectTimeout(): void {
        const timeout = this.#options.timeout ?? 15_000;
        this.#timer = setTimeout(() => {
            this.#timer = undefined;
            if (this.status !== "connecting") return;
            this.#networking?.destroy();
            this.#networking = undefined;
            this.#setStatus("disconnected", {
                reason: "timeout",
                message: `No voice server connection within ${timeout} ms.`,
            });
        }, timeout);
        (this.#timer as { unref?: () => void }).unref?.();
    }

    /**
     * Joins again, or moves to another channel, or changes mute/deaf.
     * @returns Whether op 4 was sent. @throws {VoiceError} If destroyed.
     */
    public rejoin(
        options: {
            channelId?: string;
            selfMute?: boolean;
            selfDeaf?: boolean;
        } = {},
    ): boolean {
        if (this.status === "destroyed")
            throw new VoiceError("The voice connection was destroyed.");
        if (options.channelId !== undefined) {
            if (!options.channelId.trim())
                throw new TypeError("A voice channel ID is required.");
            this.channelId = options.channelId;
        }
        if (options.selfMute !== undefined) this.selfMute = options.selfMute;
        if (options.selfDeaf !== undefined) this.selfDeaf = options.selfDeaf;
        // Only mute/deaf changed on a live connection: no reconnect needed.
        if (this.status === "ready" && options.channelId === undefined)
            return this.#send(this.channelId);
        return this.#signal();
    }

    /** Leaves the channel (op 4 with no channel); `rejoin()` can bring it back. @returns Whether op 4 was sent. */
    public disconnect(): boolean {
        if (this.status === "destroyed") return false;
        this.#leaving = true;
        this.#clearTimer();
        const sent = this.#send(null);
        this.#networking?.destroy();
        this.#networking = undefined;
        this.receiver.close();
        this.#setStatus("disconnected", { reason: "left" });
        return sent;
    }

    /**
     * Leaves and releases everything: voice gateway, UDP socket, DAVE state,
     * receiver streams, timers and the player subscription.
     * @param leave Send op 4 to leave the channel (default true).
     */
    public destroy(leave = true): void {
        if (this.status === "destroyed") return;
        this.#clearTimer();
        if (leave) {
            this.#leaving = true;
            this.#send(null);
        }
        this.#networking?.destroy();
        this.#networking = undefined;
        this.receiver.close();
        this.#subscription?.unsubscribe();
        const previous = this.status;
        this.status = "destroyed";
        this.disconnectReason = undefined;
        this.emit("stateChange", "destroyed", previous);
        try {
            this.#adapter.destroy();
        } catch {
            // Best effort.
        }
        this.removeAllListeners();
    }

    /** Plays `player` on this connection, replacing any other player. */
    public subscribe(player: AudioPlayer): PlayerSubscription {
        if (this.status === "destroyed")
            throw new VoiceError("The voice connection was destroyed.");
        this.#subscription?.unsubscribe();
        const subscription: PlayerSubscription = {
            connection: this,
            player,
            unsubscribe: () => {
                player.detach(this.#sink);
                if (this.#subscription === subscription)
                    this.#subscription = undefined;
            },
        };
        this.#subscription = subscription;
        player.attach(this.#sink);
        return subscription;
    }

    /** Sends op 5 now. Players do this on their own; use it for custom audio. */
    public setSpeaking(speaking: boolean): void {
        this.#networking?.setSpeaking(speaking);
    }

    /** Sends one 20 ms Opus frame now (for custom audio pipelines). @returns Whether it was sent. */
    public playOpusPacket(frame: Uint8Array): boolean {
        return this.#networking?.sendFrame(frame) ?? false;
    }
}

const tracked = new Map<string, VoiceConnection>();

/**
 * Joins (or moves to) a voice channel with your own adapter, and tracks the
 * connection per guild. With a Lunibee `Client`, use `client.voice.join()`.
 */
export function joinVoiceChannel(
    options: JoinVoiceChannelOptions,
): VoiceConnection {
    const existing = tracked.get(options.guildId);
    if (existing && existing.status !== "destroyed") {
        existing.rejoin(options);
        return existing;
    }
    const connection = new VoiceConnection(options);
    tracked.set(options.guildId, connection);
    connection.on("stateChange", (next) => {
        if (
            next === "destroyed" &&
            tracked.get(connection.guildId) === connection
        )
            tracked.delete(connection.guildId);
    });
    return connection;
}

/** The connection {@link joinVoiceChannel} tracks for a guild. */
export function getVoiceConnection(
    guildId: string,
): VoiceConnection | undefined {
    return tracked.get(guildId);
}

/** What a {@link VoiceManager} needs from its client. */
export interface VoiceManagerClient {
    /** The bot's user ID, once logged in. */
    readonly userId: string | undefined;
    /** Whether op 4 for this guild can be sent now (connected, and the guild is on this shard). */
    canSendVoiceState?(guildId: string): boolean;
    /** Sends op 4 through the owning shard. @returns Whether it was sent. */
    sendVoiceState(
        guildId: string,
        channelId: string | null,
        options: { selfMute?: boolean; selfDeaf?: boolean },
    ): boolean;
}

/** Options for {@link VoiceManager.join}. */
export type VoiceJoinOptions = Omit<JoinVoiceChannelOptions, "adapterCreator">;

/**
 * `client.voice`: one {@link VoiceConnection} per guild, wired to the
 * client's Gateway. The client forwards its own voice events and guild
 * removals here, and destroys every connection when it is destroyed.
 */
export class VoiceManager {
    readonly #client: VoiceManagerClient;
    readonly #connections = new Map<string, VoiceConnection>();
    readonly #adapters = new Map<string, VoiceAdapterMethods>();
    readonly #defaults: Partial<VoiceJoinOptions>;

    public constructor(
        client: VoiceManagerClient,
        defaults: Partial<VoiceJoinOptions> = {},
    ) {
        this.#client = client;
        this.#defaults = defaults;
    }

    /** Live connections by guild. */
    public get connections(): ReadonlyMap<string, VoiceConnection> {
        return this.#connections;
    }

    /** The connection for a guild, if any. */
    public get(guildId: string): VoiceConnection | undefined {
        return this.#connections.get(guildId);
    }

    /**
     * Joins a voice channel (or moves the guild's connection) and resolves
     * once audio can flow. @throws {VoiceError} If the guild is not on this
     * client's shard, or it is not ready within `timeout` (the connection is
     * then left disconnected; `rejoin()` or `leave()` it).
     */
    public join(options: VoiceJoinOptions): Promise<VoiceConnection> {
        const merged = { ...this.#defaults, ...options };
        if (
            this.#client.canSendVoiceState &&
            !this.#client.canSendVoiceState(options.guildId)
        )
            return Promise.reject(
                new VoiceError(
                    "Cannot send the voice state update: the client is not connected, or the guild is on another shard.",
                ),
            );
        let connection = this.#connections.get(options.guildId);
        if (connection && connection.status !== "destroyed")
            connection.rejoin(merged);
        else {
            connection = new VoiceConnection({
                ...merged,
                adapterCreator: (methods) => {
                    this.#adapters.set(options.guildId, methods);
                    return {
                        sendPayload: (payload) =>
                            this.#client.sendVoiceState(
                                payload.d.guild_id,
                                payload.d.channel_id,
                                {
                                    selfMute: payload.d.self_mute,
                                    selfDeaf: payload.d.self_deaf,
                                },
                            ),
                        destroy: () => {
                            if (this.#adapters.get(options.guildId) === methods)
                                this.#adapters.delete(options.guildId);
                        },
                    };
                },
            });
            const created = connection;
            this.#connections.set(options.guildId, created);
            created.on("stateChange", (next) => {
                if (
                    next === "destroyed" &&
                    this.#connections.get(created.guildId) === created
                )
                    this.#connections.delete(created.guildId);
            });
        }
        return waitReady(connection, merged.timeout ?? 15_000);
    }

    /** Leaves a guild's channel and destroys its connection. @returns Whether there was one. */
    public leave(guildId: string): boolean {
        const connection = this.#connections.get(guildId);
        if (!connection) return false;
        connection.destroy();
        return true;
    }

    /** @internal The client's own VOICE_STATE_UPDATE. */
    public handleVoiceState(
        data: VoiceStateData & { guild_id?: string },
    ): void {
        if (!data.guild_id || data.user_id !== this.#client.userId) return;
        this.#adapters.get(data.guild_id)?.onVoiceStateUpdate(data);
    }

    /** @internal VOICE_SERVER_UPDATE. */
    public handleVoiceServer(data: VoiceServerData): void {
        this.#adapters.get(data.guild_id)?.onVoiceServerUpdate(data);
    }

    /** @internal The bot left (or lost) a guild: drop its connection without sending anything. */
    public handleGuildRemove(guildId: string): void {
        this.#connections.get(guildId)?.destroy(false);
    }

    /** Destroys every connection. @param leave Send op 4 to leave each channel (default true). */
    public destroy(leave = true): void {
        for (const connection of [...this.#connections.values()])
            connection.destroy(leave);
        this.#connections.clear();
        this.#adapters.clear();
    }
}

/** Resolves when `connection` is ready; rejects when it disconnects, is destroyed, or `timeoutMs` passes. */
function waitReady(
    connection: VoiceConnection,
    timeoutMs: number,
): Promise<VoiceConnection> {
    if (connection.status === "ready") return Promise.resolve(connection);
    return new Promise((resolve, reject) => {
        const done = (error?: Error): void => {
            clearTimeout(timer);
            connection.off("stateChange", onChange);
            if (error) reject(error);
            else resolve(connection);
        };
        const onChange = (next: VoiceConnectionStatus): void => {
            if (next === "ready") done();
            else if (next === "destroyed")
                done(new VoiceError("The voice connection was destroyed."));
            else if (next === "disconnected")
                done(
                    new VoiceError(
                        `Could not join the voice channel: ${connection.disconnectReason?.message ?? connection.disconnectReason?.reason ?? "disconnected"}.`,
                    ),
                );
        };
        const timer = setTimeout(
            () =>
                done(
                    new VoiceError(
                        `Joining the voice channel timed out after ${timeoutMs} ms.`,
                    ),
                ),
            Math.min(timeoutMs + 50, 2_147_483_647),
        );
        connection.on("stateChange", onChange);
    });
}
