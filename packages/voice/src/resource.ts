import { applyEffects, type AudioEffect } from "./effects.js";
import { demuxOggOpus } from "./ogg.js";
import { createOpusCodec, type OpusCodec } from "./opus.js";
import { PCM_FRAME_BYTES, VoiceError } from "./protocol.js";

/**
 * What an input holds:
 * - `"arbitrary"`: any format FFmpeg reads (needs `ffmpeg` on the PATH);
 * - `"ogg/opus"`: an Ogg/Opus file or stream, played without re-encoding;
 * - `"opus"`: one Opus packet (20 ms) per chunk;
 * - `"raw"`: 48 kHz stereo s16le PCM (needs an Opus library).
 */
export type StreamType = "arbitrary" | "ogg/opus" | "opus" | "raw";

/** What {@link createAudioResource} can play. A string is a file path, or an `http(s)` URL for FFmpeg. */
export type AudioInput =
    | string
    | Uint8Array
    | ReadableStream<Uint8Array>
    | AsyncIterable<Uint8Array>;

/** Options for {@link createAudioResource}. */
export interface AudioResourceOptions<T = unknown> {
    /** What the input holds. Default: from the file extension (`.ogg`/`.opus`/`.pcm`), otherwise `"arbitrary"`. */
    inputType?: StreamType;
    /** Allow `resource.volume.set()`. Decodes and re-encodes Opus input, so it costs CPU. Default false. */
    inlineVolume?: boolean;
    /** Anything you want to keep with the resource (a title, who queued it). */
    metadata?: T;
    /** FFmpeg executable. Default `"ffmpeg"`. */
    ffmpegPath?: string;
    /** Frames read ahead of playback. Default 10 (200 ms); 1 when `live`. */
    prefetch?: number;
    /**
     * PCM effects (`pitchShift`, `robot`, `echo`, `gain`, or your own), run in
     * order on every frame. Like `inlineVolume`, they decode and re-encode.
     * `resource.effects` can be changed while it plays.
     */
    effects?: AudioEffect[];
    /**
     * A live source (a user's voice from `receiver.subscribe()`): the player
     * waits for it without counting missed frames, and frames that pile up
     * beyond 100 ms are dropped to keep the delay low. Default false.
     */
    live?: boolean;
    /** @internal Creates the Opus codec in place of {@link createOpusCodec} (tests). */
    codecFactory?: () => Promise<OpusCodec>;
}

/** Most frames a live resource keeps queued before it drops the oldest (100 ms). */
const LIVE_BACKLOG = 5;

/** Inline volume of a resource created with `inlineVolume: true`. */
export class VolumeControl {
    /** Linear gain: 1 is unchanged, 0.5 half, 2 double (clipped). */
    public volume = 1;
    /** Sets a linear gain. @throws {RangeError} For a negative or non-finite value. */
    public set(volume: number): void {
        if (!Number.isFinite(volume) || volume < 0)
            throw new RangeError(
                "Volume must be a finite number of at least 0.",
            );
        this.volume = volume;
    }
    /** Sets a logarithmic gain in decibels (0 is unchanged). */
    public setDecibels(db: number): void {
        this.set(10 ** (db / 20));
    }
    /** Scales one s16le PCM frame in place. */
    public apply(pcm: Uint8Array): Uint8Array {
        if (this.volume === 1) return pcm;
        const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        for (let i = 0; i + 1 < pcm.length; i += 2) {
            const scaled = Math.round(view.getInt16(i, true) * this.volume);
            view.setInt16(i, Math.max(-32768, Math.min(32767, scaled)), true);
        }
        return pcm;
    }
}

async function* chunksOf(
    input: Exclude<AudioInput, string>,
): AsyncGenerator<Uint8Array> {
    if (input instanceof Uint8Array) {
        yield input;
        return;
    }
    if (input instanceof ReadableStream) {
        const reader = input.getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) return;
                yield value;
            }
        } finally {
            await reader.cancel().catch(() => undefined);
        }
    }
    yield* input as AsyncIterable<Uint8Array>;
}

/** Cuts a byte stream into whole 20 ms PCM frames; a short last frame is padded with silence. */
async function* pcmFrames(
    chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
    let pending = new Uint8Array(0);
    for await (const chunk of chunks) {
        const merged = new Uint8Array(pending.length + chunk.length);
        merged.set(pending, 0);
        merged.set(chunk, pending.length);
        let offset = 0;
        while (merged.length - offset >= PCM_FRAME_BYTES) {
            yield merged.slice(offset, offset + PCM_FRAME_BYTES);
            offset += PCM_FRAME_BYTES;
        }
        pending = merged.slice(offset);
    }
    if (pending.length > 0) {
        const last = new Uint8Array(PCM_FRAME_BYTES);
        last.set(pending, 0);
        yield last;
    }
}

function inferType(path: string): StreamType {
    const lower = path.toLowerCase();
    if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "ogg/opus";
    if (lower.endsWith(".pcm") || lower.endsWith(".raw")) return "raw";
    return "arbitrary";
}

