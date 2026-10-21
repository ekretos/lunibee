import { CString, dlopen, FFIType, ptr, type Pointer } from "bun:ffi";
import { FRAME_SAMPLES, PCM_FRAME_BYTES, VoiceError } from "./protocol.js";

/** `OPUS_APPLICATION_*`: what the encoder tunes for. */
export const OpusApplication = {
    /** Speech: best for voice chat. */
    Voip: 2048,
    /** Music and mixed content (the default). */
    Audio: 2049,
    /** Lowest delay; disables the speech modes. */
    RestrictedLowDelay: 2051,
} as const;
export type OpusApplication =
    (typeof OpusApplication)[keyof typeof OpusApplication];

const SYMBOLS = {
    opus_encoder_create: {
        args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr],
        returns: FFIType.ptr,
    },
    opus_encode: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
    },
    opus_encoder_destroy: { args: [FFIType.ptr], returns: FFIType.void },
    opus_decoder_create: {
        args: [FFIType.i32, FFIType.i32, FFIType.ptr],
        returns: FFIType.ptr,
    },
    opus_decode: {
        args: [
            FFIType.ptr,
            FFIType.ptr,
            FFIType.i32,
            FFIType.ptr,
            FFIType.i32,
            FFIType.i32,
        ],
        returns: FFIType.i32,
    },
    opus_decoder_destroy: { args: [FFIType.ptr], returns: FFIType.void },
    opus_strerror: { args: [FFIType.i32], returns: FFIType.ptr },
    opus_get_version_string: { args: [], returns: FFIType.ptr },
} as const;

type Library = ReturnType<typeof dlopen<typeof SYMBOLS>>["symbols"];

/**
 * Where libopus usually is, by platform. `LUNIBEE_OPUS_LIBRARY` is tried
 * first; `LUNIBEE_OPUS_LIBRARY=none` skips libopus (Lunibee then uses opusscript).
 */
function candidates(): string[] {
    const own = process.env.LUNIBEE_OPUS_LIBRARY;
    if (own === "none") return [];
    const byPlatform =
        process.platform === "darwin"
            ? [
                  "libopus.0.dylib",
                  "libopus.dylib",
                  "/opt/homebrew/lib/libopus.dylib",
                  "/usr/local/lib/libopus.dylib",
              ]
            : process.platform === "win32"
              ? ["opus.dll", "libopus-0.dll", "libopus.dll"]
              : ["libopus.so.0", "libopus.so"];
    return own ? [own, ...byPlatform] : byPlatform;
}

let loaded: { symbols: Library; path: string } | null | undefined;

/**
 * Opens the system's libopus through `bun:ffi` (once). `null` when it is not
 * installed: `apt install libopus0`, `brew install opus`, or point
 * `LUNIBEE_OPUS_LIBRARY` at the library file.
 */
export function loadLibopus(
    paths: readonly string[] = candidates(),
): { symbols: Library; path: string } | null {
    for (const path of paths)
        try {
            const library = dlopen(path, SYMBOLS);
            return { symbols: library.symbols, path };
        } catch {
            // Not here; try the next one.
        }
    return null;
}

/** Whether libopus can be loaded (looked up once). */
export function hasLibopus(): boolean {
    loaded ??= loadLibopus();
    return loaded !== null;
}

/** @internal Forget the lookup, so tests can change `LUNIBEE_OPUS_LIBRARY`. */
export function resetLibopus(): void {
    loaded = undefined;
}

function library(): { symbols: Library; path: string } {
    loaded ??= loadLibopus();
    if (!loaded)
        throw new VoiceError(
            "libopus is not installed (apt install libopus0, brew install opus), or set LUNIBEE_OPUS_LIBRARY to its path.",
        );
    return loaded;
}

/** The libopus version string, e.g. `"libopus 1.5.2"`, or `null` when it is not installed. */
export function libopusVersion(): string | null {
    loaded ??= loadLibopus();
    if (!loaded) return null;
    return new CString(loaded.symbols.opus_get_version_string()!).toString();
}

function check(code: number, what: string): number {
    if (code < 0)
        throw new VoiceError(
            `${what} failed: ${new CString(library().symbols.opus_strerror(code)!).toString()}`,
        );
    return code;
}

/** Largest Opus packet: 1275 bytes per frame (RFC 6716). */
const MAX_PACKET = 1275;

