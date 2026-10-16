import { afterEach, describe, expect, test } from "bun:test";
import {
    AudioPlayer,
    AudioResource,
    PCM_FRAME_BYTES,
    SILENCE_FRAME,
    VoiceError,
    VoiceReceiver,
    VolumeControl,
    createAudioResource,
    createOpusCodec,
    demuxOggOpus,
    entersState,
    generateDependencyReport,
    type AudioSink,
} from "../packages/voice/src/index.ts";

const OGG = new URL("./fixtures/audio/tone-1s.ogg", import.meta.url).pathname;
const WAV = new URL("./fixtures/audio/tone-0.5s.wav", import.meta.url).pathname;
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

async function drain(
    resource: AudioResource,
    ms = 5000,
): Promise<Uint8Array[]> {
    const frames: Uint8Array[] = [];
    const end = Date.now() + ms;
    for (;;) {
        const frame = resource.read();
        if (frame === null) return frames;
        if (frame) frames.push(frame);
        else await Bun.sleep(1);
        if (Date.now() > end) throw new Error("drain timed out");
    }
}

/** A 20 ms stereo s16le frame of a sine wave. */
function sinePcm(frequency: number, frame = 0): Uint8Array {
    const pcm = new Uint8Array(PCM_FRAME_BYTES);
    const view = new DataView(pcm.buffer);
    for (let i = 0; i < 960; i++) {
        const t = (frame * 960 + i) / 48_000;
        const v = Math.round(Math.sin(2 * Math.PI * frequency * t) * 8000);
        view.setInt16(i * 4, v, true);
        view.setInt16(i * 4 + 2, v, true);
    }
    return pcm;
}

function rms(pcm: Uint8Array): number {
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    let sum = 0;
    for (let i = 0; i + 1 < pcm.length; i += 2)
        sum += view.getInt16(i, true) ** 2;
    return Math.sqrt(sum / (pcm.length / 2));
}

describe("Opus (Step 5)", () => {
    test("encode → decode round-trip keeps a sine wave within tolerance", async () => {
        const codec = await createOpusCodec();
        cleanup.push(() => codec.destroy());
        // The first frames carry the encoder's look-ahead; compare a later one.
        let decoded: Uint8Array = new Uint8Array(0);
        for (let i = 0; i < 6; i++)
            decoded = codec.decode(codec.encode(sinePcm(440, i)));
        const original = sinePcm(440, 5);
        expect(decoded.length).toBe(PCM_FRAME_BYTES);
        // Same energy within 15%, and strongly correlated with the original (lag-tolerant check).
        expect(
            Math.abs(rms(decoded) - rms(original)) / rms(original),
        ).toBeLessThan(0.15);
        const a = new DataView(original.buffer);
        const b = new DataView(decoded.buffer, decoded.byteOffset);
        let best = 0;
        for (let lag = 0; lag < 400; lag++) {
            let dot = 0,
                na = 0,
                nb = 0;
            for (let i = 0; i < 960 - lag; i++) {
                const x = a.getInt16(i * 4, true);
                const y = b.getInt16((i + lag) * 4, true);
                dot += x * y;
                na += x * x;
                nb += y * y;
            }
            best = Math.max(best, dot / Math.sqrt(na * nb));
        }
        expect(best).toBeGreaterThan(0.95);
        codec.destroy();
        codec.destroy();
    });

    test("the dependency report names what this runtime can load", async () => {
        const report = await generateDependencyReport();
        expect(report.dave).toMatch(/davey/);
        expect(report.opus).toBe("opusscript");
        expect(
            report.ffmpeg === null || report.ffmpeg.startsWith("ffmpeg"),
        ).toBe(true);
    });
});

