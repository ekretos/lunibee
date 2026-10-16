/** Voice gateway version this package speaks. */
export const VOICE_GATEWAY_VERSION = 8;

/** Voice gateway opcodes (v8, with the DAVE opcodes 21-31). */
export const VoiceOpcodes = {
    Identify: 0,
    SelectProtocol: 1,
    Ready: 2,
    Heartbeat: 3,
    SessionDescription: 4,
    Speaking: 5,
    HeartbeatAck: 6,
    Resume: 7,
    Hello: 8,
    Resumed: 9,
    ClientsConnect: 11,
    ClientDisconnect: 13,
    DavePrepareTransition: 21,
    DaveExecuteTransition: 22,
    DaveTransitionReady: 23,
    DavePrepareEpoch: 24,
    DaveMlsExternalSender: 25,
    DaveMlsKeyPackage: 26,
    DaveMlsProposals: 27,
    DaveMlsCommitWelcome: 28,
    DaveMlsAnnounceCommitTransition: 29,
    DaveMlsWelcome: 30,
    DaveMlsInvalidCommitWelcome: 31,
} as const;
export type VoiceOpcodes = (typeof VoiceOpcodes)[keyof typeof VoiceOpcodes];

/** Voice gateway close codes. */
export const VoiceCloseCodes = {
    UnknownOpcode: 4001,
    FailedToDecode: 4002,
    NotAuthenticated: 4003,
    AuthenticationFailed: 4004,
    AlreadyAuthenticated: 4005,
    SessionNoLongerValid: 4006,
    SessionTimeout: 4009,
    ServerNotFound: 4011,
    UnknownProtocol: 4012,
    Disconnected: 4014,
    VoiceServerCrashed: 4015,
    UnknownEncryptionMode: 4016,
    DaveProtocolRequired: 4017,
    BadRequest: 4020,
    RateLimited: 4021,
    CallTerminated: 4022,
} as const;
export type VoiceCloseCodes =
    (typeof VoiceCloseCodes)[keyof typeof VoiceCloseCodes];

/**
 * Whether a voice gateway close can be resumed (op 7). Codes below 4000
 * (network or server-side closes) and 4015 (voice server crashed) can; 4006
 * (session invalid), 4014 (removed from the channel) and every other 4xxx
 * cannot.
 */
export function canResumeVoice(code: number): boolean {
    return code < 4000 || code === VoiceCloseCodes.VoiceServerCrashed;
}

/** RTP payload type Discord uses for Opus. */
export const RTP_OPUS_PAYLOAD_TYPE = 0x78;

/** Opus frames are 20 ms of 48 kHz audio. */
export const FRAME_DURATION_MS = 20;
/** Samples per channel in one 20 ms frame at 48 kHz. */
export const FRAME_SAMPLES = 960;
/** Bytes of one 20 ms frame of 48 kHz stereo s16le PCM. */
export const PCM_FRAME_BYTES = FRAME_SAMPLES * 2 * 2;

/** The Opus frame Discord treats as silence. Five of them end a transmission. */
export const SILENCE_FRAME: Uint8Array = Uint8Array.of(0xf8, 0xff, 0xfe);

/** Speaking flags for op 5. */
export const SpeakingFlags = {
    Microphone: 1,
    Soundshare: 2,
    Priority: 4,
} as const;

/** Voice protocol errors. */
export class VoiceError extends Error {
    public constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "VoiceError";
    }
}
