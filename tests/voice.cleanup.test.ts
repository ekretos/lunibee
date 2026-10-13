import { describe, expect, test } from "bun:test";
import { VoiceConnection, entersState } from "../packages/voice/src/index.ts";

const rtp = (ssrc: number) => {
    const packet = new Uint8Array(14);
    new DataView(packet.buffer).setUint32(8, ssrc);
    packet[0] = 0x80;
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

describe("RTP validation and long waits", () => {
    test("a datagram that is not RTP version 2 is ignored", async () => {
        const connection = new VoiceConnection("1");
        connection.receiver.mapSsrc(5, "u");
        const reader = connection.receiver.subscribe("u").stream.getReader();
        const forged = rtp(5);
        forged[0] = 0x00;
        connection.receiver.onPacket(forged);
        connection.receiver.onPacket(rtp(5));
        expect((await reader.read()).value).toEqual(new Uint8Array([7, 0]));
        connection.destroy();
    });

    test("entersState(Infinity) does not reject at once", async () => {
        const connection = new VoiceConnection("1");
        let settled = false;
        entersState(connection, "ready" as never, Infinity).then(
            () => (settled = true),
            () => (settled = true),
        );
        await Bun.sleep(20);
        expect(settled).toBe(false);
        connection.destroy();
    });
});