describe("Ogg/Opus demuxing", () => {
    test("a real Ogg/Opus file yields 50 packets per second, headers skipped", async () => {
        const packets: Uint8Array[] = [];
        for await (const packet of demuxOggOpus(
            Bun.file(OGG).stream() as never,
        ))
            packets.push(packet);
        expect(packets.length).toBeGreaterThanOrEqual(50);
        expect(packets.length).toBeLessThanOrEqual(52);
        // Opus TOC: config 16-19 (CELT FB 20 ms) for libopus at 64 kb/s, stereo bit set.
        expect(packets.every((p) => p.length > 0 && p.length < 1500)).toBe(
            true,
        );
        const codec = await createOpusCodec();
        cleanup.push(() => codec.destroy());
        expect(codec.decode(packets[10]!).length).toBe(PCM_FRAME_BYTES);
    });

    test("byte-at-a-time input demuxes the same packets", async () => {
        const bytes = new Uint8Array(await Bun.file(OGG).arrayBuffer());
        async function* oneByOne() {
            for (let i = 0; i < bytes.length; i += 7)
                yield bytes.subarray(i, i + 7);
        }
        const whole: number[] = [];
        for await (const p of demuxOggOpus(
            (async function* () {
                yield bytes;
            })(),
        ))
            whole.push(p.length);
        const split: number[] = [];
        for await (const p of demuxOggOpus(oneByOne())) split.push(p.length);
        expect(split).toEqual(whole);
    });

    test("rejects what is not Ogg/Opus", async () => {
        const consume = async (chunks: Uint8Array[]) => {
            for await (const _ of demuxOggOpus(
                (async function* () {
                    yield* chunks;
                })(),
            ))
                void _;
        };
        await expect(consume([new Uint8Array(70_000)])).rejects.toThrow(
            VoiceError,
        );
        // An Ogg page whose first packet is not OpusHead.
        const page = new Uint8Array(27 + 1 + 4);
        page.set([0x4f, 0x67, 0x67, 0x53], 0);
        page[26] = 1;
        page[27] = 4;
        page.set([1, 2, 3, 4], 28);
        await expect(consume([page])).rejects.toThrow(/Opus/);
    });
});

describe("audio resources (Step 6)", () => {
    test("an Ogg/Opus file plays without an Opus library (passthrough)", async () => {
        const resource = createAudioResource(OGG, {
            metadata: { title: "tone" },
        });
        const frames = await drain(resource);
        expect(frames.length).toBeGreaterThanOrEqual(50);
        expect(resource.metadata.title).toBe("tone");
        expect(resource.ended).toBe(true);
        expect(resource.read()).toBeNull();
    });

    test("bytes, ReadableStreams and async iterables are accepted", async () => {
        const bytes = new Uint8Array(await Bun.file(OGG).arrayBuffer());
        const a = await drain(
            createAudioResource(bytes, { inputType: "ogg/opus" }),
        );
        const b = await drain(
            createAudioResource(new Blob([bytes]).stream(), {
                inputType: "ogg/opus",
            }),
        );
        const c = await drain(
            createAudioResource(
                (async function* () {
                    yield Uint8Array.of(1, 2);
                    yield Uint8Array.of(3);
                })(),
                { inputType: "opus" },
            ),
        );
        expect(a.length).toBe(b.length);
        expect(c.map((f) => [...f])).toEqual([[1, 2], [3]]);
    });

    test("PCM is cut into 20 ms frames and encoded; a short tail is padded", async () => {
        const pcm = new Uint8Array(PCM_FRAME_BYTES * 2 + 100);
        pcm.set(sinePcm(220, 0), 0);
        const frames = await drain(
            createAudioResource(pcm, { inputType: "raw" }),
        );
        expect(frames.length).toBe(3);
    });

    test("inline volume scales the audio", async () => {
        const control = new VolumeControl();
        const frame = sinePcm(440);
        const loud = rms(frame);
        control.set(0.5);
        expect(rms(control.apply(Uint8Array.from(frame)))).toBeCloseTo(
            loud / 2,
            -1,
        );
        control.setDecibels(0);
        expect(control.volume).toBe(1);
        control.set(10);
        const clipped = new DataView(
            control.apply(Uint8Array.from(frame)).buffer,
        );
        expect(
            Math.max(
                ...Array.from({ length: 960 }, (_, i) =>
                    Math.abs(clipped.getInt16(i * 4, true)),
                ),
            ),
        ).toBeLessThanOrEqual(32768);
        expect(() => control.set(-1)).toThrow(RangeError);
        const resource = createAudioResource(OGG, { inlineVolume: true });
        expect(resource.volume).toBeInstanceOf(VolumeControl);
        resource.volume!.set(0.25);
        expect((await drain(resource)).length).toBeGreaterThanOrEqual(50);
    });

    test("a URL needs FFmpeg", () => {
        expect(() =>
            createAudioResource("https://example.com/a.ogg", {
                inputType: "ogg/opus",
            }),
        ).toThrow(VoiceError);
    });

    test.skipIf(!HAS_FFMPEG)(
        "FFmpeg decodes other formats, and is killed when the resource is destroyed",
        async () => {
            const frames = await drain(createAudioResource(WAV));
            expect(frames.length).toBeGreaterThanOrEqual(24);
            expect(frames.length).toBeLessThanOrEqual(27);

            const pcm = await drain(
                createAudioResource(WAV, { inlineVolume: true }),
            );
            expect(pcm.length).toBeGreaterThanOrEqual(24);

            // A never-ending input: FFmpeg must exit once the resource is destroyed.
            const forever = new ReadableStream<Uint8Array>({
                pull: (c) => c.enqueue(new Uint8Array(4096)),
            });
            const resource = createAudioResource(forever, {
                inputType: "arbitrary",
            });
            await Bun.sleep(100);
            const before = Bun.spawnSync(["pgrep", "-c", "-x", "ffmpeg"])
                .stdout.toString()
                .trim();
            resource.destroy();
            await until(
                () =>
                    Bun.spawnSync(["pgrep", "-c", "-x", "ffmpeg"])
                        .stdout.toString()
                        .trim() === "0" || before === "0",
            );
            expect(resource.ended).toBe(true);
        },
    );

    test("a resource plays once", async () => {
        const player = new AudioPlayer();
        const resource = createAudioResource(
            (async function* () {
                yield Uint8Array.of(1);
            })(),
            { inputType: "opus" },
        );
        await drain(resource);
        expect(() => player.play(resource)).toThrow(VoiceError);
    });
});

