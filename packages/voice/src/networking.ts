import {
    PacketCipher,
    chooseEncryptionMode,
    rtpHeader,
    parseRtpHeader,
    type VoiceEncryptionMode,
} from "./crypto.js";
import { DaveSession, loadDave } from "./dave.js";
import {
    VoiceGateway,
    voiceGatewayURL,
    type VoiceBinaryPacket,
    type VoicePacket,
    type VoiceSocketFactory,
} from "./gateway.js";
import {
    FRAME_SAMPLES,
    RTP_OPUS_PAYLOAD_TYPE,
    VoiceCloseCodes,
    VoiceError,
    VoiceOpcodes,
    canResumeVoice,
} from "./protocol.js";
import { VoiceUdp, type UdpSocketFactory } from "./udp.js";

/** What Discord sent for one voice session (VOICE_STATE_UPDATE + VOICE_SERVER_UPDATE). */
export interface VoiceServerInfo {
    guildId: string;
    channelId: string;
    userId: string;
    sessionId: string;
    token: string;
    endpoint: string;
}

/** Where a {@link VoiceNetworking} is in its handshake. */
export type NetworkingState =
    | "opening"
    | "identifying"
    | "discovering"
    | "selecting"
    | "ready"
    | "resuming"
    | "closed";

/** Options for {@link VoiceNetworking}. */
export interface VoiceNetworkingOptions {
    /** Offer DAVE (end-to-end encryption) when `@snazzah/davey` is installed. Default true. Discord requires it outside stage channels. */
    dave?: boolean;
    /** Opens the voice WebSocket (tests). */
    socketFactory?: VoiceSocketFactory;
    /** Opens the UDP socket (tests). */
    udpFactory?: UdpSocketFactory;
    /** Overrides the voice gateway URL built from the endpoint (tests): a URL, or a function of the endpoint. */
    url?: string | ((endpoint: string) => string);
    debug?: (message: string) => void;
    /** @internal A DAVE implementation in place of `@snazzah/davey` (tests). */
    daveModule?: Awaited<ReturnType<typeof loadDave>>;
}

/** What a {@link VoiceNetworking} reports. */
export interface VoiceNetworkingHandlers {
    state?(state: NetworkingState, previous: NetworkingState): void;
    /** The session closed for good (not resumable). */
    close?(code: number, reason: string): void;
    error?(error: Error): void;
    /** An Opus frame from another user, decrypted. */
    audio?(userId: string, frame: Uint8Array): void;
    /** Op 5 from another user: their SSRC. */
    speaking?(userId: string, ssrc: number): void;
    /** Op 13. */
    clientDisconnect?(userId: string): void;
}

/**
 * One voice server session: the voice gateway handshake (v8), IP discovery,
 * transport encryption, DAVE, and sending and receiving RTP packets. A new
 * server (VOICE_SERVER_UPDATE) needs a new instance; a recoverable close
 * (network loss, voice server crash) resumes on its own.
 */
export class VoiceNetworking {
    public state: NetworkingState = "opening";
    /** Our SSRC, from READY. */
    public ssrc = 0;
    /** The negotiated encryption mode, once ready. */
    public mode?: VoiceEncryptionMode;
    readonly #info: VoiceServerInfo;
    readonly #options: VoiceNetworkingOptions;
    readonly #handlers: VoiceNetworkingHandlers;
    #gateway: VoiceGateway;
    #udp?: VoiceUdp;
    #cipher?: PacketCipher;
    #dave?: DaveSession;
    #maxDave = 0;
    #daveModule: Awaited<ReturnType<typeof loadDave>> = null;
    #sequence = Math.floor(Math.random() * 0x10000);
    #timestamp = Math.floor(Math.random() * 0x100000000);
    #speaking = false;
    readonly #users = new Map<number, string>();
    readonly #connected = new Set<string>();

    public constructor(
        info: VoiceServerInfo,
        handlers: VoiceNetworkingHandlers = {},
        options: VoiceNetworkingOptions = {},
    ) {
        this.#info = info;
        this.#handlers = handlers;
        this.#options = options;
        this.#gateway = this.#openGateway();
    }

    /** Heartbeat round trip in ms, or -1. */
    public get ping(): number {
        return this.#gateway.ping;
    }

    /** The DAVE session, when Discord negotiated one. */
    public get dave(): DaveSession | undefined {
        return this.#dave;
    }

    /** User IDs in the channel, from ops 11 and 13. */
    public get connectedUsers(): ReadonlySet<string> {
        return this.#connected;
    }

