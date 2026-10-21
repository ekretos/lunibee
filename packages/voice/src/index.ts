import { VoiceConnection, type VoiceConnectionStatus } from "./connection.js";
import { loadDave } from "./dave.js";
import { createOpusCodec } from "./opus.js";
import { AudioPlayer, type AudioPlayerStatus } from "./player.js";
import { VoiceError } from "./protocol.js";

export {
    VOICE_GATEWAY_VERSION,
    VoiceOpcodes,
    VoiceCloseCodes,
    canResumeVoice,
    RTP_OPUS_PAYLOAD_TYPE,
    FRAME_DURATION_MS,
    FRAME_SAMPLES,
    PCM_FRAME_BYTES,
    SILENCE_FRAME,
    SpeakingFlags,
    VoiceError,
} from "./protocol.js";
export {
    PacketCipher,
    SUPPORTED_ENCRYPTION_MODES,
    chooseEncryptionMode,
    parseRtpHeader,
    rtpHeader,
    type RtpHeader,
    type VoiceEncryptionMode,
} from "./crypto.js";
export {
    VoiceGateway,
    voiceGatewayURL,
    HEARTBEAT_TIMEOUT_CLOSE,
    type VoiceBinaryPacket,
    type VoiceGatewayHandlers,
    type VoicePacket,
    type VoiceSocketFactory,
    type VoiceSocketLike,
} from "./gateway.js";
export {
    VoiceUdp,
    bunUdpSocket,
    discoveryRequest,
    parseDiscoveryResponse,
    type UdpSocketFactory,
    type UdpSocketLike,
} from "./udp.js";
export {
    DaveSession,
    loadDave,
    maxDaveProtocolVersion,
    type DaveSessionHooks,
} from "./dave.js";
export {
    VoiceNetworking,
    type NetworkingState,
    type VoiceNetworkingHandlers,
    type VoiceNetworkingOptions,
    type VoiceServerInfo,
} from "./networking.js";
export { createOpusCodec, type OpusCodec } from "./opus.js";
export { demuxOggOpus, OggOpusWriter } from "./ogg.js";
export {
    pitchShift,
    robot,
    echo,
    gain,
    type AudioEffect,
    type EchoOptions,
} from "./effects.js";
export {
    AudioResource,
    VolumeControl,
    createAudioResource,
    type AudioInput,
    type AudioResourceOptions,
    type StreamType,
} from "./resource.js";
export {
    AudioPlayer,
    AudioPlayerStatus,
    createAudioPlayer,
    type AudioPlayerEvents,
    type AudioPlayerOptions,
    type AudioSink,
} from "./player.js";
export {
    VoiceReceiver,
    type ReceiveEnd,
    type ReceiveOptions,
    type RecordOptions,
} from "./receiver.js";
export {
    VoiceConnection,
    VoiceConnectionStatus,
    VoiceManager,
    getVoiceConnection,
    joinVoiceChannel,
    type DisconnectReason,
    type JoinVoiceChannelOptions,
    type PlayerSubscription,
    type VoiceAdapter,
    type VoiceAdapterCreator,
    type VoiceAdapterMethods,
    type VoiceConnectionEvents,
    type VoiceJoinOptions,
    type VoiceManagerClient,
    type VoiceServerData,
    type VoiceStateData,
    type VoiceStatePayload,
} from "./connection.js";

/**
 * Resolves once `target` reaches `status`, or rejects after `timeoutMs`.
 * @throws {VoiceError} If the status is not reached in time.
 */
export function entersState<T extends VoiceConnection | AudioPlayer>(
    target: T,
    status: T extends VoiceConnection
        ? VoiceConnectionStatus
        : AudioPlayerStatus,
    timeoutMs: number,
): Promise<T> {
    const current =
        target instanceof VoiceConnection ? target.status : target.state;
    if (current === status) return Promise.resolve(target);
    const emitter = target as unknown as {
        on(event: "stateChange", fn: (a: string, b: string) => void): unknown;
        off(event: "stateChange", fn: (a: string, b: string) => void): unknown;
    };
    // A connection emits (next, previous); a player emits (from, to).
    const isConnection = target instanceof VoiceConnection;
    return new Promise<T>((resolve, reject) => {
        const onChange = (first: string, second: string): void => {
            if ((isConnection ? first : second) !== status) return;
            clearTimeout(timer);
            emitter.off("stateChange", onChange);
            resolve(target);
        };
        const timer = setTimeout(
            () => {
                emitter.off("stateChange", onChange);
                reject(
                    new VoiceError(
                        `Did not enter state "${String(status)}" within ${timeoutMs} ms.`,
                    ),
                );
            },
            Math.min(timeoutMs, 2_147_483_647),
        );
        emitter.on("stateChange", onChange);
    });
}

/** Which optional voice dependencies this runtime can load. */
export async function generateDependencyReport(): Promise<{
    dave: string | null;
    opus: string | null;
    ffmpeg: string | null;
}> {
    const dave = await loadDave();
    let opus: string | null = null;
    try {
        const codec = await createOpusCodec();
        opus = codec.library;
        codec.destroy();
    } catch {
        opus = null;
    }
    let ffmpeg: string | null = null;
    try {
        const proc = Bun.spawnSync(["ffmpeg", "-version"], {
            stdout: "pipe",
            stderr: "ignore",
        });
        if (proc.exitCode === 0)
            ffmpeg =
                new TextDecoder().decode(proc.stdout).split("\n")[0] ??
                "ffmpeg";
    } catch {
        ffmpeg = null;
    }
    return {
        dave: dave
            ? `@snazzah/davey (DAVE v${dave.DAVE_PROTOCOL_VERSION})`
            : null,
        opus,
        ffmpeg,
    };
}
