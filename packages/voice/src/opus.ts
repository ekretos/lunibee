import { FRAME_SAMPLES, VoiceError } from "./protocol.js";

/** One 48 kHz stereo Opus encoder and decoder. Call `destroy()` when done. */
export interface OpusCodec {
    /** The library behind it: `"@discordjs/opus"` (native) or `"opusscript"` (WebAssembly). */
    readonly library: string;
    /** Encodes one 20 ms frame of s16le PCM (3,840 bytes). */
    encode(pcm: Uint8Array): Uint8Array;
    /** Decodes one Opus packet to s16le PCM. */
    decode(packet: Uint8Array): Uint8Array;
    destroy(): void;
}

type CodecFactory = () => Promise<OpusCodec>;

/** Native `@discordjs/opus`: about 1.2x faster, but its prebuilt binary must match the runtime. */
const native: CodecFactory = async () => {
    // Not a declared dependency: a variable keeps type checking and bundlers from requiring it.
    const name = "@discordjs/opus";
    const mod = (await import(name)) as {
        default?: {
            OpusEncoder: new (rate: number, channels: number) => NativeEncoder;
        };
        OpusEncoder?: new (rate: number, channels: number) => NativeEncoder;
    };
    const Encoder = mod.OpusEncoder ?? mod.default!.OpusEncoder;
    const codec = new Encoder(48_000, 2);
    return {
        library: "@discordjs/opus",
        encode: (pcm) => codec.encode(Buffer.from(pcm)),
        decode: (packet) => codec.decode(Buffer.from(packet)),
        destroy: () => undefined,
    };
};
interface NativeEncoder {
    encode(pcm: Buffer): Buffer;
    decode(packet: Buffer): Buffer;
}

/** `opusscript`: libopus compiled to WebAssembly; works on every runtime. */
const wasm: CodecFactory = async () => {
    const mod = (await import("opusscript")) as unknown as {
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

let preferred: CodecFactory | undefined;

/**
 * Creates an Opus codec from the first library that loads: `@discordjs/opus`,
 * then `opusscript`. Both are optional peer dependencies; playing Ogg/Opus
 * files, or anything through FFmpeg without `inlineVolume`, needs neither.
 * @throws {VoiceError} If neither is installed.
 */
export async function createOpusCodec(): Promise<OpusCodec> {
    if (preferred) return preferred();
    for (const factory of [native, wasm])
        try {
            const codec = await factory();
            preferred = factory;
            return codec;
        } catch {
            // Not installed, or a native binary for another runtime.
        }
    throw new VoiceError(
        "Encoding or decoding Opus needs an Opus library: install opusscript (or @discordjs/opus).",
    );
}
