import { describe, expect, test } from "bun:test";
import OpusScript from "opusscript";
import {
    Opus,
    OpusApplication,
    PCM_FRAME_BYTES,
    VoiceError,
    createOpusCodec,
    generateDependencyReport,
    hasLibopus,
    libopusVersion,
    loadLibopus,
} from "../packages/voice/src/index.ts";

/** 20 ms of a stereo sine, s16le. */
function sine(frequency: number, frame: number): Uint8Array {
    const pcm = new Uint8Array(PCM_FRAME_BYTES);
    const view = new DataView(pcm.buffer);
    for (let i = 0; i < 960; i++) {
        const v = Math.round(
            Math.sin((2 * Math.PI * frequency * (frame * 960 + i)) / 48_000) *
                8000,
        );
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

test("a missing library is reported, not thrown", () => {
    expect(loadLibopus(["/nonexistent/libopus.so"])).toBeNull();
    expect(loadLibopus([])).toBeNull();
});

describe.skipIf(!hasLibopus())("Opus on the system libopus", () => {
    test("encodes and decodes a tone back to the same level", () => {
        const opus = new Opus();
        let last: Uint8Array = new Uint8Array();
        for (let frame = 0; frame < 25; frame++) {
            const packet = opus.encode(sine(440, frame));
            expect(packet.length).toBeGreaterThan(0);
            expect(packet.length).toBeLessThanOrEqual(1275);
            last = opus.decode(packet);
        }
        expect(last.length).toBe(PCM_FRAME_BYTES);
        expect(rms(last) / rms(sine(440, 24))).toBeGreaterThan(0.8);
        expect(rms(last) / rms(sine(440, 24))).toBeLessThan(1.2);
        // A lost packet is concealed as one 20 ms frame.
        expect(opus.decode(new Uint8Array()).length).toBe(PCM_FRAME_BYTES);
        opus.destroy();
        opus.destroy();
    });

    test("unaligned input, the other applications, and opusscript reading its packets", () => {
        const voip = new Opus(OpusApplication.Voip);
        const low = new Opus(OpusApplication.RestrictedLowDelay);
        const backing = new Uint8Array(PCM_FRAME_BYTES + 1);
        backing.set(sine(220, 0), 1);
        const unaligned = backing.subarray(1);
        const packet = voip.encode(unaligned);
        expect(low.encode(sine(220, 0)).length).toBeGreaterThan(0);
        const other = new OpusScript(48_000, 2, OpusScript.Application.AUDIO);
        expect(other.decode(Buffer.from(packet)).length).toBe(PCM_FRAME_BYTES);
        other.delete();
        voip.destroy();
        low.destroy();
    });

    test("wrong frame sizes, corrupt packets and use after destroy are VoiceErrors", () => {
        const opus = new Opus();
        expect(() => opus.encode(new Uint8Array(100))).toThrow(
            `Opus encodes one 20 ms frame of ${PCM_FRAME_BYTES} bytes, got 100.`,
        );
        expect(() =>
            opus.decode(Uint8Array.of(0xff, 0xff, 0xff, 0xff)),
        ).toThrow(/Opus decoding failed: /);
        opus.destroy();
        expect(() => opus.encode(sine(440, 0))).toThrow(VoiceError);
        expect(() => opus.decode(Uint8Array.of(0xf8))).toThrow(
            "The Opus codec was destroyed.",
        );
        expect(() => new Opus(1 as never)).toThrow(
            /Creating the Opus encoder failed: /,
        );
    });

    test("is the codec voice uses, and the dependency report says so", async () => {
        const codec = await createOpusCodec();
        expect(codec.library).toBe("libopus");
        expect(codec.decode(codec.encode(sine(440, 0))).length).toBe(
            PCM_FRAME_BYTES,
        );
        codec.destroy();
        expect(libopusVersion()).toStartWith("libopus ");
        expect(Opus.libraryPath).toBeTruthy();
        expect((await generateDependencyReport()).opus).toBe("libopus");
    });
});
