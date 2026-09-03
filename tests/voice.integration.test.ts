import { describe, expect, test } from "bun:test";
import {
    VoiceConnection,
    VoiceConnectionState,
    AudioPlayer,
    AudioStream,
    SpeakingFlags,
    type VoiceGatewayTransport,
    type VoiceUdpTransport,
} from "../packages/voice/src/index.ts";

/** Minimal in-memory gateway transport that records sent payloads. */
function mockGateway(): VoiceGatewayTransport & {
    sent: unknown[];
    closed: boolean;
} {
    const sent: unknown[] = [];
    return {
        sent,
        closed: false,
        connect: async () => {},
        send(payload) {
            sent.push(payload);
        },
        close() {
            this.closed = true;
        },
    };
}

/** Minimal UDP transport that lets the test push inbound packets. */
function mockUdp(): VoiceUdpTransport & {
    emit: (packet: Uint8Array) => void;
    closed: boolean;
} {
    let listener: ((p: Uint8Array) => void) | undefined;
    return {
        closed: false,
        send: () => {},
        close() {
            this.closed = true;
        },
        onMessage(l) {
            listener = l;
        },
        emit(packet) {
            listener?.(packet);
        },
    };
}

/** Builds a minimal RTP packet carrying the given SSRC in bytes 8..11 (big-endian),
 * followed by an optional audio payload after the 12-byte fixed header. */
function rtpPacket(ssrc: number, payload: number[] = []): Uint8Array {
    const buf = new Uint8Array(12 + payload.length);
    const view = new DataView(buf.buffer);
    view.setUint32(8, ssrc, false);
    buf.set(payload, 12);
    return buf;
}

describe("Voice integration", () => {
    test("attachTransports replaces the prior pair and closes it", () => {
        const conn = new VoiceConnection({ guildId: "1", channelId: "2" });
        const g1 = mockGateway();
        const u1 = mockUdp();
        conn.attachTransports(g1, u1);

        const g2 = mockGateway();
        const u2 = mockUdp();
        conn.attachTransports(g2, u2);

        expect(g1.closed).toBe(true);
        expect(u1.closed).toBe(true);
        expect(conn.gateway).toBe(g2);
        expect(conn.udp).toBe(u2);
    });

    test("setSpeaking sends an op-5 payload and emits speaking", () => {
        const conn = new VoiceConnection("guild");
        const gateway = mockGateway();
        conn.attachTransports(gateway, mockUdp());

        const seen: number[] = [];
        conn.on("speaking", (flags) => seen.push(flags));
        conn.setSpeaking(SpeakingFlags.Priority);

        expect(gateway.sent).toHaveLength(1);
        expect((gateway.sent[0] as { op: number }).op).toBe(5);
        expect(
            (gateway.sent[0] as { d: { speaking: number } }).d.speaking,
        ).toBe(SpeakingFlags.Priority);
        expect(seen).toEqual([SpeakingFlags.Priority]);
    });

    test("receiver routes an inbound RTP packet to the subscribed user's stream", async () => {
        const conn = new VoiceConnection("guild");
        const udp = mockUdp();
        conn.attachTransports(mockGateway(), udp);

        conn.receiver.mapSsrc(4242, "user-1");
        const audio = conn.receiver.subscribe("user-1");
        const reader = audio.stream.getReader();

        udp.emit(rtpPacket(4242, [10, 20, 30]));
        const { value, done } = await reader.read();
        expect(done).toBe(false);
        expect(value).toBeInstanceOf(Uint8Array);
        // The RTP header is stripped: subscribers receive only the audio payload.
        expect(Array.from(value!)).toEqual([10, 20, 30]);
        await reader.cancel();
    });

    test("cleanup isolates a throwing transport and surfaces it via error event", () => {
        const conn = new VoiceConnection("guild");
        const gateway: VoiceGatewayTransport = {
            connect: async () => {},
            send: () => {},
            close() {
                throw new Error("boom");
            },
        };
        conn.attachTransports(gateway, mockUdp());

        const errors: Error[] = [];
        conn.on("error", (err) => errors.push(err));
        // disconnect() triggers transport cleanup; the throw must be caught.
        expect(() => conn.disconnect()).not.toThrow();
        expect(errors).toHaveLength(1);
        expect(conn.state).toBe(VoiceConnectionState.Disconnected);
    });

    test("destroy() is terminal and blocks further usable operations", () => {
        const conn = new VoiceConnection("guild");
        conn.destroy();
        expect(conn.state).toBe(VoiceConnectionState.Destroyed);
        conn.destroy(); // idempotent
        expect(() => conn.setChannel("9")).toThrow();
        expect(() => conn.setSpeaking()).toThrow();
    });

    test("AudioPlayer runs the full state machine and finishes a drained stream", async () => {
        const player = new AudioPlayer();
        const states: string[] = [];
        player.on("stateChange", (_from, to) => states.push(to));

        const finished = new Promise<void>((resolve) =>
            player.on("finish", () => resolve()),
        );

        const chunks = [new Uint8Array([1]), new Uint8Array([2])];
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const c of chunks) controller.enqueue(c);
                controller.close();
            },
        });

        player.play(new AudioStream(stream, { title: "clip" }));
        expect(player.state).toBe("playing");
        await finished;
        expect(player.state).toBe("idle");
        expect(states).toContain("playing");
        expect(states).toContain("idle");
    });

    test("AudioPlayer pause/resume/stop transitions are gated by state", () => {
        const player = new AudioPlayer();
        // No stream loaded: pause/resume are no-ops.
        player.pause();
        player.resume();
        expect(player.state).toBe("idle");

        const stream = new ReadableStream<Uint8Array>({
            start() {
                /* never closes: keeps the player alive for the transitions */
            },
        });
        player.play(new AudioStream(stream));
        expect(player.state).toBe("playing");
        player.pause();
        expect(player.state).toBe("paused");
        player.resume();
        expect(player.state).toBe("playing");
        player.stop();
        expect(player.state).toBe("stopped");
    });
});