/** A sink that records frames with their time. */
function sink(ready = true) {
    const frames: { frame: number[]; at: number }[] = [];
    const speaking: boolean[] = [];
    const s: AudioSink & { ready: boolean } = {
        ready,
        sendFrame: (frame) => {
            frames.push({ frame: [...frame], at: performance.now() });
            return true;
        },
        setSpeaking: (on) => void speaking.push(on),
    };
    return { s, frames, speaking };
}

function counted(n: number): AudioResource {
    return new AudioResource(
        (async function* () {
            for (let i = 0; i < n; i++) yield Uint8Array.of(0xfc, i);
        })(),
        {},
    );
}

const silent = (f: { frame: number[] }) =>
    f.frame.join() === [...SILENCE_FRAME].join();

describe("the player (Step 6)", () => {
    test("plays every frame at 20 ms with drift correction, then five silence frames, then stops ticking", async () => {
        const player = new AudioPlayer();
        const { s, frames, speaking } = sink();
        player.attach(s);
        const states: string[] = [];
        const finished: AudioResource[] = [];
        player.on("stateChange", (_from, to) => states.push(to));
        player.on("finish", (r) => finished.push(r));
        const resource = counted(50);
        player.play(resource);
        await until(() => player.state === "idle" && !player.ticking, 4000);
        const audio = frames.filter((f) => !silent(f));
        expect(audio.map((f) => f.frame[1])).toEqual(
            Array.from({ length: 50 }, (_, i) => i),
        );
        expect(frames.slice(-5).every(silent)).toBe(true);
        expect(frames.length).toBe(55);
        // 50 frames take ~1 s; the clock corrects drift instead of accumulating it.
        const span = audio.at(-1)!.at - audio[0]!.at;
        expect(span).toBeGreaterThan(49 * 20 - 60);
        expect(span).toBeLessThan(49 * 20 + 120);
        expect(states).toEqual(["buffering", "playing", "idle"]);
        expect(finished).toEqual([resource]);
        expect(resource.playbackDuration).toBe(1000);
        expect(speaking.at(-1)).toBe(false);
    }, 8000);

    test("pause sends five silence frames and stops the clock; unpause continues", async () => {
        const player = new AudioPlayer();
        const { s, frames } = sink();
        player.attach(s);
        player.play(counted(1000));
        await until(() => frames.length >= 5);
        expect(player.pause()).toBe(true);
        expect(player.pause()).toBe(false);
        await until(() => !player.ticking);
        const atPause = frames.length;
        expect(frames.slice(-5).every(silent)).toBe(true);
        await Bun.sleep(120);
        expect(frames.length).toBe(atPause); // nothing while paused: no polling
        expect(player.unpause()).toBe(true);
        expect(player.unpause()).toBe(false);
        await until(() => frames.length >= atPause + 3);
        expect(frames.slice(atPause).every((f) => !silent(f))).toBe(true);
        expect(player.stop()).toBe(true);
        expect(player.stop()).toBe(false);
        await until(() => !player.ticking);
    });

    test("pause without silence stops at once; stop(true) sends nothing more", async () => {
        const player = new AudioPlayer();
        const { s, frames } = sink();
        player.attach(s);
        player.play(counted(1000));
        await until(() => frames.length >= 2);
        player.pause(false);
        expect(player.ticking).toBe(false);
        const n = frames.length;
        player.resume();
        await until(() => frames.length > n);
        player.stop(true);
        const m = frames.length;
        await Bun.sleep(80);
        expect(frames.length).toBe(m);
        expect(player.resource).toBeUndefined();
    });

    test("with no ready subscriber it autopauses (no clock), and resumes when one is ready", async () => {
        const player = new AudioPlayer();
        const { s, frames } = sink(false);
        player.attach(s);
        player.play(counted(100));
        await until(() => player.state === "autopaused");
        expect(player.ticking).toBe(false);
        s.ready = true;
        player.refresh();
        await until(() => frames.length >= 3);
        expect(["playing", "buffering"]).toContain(player.state);
        player.detach(s);
        player.detach(s);
        await until(() => player.state === "autopaused");
        player.stop(true);
    });

    test("noSubscriber 'stop' and 'play'", async () => {
        const stopper = new AudioPlayer({ noSubscriber: "stop" });
        stopper.play(counted(10));
        await until(() => stopper.state === "idle");
        const player = new AudioPlayer({ noSubscriber: "play" });
        const resource = counted(5);
        player.play(resource);
        await until(() => player.state === "idle", 2000);
        expect(resource.playbackDuration).toBe(100);
    });

    test("a resource that fails reports the error and goes idle; one that stalls times out", async () => {
        const player = new AudioPlayer({ maxMissedFrames: 3 });
        const { s } = sink();
        player.attach(s);
        const errors: Error[] = [];
        player.on("error", (e) => errors.push(e));
        player.play(
            new AudioResource(
                (async function* () {
                    yield Uint8Array.of(1);
                    throw new Error("decoder broke");
                })(),
                {},
            ),
        );
        await until(() => errors.length === 1);
        expect(errors[0]!.message).toBe("decoder broke");
        expect(player.state).toBe("idle");
        player.play(
            new AudioResource(
                (async function* () {
                    await new Promise(() => undefined);
                })(),
                {},
            ),
        );
        await until(() => errors.length === 2);
        expect(errors[1]).toBeInstanceOf(VoiceError);
        await until(() => !player.ticking);
    });

    test("playing a new resource destroys the old one; entersState follows the player", async () => {
        const player = new AudioPlayer();
        const { s } = sink();
        player.attach(s);
        const first = counted(1000);
        player.play(first);
        await entersState(player, "playing", 500);
        player.play(counted(1000));
        expect(first.ended).toBe(true);
        await expect(entersState(player, "paused", 20)).rejects.toThrow(
            VoiceError,
        );
        player.stop(true);
    });
});

