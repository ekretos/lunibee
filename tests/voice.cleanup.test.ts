import { describe, expect, test } from "bun:test";
import { VoiceConnection } from "../packages/voice/src/index.ts";

const rtp = (ssrc: number) => {
    const packet = new Uint8Array(14);
    new DataView(packet.buffer).setUint32(8, ssrc);
    packet[12] = 7;
    return packet;
};

describe("VoiceReceiver cleanup", () => {
    test("destroy ends subscriber streams and forgets SSRCs", async () => {
        const connection = new VoiceConnection("1");
        connection.receiver.mapSsrc(5, "u");
        const reader = connection.receiver.subscribe("u").stream.getReader();
        connection.receiver.onPacket(rtp(5));
        expect((await reader.read()).value).toEqual(new Uint8Array([7, 0]));
        connection.destroy();
        expect((await reader.read()).done).toBe(true);
        expect(() => connection.receiver.subscribe("u")).toThrow(
            "Voice connection has been destroyed.",
        );
    });

    test("disconnect also closes streams, even ones the consumer cancelled", async () => {
        const connection = new VoiceConnection("1");
        const stream = connection.receiver.subscribe("u").stream;
        const reader = stream.getReader();
        connection.disconnect();
        expect((await reader.read()).done).toBe(true);
        const other = connection.receiver.subscribe("v").stream;
        const errored = other.getReader();
        await errored.cancel();
        expect(() => connection.receiver.close()).not.toThrow();
    });
});