    #debug(message: string): void {
        this.#options.debug?.(message);
    }

    #setState(next: NetworkingState): void {
        if (this.state === next) return;
        const previous = this.state;
        this.state = next;
        this.#handlers.state?.(next, previous);
    }

    #error(error: unknown): void {
        this.#handlers.error?.(
            error instanceof Error ? error : new VoiceError(String(error)),
        );
    }

    #openGateway(sequence?: number): VoiceGateway {
        return new VoiceGateway(
            typeof this.#options.url === "function"
                ? this.#options.url(this.#info.endpoint)
                : (this.#options.url ?? voiceGatewayURL(this.#info.endpoint)),
            {
                open: () => void this.#onOpen(),
                packet: (packet) => this.#onPacket(packet),
                binary: (packet) => this.#onBinary(packet),
                close: (code, reason) => this.#onClose(code, reason),
                error: (error) => this.#error(error),
            },
            { factory: this.#options.socketFactory, sequence },
        );
    }

    async #onOpen(): Promise<void> {
        const { guildId, userId, sessionId, token } = this.#info;
        if (this.state === "resuming") {
            this.#gateway.sendJSON({
                op: VoiceOpcodes.Resume,
                d: {
                    server_id: guildId,
                    session_id: sessionId,
                    token,
                    seq_ack: this.#gateway.sequence,
                },
            });
            return;
        }
        if (this.state !== "opening") return;
        this.#daveModule =
            this.#options.dave === false
                ? null
                : (this.#options.daveModule ?? (await loadDave()));
        this.#maxDave = this.#daveModule?.DAVE_PROTOCOL_VERSION ?? 0;
        if (this.state !== "opening") return;
        this.#gateway.sendJSON({
            op: VoiceOpcodes.Identify,
            d: {
                server_id: guildId,
                user_id: userId,
                session_id: sessionId,
                token,
                max_dave_protocol_version: this.#maxDave,
            },
        });
        this.#setState("identifying");
    }

    #onPacket(packet: VoicePacket): void {
        const d = (packet.d ?? {}) as Record<string, unknown>;
        switch (packet.op) {
            case VoiceOpcodes.Ready:
                if (this.state === "identifying") void this.#onReady(d);
                return;
            case VoiceOpcodes.SessionDescription:
                if (this.state === "selecting") this.#onSession(d);
                return;
            case VoiceOpcodes.Resumed:
                if (this.state === "resuming") {
                    this.#speaking = false;
                    this.#setState("ready");
                }
                return;
            case VoiceOpcodes.Speaking:
                if (
                    typeof d.user_id === "string" &&
                    typeof d.ssrc === "number"
                ) {
                    this.#users.set(d.ssrc, d.user_id);
                    this.#handlers.speaking?.(d.user_id, d.ssrc);
                }
                return;
            case VoiceOpcodes.ClientsConnect:
                if (Array.isArray(d.user_ids))
                    for (const id of d.user_ids)
                        if (typeof id === "string") this.#connected.add(id);
                return;
            case VoiceOpcodes.ClientDisconnect:
                if (typeof d.user_id === "string") {
                    this.#connected.delete(d.user_id);
                    for (const [ssrc, user] of this.#users)
                        if (user === d.user_id) this.#users.delete(ssrc);
                    this.#handlers.clientDisconnect?.(d.user_id);
                }
                return;
        }
        const dave = this.#dave;
        if (!dave || (this.state !== "ready" && this.state !== "resuming"))
            return;
        const transitionId = Number(d.transition_id ?? 0);
        if (packet.op === VoiceOpcodes.DavePrepareTransition) {
            if (
                dave.prepareTransition(
                    transitionId,
                    Number(d.protocol_version ?? 0),
                )
            )
                this.#gateway.sendJSON({
                    op: VoiceOpcodes.DaveTransitionReady,
                    d: { transition_id: transitionId },
                });
        } else if (packet.op === VoiceOpcodes.DaveExecuteTransition)
            dave.executeTransition(transitionId);
        else if (packet.op === VoiceOpcodes.DavePrepareEpoch)
            dave.prepareEpoch(
                Number(d.epoch ?? 0),
                Number(d.protocol_version ?? 0),
            );
    }

    #onBinary(packet: VoiceBinaryPacket): void {
        const dave = this.#dave;
        if (!dave || this.state !== "ready") return;
        try {
            switch (packet.op) {
                case VoiceOpcodes.DaveMlsExternalSender:
                    dave.setExternalSender(packet.payload);
                    return;
                case VoiceOpcodes.DaveMlsProposals: {
                    const reply = dave.processProposals(
                        packet.payload,
                        this.#connected,
                    );
                    if (reply)
                        this.#gateway.sendBinary(
                            VoiceOpcodes.DaveMlsCommitWelcome,
                            reply,
                        );
                    return;
                }
                case VoiceOpcodes.DaveMlsAnnounceCommitTransition:
                case VoiceOpcodes.DaveMlsWelcome: {
                    const { transitionId, ok } = dave.process(
                        packet.op === VoiceOpcodes.DaveMlsWelcome
                            ? "welcome"
                            : "commit",
                        packet.payload,
                    );
                    if (ok && transitionId !== 0)
                        this.#gateway.sendJSON({
                            op: VoiceOpcodes.DaveTransitionReady,
                            d: { transition_id: transitionId },
                        });
                    return;
                }
            }
        } catch (error) {
            this.#error(error);
        }
    }

    async #onReady(d: Record<string, unknown>): Promise<void> {
        const { ssrc, ip, port, modes } = d as {
            ssrc: number;
            ip: string;
            port: number;
            modes: string[];
        };
        this.ssrc = ssrc;
        this.#setState("discovering");
        try {
            const mode = chooseEncryptionMode(
                Array.isArray(modes) ? modes : [],
            );
            const udp = await VoiceUdp.open(ip, port, this.#options.udpFactory);
            if (this.state !== "discovering") return void udp.close();
            this.#udp = udp;
            udp.onPacket((packet) => this.#receive(packet));
            const local = await udp.discover(ssrc);
            if (this.state !== "discovering") return;
            this.#gateway.sendJSON({
                op: VoiceOpcodes.SelectProtocol,
                d: {
                    protocol: "udp",
                    data: { address: local.ip, port: local.port, mode },
                },
            });
            this.#setState("selecting");
        } catch (error) {
            this.#error(error);
            this.destroy();
            this.#handlers.close?.(
                4000,
                error instanceof Error ? error.message : String(error),
            );
        }
    }

    #onSession(d: Record<string, unknown>): void {
        const key = d.secret_key;
        if (!Array.isArray(key) || typeof d.mode !== "string") return;
        try {
            this.#cipher = new PacketCipher(
                d.mode as VoiceEncryptionMode,
                Uint8Array.from(key as number[]),
            );
        } catch (error) {
            this.#error(error);
            return;
        }
        this.mode = this.#cipher.mode;
        const daveVersion = Number(d.dave_protocol_version ?? 0);
        const module = this.#daveModule;
        if (module && this.#maxDave > 0) {
            this.#dave = new DaveSession(
                module,
                daveVersion,
                this.#info.userId,
                this.#info.channelId,
                {
                    keyPackage: (payload) =>
                        this.#gateway.sendBinary(
                            VoiceOpcodes.DaveMlsKeyPackage,
                            payload,
                        ),
                    invalidTransition: (transitionId) =>
                        this.#gateway.sendJSON({
                            op: VoiceOpcodes.DaveMlsInvalidCommitWelcome,
                            d: { transition_id: transitionId },
                        }),
                    debug: (message) => this.#debug(message),
                },
            );
        }
        this.#setState("ready");
        this.#dave?.reinit();
    }

    #onClose(code: number, reason: string): void {
        if (this.state === "closed") return;
        if (
            canResumeVoice(code) &&
            (this.state === "ready" || this.state === "resuming")
        ) {
            this.#debug(`Voice gateway closed (${code}); resuming.`);
            this.#setState("resuming");
            this.#gateway = this.#openGateway(this.#gateway.sequence);
            return;
        }
        this.destroy();
        const hint =
            code === VoiceCloseCodes.DaveProtocolRequired && this.#maxDave === 0
                ? " Discord requires end-to-end encryption (DAVE): install @snazzah/davey."
                : "";
        this.#handlers.close?.(code, `${reason}${hint}`.trim());
    }

    #receive(packet: Uint8Array): void {
        const cipher = this.#cipher;
        if (!cipher) return;
        const header = parseRtpHeader(packet);
        if (!header || header.payloadType !== RTP_OPUS_PAYLOAD_TYPE) return;
        const userId = this.#users.get(header.ssrc);
        if (!userId) return;
        const opened = cipher.open(packet);
        if (!opened) return;
        const frame = this.#dave
            ? this.#dave.decrypt(opened.payload, userId)
            : opened.payload;
        if (frame) this.#handlers.audio?.(userId, frame);
    }

    /** Sends op 5. Only sends when the flag changes. */
    public setSpeaking(speaking: boolean, flags = 1): void {
        if (this.state !== "ready" || this.#speaking === speaking) return;
        this.#speaking = speaking;
        this.#gateway.sendJSON({
            op: VoiceOpcodes.Speaking,
            d: { speaking: speaking ? flags : 0, delay: 0, ssrc: this.ssrc },
        });
    }

    /**
     * Encrypts one 20 ms Opus frame (DAVE, then transport) and sends it.
     * Sequence and timestamp advance by one frame either way.
     * @returns Whether it was sent.
     */
    public sendFrame(frame: Uint8Array): boolean {
        const cipher = this.#cipher;
        const udp = this.#udp;
        if (this.state !== "ready" || !cipher || !udp) return false;
        this.setSpeaking(true);
        const header = rtpHeader(this.#sequence, this.#timestamp, this.ssrc);
        this.#sequence = (this.#sequence + 1) & 0xffff;
        this.#timestamp = (this.#timestamp + FRAME_SAMPLES) >>> 0;
        const payload = this.#dave ? this.#dave.encrypt(frame) : frame;
        return udp.send(cipher.seal(header, payload));
    }

    /** Ends the session: gateway, UDP socket, DAVE state. Safe to call twice. */
    public destroy(): void {
        if (this.state === "closed") return;
        this.#setState("closed");
        this.#gateway.close(1000, "Voice session ended.");
        this.#udp?.close();
        this.#udp = undefined;
        this.#dave?.destroy();
        this.#dave = undefined;
        this.#cipher = undefined;
        this.#users.clear();
        this.#connected.clear();
    }
}
