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

describe("transports and backpressure (F-H2, F-H4)", () => {
    test("attaching the same pair twice delivers each datagram once", () => {
        const connection = new VoiceConnection("1");
        let listener: ((p: Uint8Array) => void) | undefined;
        let listeners = 0;
        const udp = {
            send() {},
            close() {},
            onMessage(fn: (p: Uint8Array) => void) {
                listeners++;
                listener = fn;
            },
        };
        const gateway = { send() {}, close() {} };
        connection.attachTransports(gateway as never, udp as never);
        connection.attachTransports(gateway as never, udp as never);
        expect(listeners).toBe(1);
        expect(listener).toBeDefined();
        connection.destroy();
    });

    test("an unread subscriber stream keeps a bounded backlog", async () => {
        const connection = new VoiceConnection("1");
        connection.receiver.mapSsrc(5, "u");
        const reader = connection.receiver.subscribe("u").stream.getReader();
        for (let i = 0; i < 5000; i++) connection.receiver.onPacket(rtp(5));
        connection.receiver.close();
        let count = 0;
        while (!(await reader.read()).done) count++;
        expect(count).toBeLessThanOrEqual(51);
        expect(count).toBeGreaterThan(0);
    });
});

describe("joinVoiceChannel and setSpeaking (D-04, D-05)", () => {
    test("an empty channel ID throws without registering a connection", async () => {
        const { joinVoiceChannel, getVoiceConnection } =
            await import("../packages/voice/src/index.ts");
        expect(() =>
            joinVoiceChannel({ guildId: "d04", channelId: "" }),
        ).toThrow(TypeError);
        expect(getVoiceConnection("d04")).toBeUndefined();
    });

    test("setSpeaking sends the SSRC it is given", () => {
        const connection = new VoiceConnection("1");
        const sent: unknown[] = [];
        connection.attachTransports(
            { send: (p: unknown) => void sent.push(p), close() {} } as never,
            { send() {}, close() {} } as never,
        );
        const spoken: unknown[] = [];
        connection.on("speaking", (flags, ssrc) => spoken.push([flags, ssrc]));
        connection.setSpeaking(1, 4242);
        expect(sent.at(-1)).toEqual({
            op: 5,
            d: { speaking: 1, delay: 0, ssrc: 4242 },
        });
        expect(spoken).toEqual([[1, 4242]]);
        connection.destroy();
    });
});
