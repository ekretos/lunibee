import { afterEach, describe, expect, test } from "bun:test";
import { applyEffects } from "../packages/voice/src/effects.ts";
import {
    AudioPlayer,
    AudioResource,
    OggOpusWriter,
    PCM_FRAME_BYTES,
    SILENCE_FRAME,
    VoiceError,
    VoiceReceiver,
    createAudioResource,
    createOpusCodec,
    demuxOggOpus,
    echo,
    gain,
    pitchShift,
    robot,
    type AudioSink,
} from "../packages/voice/src/index.ts";

const OGG = new URL("./fixtures/audio/tone-1s.ogg", import.meta.url).pathname;
const HAS_FFMPEG =
    Bun.spawnSync(["ffmpeg", "-version"], {
        stdout: "ignore",
        stderr: "ignore",
    }).exitCode === 0;

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
});

async function until<T>(
    check: () => T | undefined | false,
    ms = 3000,
): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() > end) throw new Error("until() timed out");
        await Bun.sleep(5);
    }
}

/** `frames` 20 ms frames of a stereo sine, as samples. */
function sine(frequency: number, frames: number, amplitude = 8000): Int16Array {
    const out = new Int16Array(frames * 1920);
    for (let i = 0; i < frames * 960; i++) {
        const v = Math.round(
            Math.sin((2 * Math.PI * frequency * i) / 48_000) * amplitude,
        );
        out[i * 2] = v;
        out[i * 2 + 1] = v;
    }
    return out;
}

/** Energy of the left channel at `frequency` (Goertzel). */
function energy(samples: Int16Array, frequency: number): number {
    const k = (2 * Math.PI * frequency) / 48_000;
    const coeff = 2 * Math.cos(k);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < samples.length; i += 2) {
        const s0 = samples[i]! + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

/** Runs an effect frame by frame over `input` and returns the last `tail` frames. */
function run(
    effect: { process(s: Int16Array): void },
    input: Int16Array,
    tail: number,
): Int16Array {
    for (let i = 0; i < input.length; i += 1920)
        effect.process(input.subarray(i, i + 1920));
    return input.subarray(input.length - tail * 1920);
}

function toPcm(samples: Int16Array): Uint8Array {
    const pcm = new Uint8Array(samples.length * 2);
    const view = new DataView(pcm.buffer);
    samples.forEach((v, i) => view.setInt16(i * 2, v, true));
    return pcm;
}

describe("effects", () => {
    test("pitchShift moves a tone by octaves and leaves 0 alone", () => {
        const up = run(pitchShift(12), sine(440, 60), 20);
        expect(energy(up, 880)).toBeGreaterThan(energy(up, 440) * 10);
        const down = run(pitchShift(-12), sine(440, 60), 20);
        expect(energy(down, 220)).toBeGreaterThan(energy(down, 440) * 10);
        const same = sine(440, 2);
        const copy = same.slice();
        pitchShift(0).process(same);
        expect(same).toEqual(copy);
    });

    test("robot ring-modulates; echo repeats after its delay; gain scales and clips", () => {
        const ringed = run(robot(100), sine(1000, 10), 5);
        expect(energy(ringed, 900)).toBeGreaterThan(energy(ringed, 1000) * 10);
        expect(energy(ringed, 1100)).toBeGreaterThan(energy(ringed, 1000) * 10);

        const impulse = new Int16Array(1920 * 3);
        impulse[0] = 10_000;
        const e = echo({ delay: 10, feedback: 0.5, mix: 0.5 });
        run(e, impulse, 3);
        const delay = 480 * 2; // 10 ms of stereo samples
        expect(impulse[0]).toBe(10_000);
        expect(impulse[delay]).toBe(5_000);
        expect(impulse[delay * 2]).toBe(2_500); // fed back once
        expect(impulse[1]).toBe(0);

        const loud = Int16Array.of(1000, -1000, 30_000, -30_000);
        gain(2).process(loud);
        expect([...loud]).toEqual([2000, -2000, 32767, -32768]);
        const unity = Int16Array.of(7);
        gain(1).process(unity);
        expect(unity[0]).toBe(7);
    });

    test("parameters are checked", () => {
        expect(() => pitchShift(25)).toThrow(RangeError);
        expect(() => pitchShift(Number.NaN)).toThrow(RangeError);
        expect(() => robot(0)).toThrow(RangeError);
        expect(() => echo({ delay: 0 })).toThrow(RangeError);
        expect(() => echo({ feedback: 1 })).toThrow(RangeError);
        expect(() => echo({ mix: 2 })).toThrow(RangeError);
        expect(() => gain(-1)).toThrow(RangeError);
        expect(echo()).toBeDefined();
        expect(robot()).toBeDefined();
    });

    test("applyEffects returns a full 20 ms frame and runs effects in order", () => {
        const pcm = toPcm(Int16Array.of(100, 200));
        expect(applyEffects([], pcm)).toBe(pcm);
        const out = applyEffects([gain(2), gain(3)], pcm);
        expect(out.length).toBe(PCM_FRAME_BYTES);
        const view = new DataView(out.buffer);
        expect(view.getInt16(0, true)).toBe(600);
        expect(view.getInt16(2, true)).toBe(1200);
        expect(view.getInt16(4, true)).toBe(0);
    });
});

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
    yield bytes;
}

