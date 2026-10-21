import { hasLibopus, Opus } from "./libopus.js";
import { FRAME_SAMPLES, VoiceError } from "./protocol.js";

/** One 48 kHz stereo Opus encoder and decoder. Call `destroy()` when done. */
export interface OpusCodec {
    /** The library behind it: `"libopus"` (the system's, through `bun:ffi`) or `"opusscript"` (WebAssembly). */
    readonly library: string;
    /** Encodes one 20 ms frame of s16le PCM (3,840 bytes). */
    encode(pcm: Uint8Array): Uint8Array;
    /** Decodes one Opus packet to s16le PCM. */
    decode(packet: Uint8Array): Uint8Array;
    destroy(): void;
}

/** Lunibee's own codec on the system libopus (`Opus`, through `bun:ffi`). */
const native = (): OpusCodec => {
    const codec = new Opus();
    return {
        library: "libopus",
        encode: (pcm) => codec.encode(pcm),
        decode: (packet) => codec.decode(packet),
        destroy: () => codec.destroy(),
    };
};

/** `opusscript`: libopus compiled to WebAssembly, for systems without libopus. */
const wasm = async (): Promise<OpusCodec> => {
    const name = "opusscript";
    const mod = (await import(name)) as unknown as {
        default: ScriptConstructor;
    };
    const OpusScript = mod.default;
    const codec = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
    let destroyed = false;
    return {
        library: "opusscript",
        encode: (pcm) => codec.encode(Buffer.from(pcm), FRAME_SAMPLES),
        decode: (packet) => codec.decode(Buffer.from(packet)),
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            codec.delete();
        },
    };
};
interface ScriptConstructor {
    new (
        rate: number,
        channels: number,
        application: number,
    ): {
        encode(pcm: Buffer, frameSize: number): Buffer;
        decode(packet: Buffer): Buffer;
        delete(): void;
    };
    Application: { AUDIO: number };
}

/**
 * Creates an Opus codec: Lunibee's `Opus` on the system's libopus when it is
 * installed (native speed, nothing to compile), otherwise `opusscript`, an
 * optional peer dependency. Playing Ogg/Opus files, or anything through
 * FFmpeg without `inlineVolume` or effects, needs neither.
 * @throws {VoiceError} If neither is available.
 */
export async function createOpusCodec(): Promise<OpusCodec> {
    if (hasLibopus()) return native();
    try {
        return await wasm();
    } catch {
        throw new VoiceError(
            "Encoding or decoding Opus needs an Opus library: install libopus (apt install libopus0, brew install opus) or opusscript.",
        );
    }
}