describe("the receiver (Step 7)", () => {
    test("streams a user's frames, ends after silence, and drops frames for a slow reader", async () => {
        const receiver = new VoiceReceiver();
        const starts: string[] = [];
        const ends: string[] = [];
        receiver
            .on("start", (u) => starts.push(u))
            .on("end", (u) => ends.push(u));
        const unused = () => undefined;
        receiver.on("start", unused).off("start", unused);
        const stream = receiver.subscribe("u1", {
            end: { behavior: "silence", duration: 60 },
            highWaterMark: 3,
        });
        receiver.mapUser("u1", 5);
        expect(receiver.ssrcOf("u1")).toBe(5);
        for (let i = 0; i < 10; i++) receiver.push("u1", Uint8Array.of(i));
        receiver.push("u2", Uint8Array.of(99)); // nobody listens: nothing kept
        const reader = stream.getReader();
        const got: number[] = [];
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            got.push(value[0]!);
        }
        expect(got).toEqual([0, 1, 2]); // bounded: the rest were dropped
        expect(starts).toEqual(["u1", "u2"]);
        await until(() => ends.length === 2);
        expect(receiver.speaking.size).toBe(0);
    });

    test("silence frames do not keep a stream open; unsubscribe and close end streams", async () => {
        const receiver = new VoiceReceiver();
        const stream = receiver.subscribe("u1", {
            end: { behavior: "silence", duration: 50 },
        });
        const timer = setInterval(() => receiver.push("u1", SILENCE_FRAME), 10);
        cleanup.push(() => clearInterval(timer));
        const reader = stream.getReader();
        let done = false;
        while (!done) done = (await reader.read()).done ?? false;
        clearInterval(timer);

        const manual = receiver.subscribe("u2", {
            end: { behavior: "manual" },
        });
        expect(receiver.unsubscribe("u2")).toBe(true);
        expect(receiver.unsubscribe("u2")).toBe(false);
        expect((await manual.getReader().read()).done).toBe(true);

        const a = receiver.subscribe("u3", { end: { behavior: "manual" } });
        const b = receiver.subscribe("u3", { end: { behavior: "manual" } });
        receiver.mapUser("u3", 9);
        receiver.forgetUser("u3");
        expect((await a.getReader().read()).done).toBe(true);
        expect((await b.getReader().read()).done).toBe(true);
        const c = receiver.subscribe("u4", { end: { behavior: "manual" } });
        receiver.close();
        expect((await c.getReader().read()).done).toBe(true);
        // Cancelling releases the subscription.
        const d = receiver.subscribe("u5", { end: { behavior: "manual" } });
        await d.cancel();
        expect(receiver.unsubscribe("u5")).toBe(false);
    });
});
