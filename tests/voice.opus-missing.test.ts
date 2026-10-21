import { afterAll, expect, mock, test } from "bun:test";
import OpusScript from "opusscript";
import { resetLibopus } from "../packages/voice/src/libopus.ts";
import { createOpusCodec } from "../packages/voice/src/opus.ts";
import { VoiceError } from "../packages/voice/src/protocol.ts";

// mock.module() replaces the module (and live bindings to it) for the whole
// process: keep the real class and put it back.
const RealOpusScript = OpusScript;
const restore = () =>
    mock.module("opusscript", () => ({ default: RealOpusScript }));
// Skip the system libopus, so the opusscript path is the one tested.
const saved = process.env.LUNIBEE_OPUS_LIBRARY;
process.env.LUNIBEE_OPUS_LIBRARY = "none";
resetLibopus();
afterAll(() => {
    restore();
    if (saved === undefined) delete process.env.LUNIBEE_OPUS_LIBRARY;
    else process.env.LUNIBEE_OPUS_LIBRARY = saved;
    resetLibopus();
});

test("createOpusCodec() says what to install when opusscript does not load", async () => {
    mock.module("opusscript", () => ({
        default: class {
            constructor() {
                throw new Error("Cannot find package 'opusscript'");
            }
        },
    }));
    const error = await createOpusCodec().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VoiceError);
    expect((error as Error).message).toContain("install libopus");
    expect((error as Error).message).toContain("or opusscript");
    restore();
    const codec = await createOpusCodec();
    expect(codec.library).toBe("opusscript");
    codec.destroy();
});