async function collect(
    chunks: AsyncIterable<Uint8Array>,
): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    for await (const chunk of chunks) out.push(chunk);
    return out;
}

function join(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

describe("OggOpusWriter", () => {
    test("writes packets that demux back unchanged, splitting pages at 255 segments", async () => {
        const writer = new OggOpusWriter(1234);
        const packets = Array.from({ length: 120 }, (_, i) =>
            new Uint8Array(i % 3 === 0 ? 1000 : 3 + i).fill(i),
        );
        const parts = [writer.header()];
        expect(writer.flush().length).toBe(0);
        for (const packet of packets) parts.push(writer.write(packet));
        parts.push(writer.flush(), writer.end());
        expect(writer.end().length).toBe(0);
        expect(() => writer.write(SILENCE_FRAME)).toThrow(VoiceError);
        const bytes = join(parts);
        const back = await collect(demuxOggOpus(once(bytes)));
        expect(back).toEqual(packets);
        // The last page carries the end-of-stream flag.
        let lastPage = -1;
        for (let k = 0; k + 4 <= bytes.length; k++)
            if (String.fromCharCode(...bytes.subarray(k, k + 4)) === "OggS")
                lastPage = k;
        expect(bytes[lastPage + 5]! & 0x04).toBe(0x04);
        expect(() =>
            new OggOpusWriter().write(new Uint8Array(255 * 255)),
        ).toThrow(VoiceError);
    });

    test.skipIf(!HAS_FFMPEG)(
        "FFmpeg decodes what it writes (CRC and granules)",
        async () => {
            const codec = await createOpusCodec();
            cleanup.push(() => codec.destroy());
            const writer = new OggOpusWriter();
            const parts = [writer.header()];
            const tone = sine(440, 100);
            for (let i = 0; i < 100; i++)
                parts.push(
                    writer.write(
                        codec.encode(
                            toPcm(tone.subarray(i * 1920, (i + 1) * 1920)),
                        ),
                    ),
                );
            parts.push(writer.end());
            const path = `${process.env.TMPDIR ?? "/tmp"}/lunibee-ogg-${process.pid}.ogg`;
            await Bun.write(path, join(parts));
            cleanup.push(() => Bun.file(path).delete());
            const probe = Bun.spawnSync([
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                path,
            ]);
            expect(probe.exitCode).toBe(0);
            expect(Number(probe.stdout.toString())).toBeCloseTo(2, 1);
            const decode = Bun.spawnSync([
                "ffmpeg",
                "-v",
                "error",
                "-i",
                path,
                "-f",
                "null",
                "-",
            ]);
            expect(decode.exitCode).toBe(0);
            expect(decode.stderr.toString()).toBe("");
        },
    );
});

describe("receiver.record()", () => {
    test("records Ogg/Opus, keeps silence as silence frames, ends on unsubscribe", async () => {
        const receiver = new VoiceReceiver();
        const stream = receiver.record("u1");
        const reading = new Response(stream).bytes();
        receiver.push("u1", Uint8Array.of(0xfc, 1));
        await Bun.sleep(200);
        receiver.push("u1", Uint8Array.of(0xfc, 2));
        receiver.push("u2", Uint8Array.of(0xfc, 9)); // not recorded
        expect(receiver.unsubscribe("u1")).toBe(true);
        const packets = await collect(demuxOggOpus(once(await reading)));
        const silence = packets.filter(
            (p) => p.join() === [...SILENCE_FRAME].join(),
        ).length;
        // The ~0 ms before the first frame is jitter; the 200 ms gap is ~9 silence frames.
        expect(packets[0]).toEqual(Uint8Array.of(0xfc, 1));
        expect(packets.at(-1)).toEqual(Uint8Array.of(0xfc, 2));
        expect(silence).toBeGreaterThanOrEqual(7);
        expect(silence).toBeLessThanOrEqual(12);
    });

    test("ends after silence when asked, drops audio for a stalled reader, and cancel releases it", async () => {
        const receiver = new VoiceReceiver();
        const timed = receiver.record("u1", {
            end: { behavior: "silence", duration: 50 },
        });
        receiver.push("u1", Uint8Array.of(0xfc, 1));
        const bytes = await new Response(timed).bytes();
        expect(await collect(demuxOggOpus(once(bytes)))).toEqual([
            Uint8Array.of(0xfc, 1),
        ]);

        const stalled = receiver.record("u2", { highWaterMark: 1 });
        for (let i = 0; i < 100; i++)
            receiver.push("u2", new Uint8Array(200).fill(i));
        receiver.unsubscribe("u2");
        const got = await collect(
            demuxOggOpus(once(await new Response(stalled).bytes())),
        );
        expect(got.length).toBeLessThan(100);

        const cancelled = receiver.record("u3");
        await cancelled.cancel();
        expect(receiver.unsubscribe("u3")).toBe(false);
        receiver.close();
    });
});

function sink() {
    const frames: Uint8Array[] = [];
    const s: AudioSink & { ready: boolean } = {
        ready: true,
        sendFrame: (frame) => {
            frames.push(frame);
            return true;
        },
        setSpeaking: () => undefined,
    };
    return { s, frames };
}

describe("effects on resources and live sources", () => {
    test("an Ogg file plays through effects (decoded and re-encoded); effects can change while playing", async () => {
        const resource = createAudioResource(OGG, { effects: [pitchShift(7)] });
        cleanup.push(() => resource.destroy());
        expect(resource.effects).toHaveLength(1);
        resource.effects!.push(gain(0.5));
        let count = 0;
        const end = Date.now() + 5000;
        for (;;) {
            const frame = resource.read();
            if (frame === null) break;
            if (frame) count++;
            else await Bun.sleep(1);
            if (Date.now() > end) throw new Error("timed out");
        }
        const passthrough = await collect(demuxOggOpus(Bun.file(OGG).stream()));
        expect(count).toBe(passthrough.length); // one frame out per frame in
        expect(resource.error).toBeUndefined();
    });

    test.skipIf(!HAS_FFMPEG)(
        "FFmpeg input with effects goes through PCM",
        async () => {
            const resource = createAudioResource(OGG, {
                inputType: "arbitrary",
                effects: [robot()],
            });
            cleanup.push(() => resource.destroy());
            let count = 0;
            const end = Date.now() + 8000;
            for (;;) {
                const frame = resource.read();
                if (frame === null) break;
                if (frame) count++;
                else await Bun.sleep(1);
                if (Date.now() > end) throw new Error("timed out");
            }
            expect(count).toBeGreaterThanOrEqual(49);
        },
    );

    test("live voice changer: a user's voice through pitchShift, and the player waits through their silence", async () => {
        const codec = await createOpusCodec();
        cleanup.push(() => codec.destroy());
        const receiver = new VoiceReceiver();
        cleanup.push(() => receiver.close());
        const resource = createAudioResource(
            receiver.subscribe("u1", { end: { behavior: "manual" } }),
            { inputType: "opus", effects: [pitchShift(5)], live: true },
        );
        expect(resource.live).toBe(true);
        const player = new AudioPlayer({ maxMissedFrames: 2 });
        const errors: unknown[] = [];
        player.on("error", (e) => errors.push(e));
        const { s, frames } = sink();
        player.attach(s);
        player.play(resource);
        cleanup.push(() => player.stop(true));
        // Nobody talks for longer than maxMissedFrames: not a failure.
        await Bun.sleep(120);
        expect(player.state).toBe("buffering");
        const tone = sine(440, 10);
        for (let i = 0; i < 10; i++) {
            receiver.push(
                "u1",
                codec.encode(toPcm(tone.subarray(i * 1920, (i + 1) * 1920))),
            );
            await Bun.sleep(20);
        }
        await until(() => frames.length >= 5);
        await Bun.sleep(150); // silent again
        expect(player.state).toBe("playing");
        expect(errors).toEqual([]);
        // What was sent is Opus that decodes to a full frame.
        expect(codec.decode(frames[0]!).length).toBe(PCM_FRAME_BYTES);
    });

    test("a live source drops frames that pile up beyond 100 ms", async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const resource = new AudioResource(
            (async function* () {
                for (let i = 0; i < 20; i++) yield Uint8Array.of(0xfc, i);
                await gate;
            })(),
            { live: true },
        );
        cleanup.push(() => {
            release();
            resource.destroy();
        });
        await Bun.sleep(30);
        const got: number[] = [];
        for (let frame = resource.read(); frame; frame = resource.read())
            got.push(frame[1]!);
        expect(got).toEqual([15, 16, 17, 18, 19]);
    });
});