/**
 * Lunibee's Opus encoder and decoder for 48 kHz stereo, on the system's
 * libopus through `bun:ffi`: native speed with nothing to compile. Frees its
 * native state on `destroy()` (and, as a safety net, when it is collected).
 */
export class Opus {
    readonly #symbols: Library;
    #encoder: Pointer | null;
    #decoder: Pointer | null;
    readonly #packet = new Uint8Array(MAX_PACKET);
    readonly #pcm = new Int16Array(FRAME_SAMPLES * 2);
    static readonly #registry = new FinalizationRegistry<{
        symbols: Library;
        encoder: Pointer;
        decoder: Pointer;
    }>(({ symbols, encoder, decoder }) => {
        symbols.opus_encoder_destroy(encoder);
        symbols.opus_decoder_destroy(decoder);
    });

    /** @throws {VoiceError} When libopus is not installed or refuses the settings. */
    public constructor(application: OpusApplication = OpusApplication.Audio) {
        this.#symbols = library().symbols;
        const error = new Int32Array(1);
        this.#encoder = this.#symbols.opus_encoder_create(
            48_000,
            2,
            application,
            ptr(error),
        ) as Pointer | null;
        check(error[0]!, "Creating the Opus encoder");
        this.#decoder = this.#symbols.opus_decoder_create(
            48_000,
            2,
            ptr(error),
        ) as Pointer | null;
        if (error[0]! < 0) {
            this.#symbols.opus_encoder_destroy(this.#encoder!);
            check(error[0]!, "Creating the Opus decoder");
        }
        Opus.#registry.register(
            this,
            {
                symbols: this.#symbols,
                encoder: this.#encoder!,
                decoder: this.#decoder!,
            },
            this,
        );
    }

    /** Where libopus was loaded from. */
    public static get libraryPath(): string {
        return library().path;
    }

    /**
     * Encodes one 20 ms frame: 960 stereo samples of s16le PCM (3,840 bytes).
     * @returns The Opus packet (a new array).
     * @throws {VoiceError} After `destroy()`, for a frame of the wrong size, or when libopus fails.
     */
    public encode(pcm: Uint8Array): Uint8Array {
        if (!this.#encoder)
            throw new VoiceError("The Opus codec was destroyed.");
        if (pcm.byteLength !== PCM_FRAME_BYTES)
            throw new VoiceError(
                `Opus encodes one 20 ms frame of ${PCM_FRAME_BYTES} bytes, got ${pcm.byteLength}.`,
            );
        // libopus reads native-endian int16; copy into an aligned buffer.
        const samples = this.#pcm;
        const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        for (let i = 0; i < samples.length; i++)
            samples[i] = view.getInt16(i * 2, true);
        const length = check(
            this.#symbols.opus_encode(
                this.#encoder,
                ptr(samples),
                FRAME_SAMPLES,
                ptr(this.#packet),
                MAX_PACKET,
            ),
            "Opus encoding",
        );
        return this.#packet.slice(0, length);
    }

    /**
     * Decodes one Opus packet to s16le PCM (3,840 bytes for a 20 ms packet).
     * An empty packet stands for a lost one and is concealed.
     * @throws {VoiceError} After `destroy()`, or for a corrupt packet.
     */
    public decode(packet: Uint8Array): Uint8Array {
        if (!this.#decoder)
            throw new VoiceError("The Opus codec was destroyed.");
        // Up to 120 ms per packet (5,760 samples per channel); a lost packet
        // is concealed as one 20 ms frame.
        const frame = packet.byteLength ? 5760 : FRAME_SAMPLES;
        const out = new Int16Array(frame * 2);
        const samples = check(
            this.#symbols.opus_decode(
                this.#decoder,
                packet.byteLength ? ptr(packet) : null,
                packet.byteLength,
                ptr(out),
                frame,
                0,
            ),
            "Opus decoding",
        );
        const pcm = new Uint8Array(samples * 4);
        const view = new DataView(pcm.buffer);
        for (let i = 0; i < samples * 2; i++)
            view.setInt16(i * 2, out[i]!, true);
        return pcm;
    }

    /** Frees the native encoder and decoder. Safe to call twice. */
    public destroy(): void {
        if (!this.#encoder) return;
        Opus.#registry.unregister(this);
        this.#symbols.opus_encoder_destroy(this.#encoder);
        this.#symbols.opus_decoder_destroy(this.#decoder!);
        this.#encoder = null;
        this.#decoder = null;
    }
}
