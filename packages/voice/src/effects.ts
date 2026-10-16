import { PCM_FRAME_BYTES } from "./protocol.js";

const RATE = 48_000;
const CHANNELS = 2;

/**
 * A PCM effect: changes one 20 ms frame of 48 kHz stereo interleaved samples
 * in place. Effects keep state between frames, so use one instance per
 * resource.
 */
export interface AudioEffect {
    process(samples: Int16Array): void;
}

function check(name: string, value: number, min: number, max: number): void {
    if (!Number.isFinite(value) || value < min || value > max)
        throw new RangeError(`${name} must be between ${min} and ${max}.`);
}

const clip = (value: number): number =>
    value > 32767 ? 32767 : value < -32768 ? -32768 : Math.round(value);

/**
 * Shifts the pitch by `semitones` (-24 to 24) without changing the speed:
 * +12 is an octave up (a "chipmunk" voice), -7 a deeper one. A granular
 * delay-line shifter, so it adds about 40 ms of latency.
 */
export function pitchShift(semitones: number): AudioEffect {
    check("semitones", semitones, -24, 24);
    const ratio = 2 ** (semitones / 12);
    const window = 2048;
    const size = 4096;
    const buffers = [new Float32Array(size), new Float32Array(size)];
    let write = 0;
    let phase = 0;
    const step = (1 - ratio) / window;
    const tap = (buffer: Float32Array, delay: number): number => {
        const position = write - delay;
        const base = Math.floor(position);
        const frac = position - base;
        const a = buffer[base & (size - 1)]!;
        const b = buffer[(base + 1) & (size - 1)]!;
        return a + (b - a) * frac;
    };
    return {
        process(samples) {
            if (semitones === 0) return;
            for (let i = 0; i < samples.length; i += CHANNELS) {
                const p2 = (phase + 0.5) % 1;
                const g1 = 1 - Math.abs(2 * phase - 1);
                const g2 = 1 - g1;
                for (let c = 0; c < CHANNELS; c++) {
                    const buffer = buffers[c]!;
                    buffer[write & (size - 1)] = samples[i + c]!;
                    samples[i + c] = clip(
                        g1 * tap(buffer, 1 + phase * window) +
                            g2 * tap(buffer, 1 + p2 * window),
                    );
                }
                write = (write + 1) & 0x3fffffff;
                phase = (((phase + step) % 1) + 1) % 1;
            }
        },
    };
}

/** A robot voice: ring modulation with a `frequency` Hz carrier (1 to 2,000, default 50). */
export function robot(frequency = 50): AudioEffect {
    check("frequency", frequency, 1, 2_000);
    const increment = (2 * Math.PI * frequency) / RATE;
    let angle = 0;
    return {
        process(samples) {
            for (let i = 0; i < samples.length; i += CHANNELS) {
                const carrier = Math.sin(angle);
                for (let c = 0; c < CHANNELS; c++)
                    samples[i + c] = clip(samples[i + c]! * carrier);
                angle += increment;
                if (angle > 2 * Math.PI) angle -= 2 * Math.PI;
            }
        },
    };
}

/** Options for {@link echo}. */
export interface EchoOptions {
    /** Delay in ms (1 to 2,000). Default 250. */
    delay?: number;
    /** How much of each echo is fed back (0 to 0.95). Default 0.4. */
    feedback?: number;
    /** Echo level in the output (0 to 1). Default 0.5. */
    mix?: number;
}

/** An echo. Its buffer is fixed by `delay` (at most 2 s, 750 KB). */
export function echo(options: EchoOptions = {}): AudioEffect {
    const { delay = 250, feedback = 0.4, mix = 0.5 } = options;
    check("delay", delay, 1, 2_000);
    check("feedback", feedback, 0, 0.95);
    check("mix", mix, 0, 1);
    const buffer = new Float32Array(
        Math.round((delay * RATE) / 1000) * CHANNELS,
    );
    let index = 0;
    return {
        process(samples) {
            for (let i = 0; i < samples.length; i++) {
                const delayed = buffer[index]!;
                const input = samples[i]!;
                buffer[index] = input + delayed * feedback;
                samples[i] = clip(input + delayed * mix);
                if (++index === buffer.length) index = 0;
            }
        },
    };
}

/** Linear gain (0 to 16): 0.5 is half, 2 double (clipped). */
export function gain(factor: number): AudioEffect {
    check("factor", factor, 0, 16);
    return {
        process(samples) {
            if (factor === 1) return;
            for (let i = 0; i < samples.length; i++)
                samples[i] = clip(samples[i]! * factor);
        },
    };
}

/** @internal Runs `effects` over one s16le PCM frame; returns a new full frame (3,840 bytes). */
export function applyEffects(
    effects: readonly AudioEffect[],
    pcm: Uint8Array,
): Uint8Array {
    if (effects.length === 0) return pcm;
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    // Always one full 20 ms frame out, so the encoder gets what it expects.
    const samples = new Int16Array(PCM_FRAME_BYTES >> 1);
    const count = Math.min(pcm.byteLength, PCM_FRAME_BYTES) >> 1;
    for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true);
    for (const effect of effects) effect.process(samples);
    const out = new Uint8Array(samples.length * 2);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < samples.length; i++)
        outView.setInt16(i * 2, samples[i]!, true);
    return out;
}
