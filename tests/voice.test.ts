import { describe, expect, test } from "bun:test";
import {
    VoiceConnection,
    VoiceConnectionState,
    VoiceError,
    SpeakingFlags,
    type VoiceGatewayTransport,
    type VoiceUdpTransport,
} from "../packages/voice/src/index.ts";

describe("Voice", () => {
    test("VoiceConnection constructor validates guild ID and sets options", () => {
        expect(() => new VoiceConnection("")).toThrow(TypeError);
        expect(() => new VoiceConnection({ guildId: "   " })).toThrow(
            TypeError,
        );

        const conn = new VoiceConnection({
            guildId: "123",
            channelId: "456",
            selfMute: true,
            selfDeaf: false,
        });
        expect(conn.guildId).toBe("123");
        expect(conn.channelId).toBe("456");
        expect(conn.selfMute).toBe(true);
        expect(conn.selfDeaf).toBe(false);
        expect(conn.state).toBe(VoiceConnectionState.Disconnected);
    });

    test("VoiceConnection lifecycle: connect, stateChange, and disconnect", () => {
        const conn = new VoiceConnection("123");
        const stateTransitions: string[] = [];

        const listener = (
            next: VoiceConnectionState,
            prev: VoiceConnectionState,
        ) => {
            stateTransitions.push(`${prev}->${next}`);
        };

        conn.on("stateChange", listener);
        conn.connect();
        expect(conn.state).toBe(VoiceConnectionState.Connected);

        conn.setSuppression({ selfMute: false, selfDeaf: true });
        expect(conn.selfMute).toBe(false);
        expect(conn.selfDeaf).toBe(true);

        conn.setChannel("789");
        expect(conn.channelId).toBe("789");

        conn.disconnect();
        expect(conn.state).toBe(VoiceConnectionState.Disconnected);

        conn.off("stateChange", listener);
    });

    test("VoiceConnection attachTransports and setSpeaking", () => {
        const conn = new VoiceConnection("123");

        let sentPayload: any;
        let closedGateway = false;
        let closedUdp = false;

        const mockGateway: VoiceGatewayTransport = {
            connect: async () => {},
            send: (p) => {
                sentPayload = p;
            },
            close: () => {
                closedGateway = true;
            },
        };

        const mockUdp: VoiceUdpTransport = {
            send: () => {},
            close: () => {
                closedUdp = true;
            },
        };

        expect(() => conn.setSpeaking(SpeakingFlags.Microphone)).toThrow(
            VoiceError,
        );

        conn.attachTransports(mockGateway, mockUdp);
        conn.setSpeaking(SpeakingFlags.Priority);
        expect(sentPayload).toEqual({
            op: 5,
            d: { speaking: SpeakingFlags.Priority, delay: 0, ssrc: 0 },
        });

        conn.destroy();
        expect(conn.state).toBe(VoiceConnectionState.Destroyed);
        expect(closedGateway).toBe(true);
        expect(closedUdp).toBe(true);

        expect(() => conn.connect()).toThrow(VoiceError);
        expect(() => conn.setChannel("123")).toThrow(VoiceError);
    });

    test("VoiceReceiver maps SSRCs and routes packets", () => {
        const conn = new VoiceConnection("123");
        
        let onMessageCb: ((packet: Uint8Array) => void) | undefined;
        const mockGateway: VoiceGatewayTransport = {
            connect: async () => {}, send: () => {}, close: () => {},
        };
        const mockUdp: VoiceUdpTransport = {
            send: () => {}, close: () => {},
            onMessage: (cb) => { onMessageCb = cb; }
        };

        conn.attachTransports(mockGateway, mockUdp);
        expect(onMessageCb).toBeDefined();

        conn.receiver.mapSsrc(12345, "user1");
        const stream = conn.receiver.subscribe("user1");
        
        const reader = stream.stream.getReader();
        let readResult: any;
        reader.read().then((res) => { readResult = res; });

        // Simulate incoming UDP packet: 12-byte RTP header (SSRC 12345 at byte 8)
        // followed by a 4-byte audio payload.
        const payload = new Uint8Array([1, 2, 3, 4]);
        const packet = new Uint8Array(12 + payload.length);
        new DataView(packet.buffer).setUint32(8, 12345, false);
        packet.set(payload, 12);
        onMessageCb!(packet);

        // Allow microtask queue to process
        return new Promise<void>((resolve) => {
            setTimeout(() => {
                expect(readResult).toBeDefined();
                // The RTP header is stripped; only the audio payload is delivered.
                expect(readResult.value).toEqual(payload);
                expect(readResult.done).toBe(false);
                resolve();
            }, 10);
        });
    });
});