/**
 * An audio source for an {@link AudioPlayer}: a queue of 20 ms Opus frames
 * filled ahead of playback. One resource plays once; create another to play
 * the same input again.
 */
export class AudioResource<T = unknown> {
    /** What was passed as `metadata`. */
    public readonly metadata: T;
    /** Inline volume, when created with `inlineVolume: true`. */
    public readonly volume?: VolumeControl;
    /** The effects in use, when created with `effects`. Changes apply from the next frame. */
    public readonly effects?: AudioEffect[];
    /** Whether it is a live source (`live: true`). */
    public readonly live: boolean;
    /** Milliseconds of this resource the player has sent. */
    public playbackDuration = 0;
    /** Whether the player took its first frame. */
    public started = false;
    readonly #frames: AsyncGenerator<Uint8Array>;
    readonly #queue: Uint8Array[] = [];
    readonly #prefetch: number;
    readonly #cleanup: (() => void)[] = [];
    #filling = false;
    #done = false;
    #error?: Error;

    /** @internal Use {@link createAudioResource}. */
    public constructor(
        frames: AsyncGenerator<Uint8Array>,
        options: {
            metadata?: T;
            volume?: VolumeControl;
            effects?: AudioEffect[];
            live?: boolean;
            prefetch?: number;
            cleanup?: () => void;
        },
    ) {
        this.#frames = frames;
        this.metadata = options.metadata as T;
        this.volume = options.volume;
        this.effects = options.effects;
        this.live = options.live ?? false;
        this.#prefetch = this.live
            ? Math.max(1, options.prefetch ?? 1)
            : Math.max(1, options.prefetch ?? 10);
        if (options.cleanup) this.#cleanup.push(options.cleanup);
        this.#fill();
    }

    /** Whether every frame has been read (or it failed, or was destroyed). */
    public get ended(): boolean {
        return this.#done && this.#queue.length === 0;
    }

    /** Why it ended early, if it failed. */
    public get error(): Error | undefined {
        return this.#error;
    }

    /** Whether a frame is ready now. */
    public get readable(): boolean {
        return this.#queue.length > 0;
    }

