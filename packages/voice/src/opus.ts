import { FRAME_SAMPLES, VoiceError } from "./protocol.js";

/** One 48 kHz stereo Opus encoder and decoder. Call `destroy()` when done. */
export interface OpusCodec {
    /** The library behind it: always `"opusscript"` (libopus compiled to WebAssembly). */
    readonly library: string;
    /** Encodes one 20 ms frame of s16le PCM (3,840 bytes). */
    encode(pcm: Uint8Array): Uint8Array;
    /** Decodes one Opus packet to s16le PCM. */
    decode(packet: Uint8Array): Uint8Array;
    destroy(): void;
}

/** `opusscript`: libopus compiled to WebAssembly; works on every runtime. */
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
 * Creates an Opus codec with `opusscript`, an optional peer dependency.
 * Playing Ogg/Opus files, or anything through FFmpeg without `inlineVolume`,
 * does not need it.
 * @throws {VoiceError} If `opusscript` is not installed.
 */
export async function createOpusCodec(): Promise<OpusCodec> {
    try {
        return await wasm();
    } catch {
        throw new VoiceError(
            "Encoding or decoding Opus needs an Opus library: install opusscript.",
        );
    }
}