    #fill(): void {
        if (this.#filling || this.#done) return;
        this.#filling = true;
        void (async () => {
            try {
                while (
                    !this.#done &&
                    (this.live || this.#queue.length < this.#prefetch)
                ) {
                    const next = await this.#frames.next();
                    if (next.done) {
                        this.#finish();
                        break;
                    }
                    if (this.#done) break;
                    this.#queue.push(next.value);
                    // Live: keep up with the source; old frames would only add delay.
                    if (this.live && this.#queue.length > LIVE_BACKLOG)
                        this.#queue.shift();
                }
            } catch (error) {
                this.#error =
                    error instanceof Error
                        ? error
                        : new VoiceError(String(error));
                this.#finish();
            } finally {
                this.#filling = false;
            }
        })();
    }

    #finish(): void {
        if (this.#done) return;
        this.#done = true;
        for (const cleanup of this.#cleanup.splice(0))
            try {
                cleanup();
            } catch {
                // Cleanup is best effort.
            }
    }

    /**
     * Takes the next Opus frame. @returns A frame, `undefined` when none is
     * ready yet (buffering), or `null` when the resource has ended.
     */
    public read(): Uint8Array | null | undefined {
        const frame = this.#queue.shift();
        if (frame) {
            this.started = true;
            this.#fill();
            return frame;
        }
        if (this.#done) return null;
        this.#fill();
        return undefined;
    }

    /** Stops reading: ends FFmpeg and the input, frees the codec. Safe to call twice. */
    public destroy(): void {
        this.#queue.length = 0;
        this.#finish();
        void this.#frames.return(undefined).catch(() => undefined);
    }
}

function spawnFFmpeg(
    input: AudioInput,
    path: string,
    output: "ogg/opus" | "raw",
): {
    stdout: ReadableStream<Uint8Array>;
    kill: () => void;
    /** Resolves when FFmpeg exited cleanly (or was killed); rejects with its error output otherwise. */
    exited: () => Promise<void>;
} {
    const fromURL = typeof input === "string" && /^https?:\/\//i.test(input);
    const args = [
        path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-analyzeduration",
        "0",
        // A URL is read by FFmpeg itself; everything else arrives on stdin, so
        // a file name is never parsed as an FFmpeg option or protocol.
        "-i",
        fromURL ? (input as string) : "pipe:0",
        "-vn",
        "-ar",
        "48000",
        "-ac",
        "2",
        ...(output === "raw"
            ? ["-f", "s16le"]
            : [
                  "-c:a",
                  "libopus",
                  "-b:a",
                  "128k",
                  "-frame_duration",
                  "20",
                  "-f",
                  "opus",
              ]),
        "pipe:1",
    ];
    const proc = Bun.spawn(args, {
        stdin: fromURL ? "ignore" : "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    let killed = false;
    // The last 1,000 characters of FFmpeg's error output, for the error message.
    const stderr = (async () => {
        let tail = "";
        const decoder = new TextDecoder();
        try {
            for await (const chunk of proc.stderr as ReadableStream<Uint8Array>)
                tail = (tail + decoder.decode(chunk, { stream: true })).slice(
                    -1000,
                );
        } catch {
            // Killed.
        }
        return tail.trim();
    })();
    if (!fromURL) {
        const sink = proc.stdin as unknown as {
            write(chunk: Uint8Array): unknown;
            end(): unknown;
        };
        const source =
            typeof input === "string"
                ? chunksOf(Bun.file(input).stream())
                : chunksOf(input);
        void (async () => {
            try {
                for await (const chunk of source) await sink.write(chunk);
            } catch {
                // FFmpeg exited (or was killed) before reading everything.
            } finally {
                try {
                    await sink.end();
                } catch {
                    // Already closed.
                }
            }
        })();
    }
    return {
        stdout: proc.stdout as ReadableStream<Uint8Array>,
        kill: () => {
            killed = true;
            try {
                proc.kill();
            } catch {
                // Already exited.
            }
        },
        exited: async () => {
            const code = await proc.exited;
            if (code === 0 || killed) return;
            const output = await stderr;
            throw new VoiceError(
                `FFmpeg exited with code ${code}${output ? `: ${output}` : "."}`,
            );
        },
    };
}

/**
 * Creates an {@link AudioResource} from a file path, a URL (FFmpeg), bytes, a
 * `ReadableStream` or an async iterable.
 *
 * Ogg/Opus input is played as it is (passthrough). PCM input, and anything
 * with `inlineVolume`, is encoded with an Opus library (`opusscript` or
 * `@discordjs/opus`). Other formats go through FFmpeg, which is killed when
 * the resource ends or is destroyed.
 */
export function createAudioResource<T = unknown>(
    input: AudioInput,
    options: AudioResourceOptions<T> = {},
): AudioResource<T> {
    let type =
        options.inputType ??
        (typeof input === "string" ? inferType(input) : "arbitrary");
    const volume = options.inlineVolume ? new VolumeControl() : undefined;
    const effects = options.effects ? [...options.effects] : undefined;
    const pcmOut = Boolean(volume || effects);
    const transform = (pcm: Uint8Array): Uint8Array => {
        const out = effects ? applyEffects(effects, pcm) : pcm;
        return volume ? volume.apply(out) : out;
    };
    const cleanups: (() => void)[] = [];
    let chunks: AsyncIterable<Uint8Array>;

    if (type === "arbitrary") {
        const ffmpeg = spawnFFmpeg(
            input,
            options.ffmpegPath ?? "ffmpeg",
            pcmOut ? "raw" : "ogg/opus",
        );
        cleanups.push(ffmpeg.kill);
        // An FFmpeg failure (bad input, unreachable URL) ends its output early:
        // report it as the resource's error, not as a normal end.
        chunks = (async function* () {
            yield* chunksOf(ffmpeg.stdout);
            await ffmpeg.exited();
        })();
        type = pcmOut ? "raw" : "ogg/opus";
    } else if (typeof input === "string") {
        if (/^https?:\/\//i.test(input))
            throw new VoiceError(`A URL needs inputType "arbitrary" (FFmpeg).`);
        chunks = chunksOf(Bun.file(input).stream());
    } else chunks = chunksOf(input);

    // The codec loads with the first frame that needs it, so this stays synchronous.
    let codec: OpusCodec | undefined;
    let destroyed = false;
    /** @returns The codec, or `undefined` once the resource is destroyed (nothing may be encoded then). */
    const getCodec = async (): Promise<OpusCodec | undefined> => {
        if (!codec) {
            const created = await (options.codecFactory ?? createOpusCodec)();
            // Destroyed while the library loaded: cleanup already ran, so free it here.
            if (destroyed) {
                created.destroy();
                return undefined;
            }
            codec = created;
            cleanups.push(() => created.destroy());
        }
        return destroyed ? undefined : codec;
    };

    let frames: AsyncGenerator<Uint8Array>;
    if (type === "raw") {
        const source = pcmFrames(chunks);
        frames = (async function* () {
            for await (const pcm of source) {
                const c = await getCodec();
                if (!c) return;
                yield c.encode(transform(pcm));
            }
        })();
    } else {
        const packets = type === "ogg/opus" ? demuxOggOpus(chunks) : chunks;
        frames = pcmOut
            ? (async function* () {
                  for await (const packet of packets) {
                      const c = await getCodec();
                      if (!c) return;
                      yield c.encode(transform(c.decode(packet)));
                  }
              })()
            : (async function* () {
                  yield* packets;
              })();
    }
    return new AudioResource<T>(frames, {
        metadata: options.metadata,
        volume,
        effects,
        live: options.live,
        prefetch: options.prefetch,
        cleanup: () => {
            destroyed = true;
            for (const cleanup of cleanups) cleanup();
        },
    });
}
