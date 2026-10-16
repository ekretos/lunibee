import { afterEach, describe, expect, test } from "bun:test";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
    PacketCipher,
    SUPPORTED_ENCRYPTION_MODES,
    VoiceCloseCodes,
    VoiceError,
    VoiceNetworking,
    VoiceOpcodes,
    VoiceUdp,
    canResumeVoice,
    chooseEncryptionMode,
    discoveryRequest,
    parseDiscoveryResponse,
    parseRtpHeader,
    rtpHeader,
    voiceGatewayURL,
    type NetworkingState,
} from "../packages/voice/src/index.ts";
import { startFakeVoiceServer } from "./helpers/fake-voice-server.ts";

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

const hex = (s: string) =>
    Uint8Array.from(Buffer.from(s.replace(/\s/g, ""), "hex"));

describe("transport encryption", () => {
    test("XChaCha20-Poly1305 matches the published test vector (draft-irtf-cfrg-xchacha-03 A.3.1)", () => {
        const plaintext = new TextEncoder().encode(
            "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
        );
        const out = xchacha20poly1305(
            hex(
                "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f",
            ),
            hex("404142434445464748494a4b4c4d4e4f5051525354555657"),
            hex("50515253c0c1c2c3c4c5c6c7"),
        ).encrypt(plaintext);
        const text = Buffer.from(out).toString("hex");
        expect(text.slice(0, 64)).toBe(
            "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb",
        );
        expect(text.slice(-32)).toBe("c0875924c1c7987947deafd8780acf49");
    });

    test("AES-256-GCM matches a NIST GCM test vector (gcmEncryptExtIV256, Count 0, 128-bit tag)", async () => {
        // Key, IV, plaintext and tag from the NIST CAVS GCM vectors (empty AAD).
        const { createCipheriv } = await import("node:crypto");
        const cipher = createCipheriv(
            "aes-256-gcm",
            hex(
                "31bdadd96698c204aa9ce1448ea94ae1fb4a9a0b3c9d773b51bb1822666b8f22",
            ),
            hex("0d18e06c7c725ac9e362e1ce"),
        );
        const ct = Buffer.concat([
            cipher.update(hex("2db5168e932556f8089a0622981d017d")),
            cipher.final(),
        ]);
        expect(ct.toString("hex")).toBe("fa4362189661d163fcd6a56d8bf0405a");
        expect(cipher.getAuthTag().toString("hex")).toBe(
            "d636ac1bbedd5cc3ee727dc2ab4a9489",
        );
    });

    for (const mode of SUPPORTED_ENCRYPTION_MODES) {
        test(`${mode}: seal and open round-trip; the header is authenticated, the nonce counter appended`, () => {
            const key = new Uint8Array(32).fill(7);
            const sender = new PacketCipher(mode, key);
            const receiver = new PacketCipher(mode, key);
            const header = rtpHeader(65_535, 0xffff_ffff, 99);
            const payload = Uint8Array.of(1, 2, 3, 4, 5);
            const packet = sender.seal(header, payload);
            expect([...packet.subarray(0, 12)]).toEqual([...header]);
            expect([...packet.subarray(packet.length - 4)]).toEqual([
                0, 0, 0, 0,
            ]);
            expect(packet.length).toBe(12 + 5 + 16 + 4);
            const opened = receiver.open(packet)!;
            expect([...opened.payload]).toEqual([1, 2, 3, 4, 5]);
            expect([
                opened.header.sequence,
                opened.header.timestamp,
                opened.header.ssrc,
            ]).toEqual([65_535, 0xffff_ffff, 99]);
            // Second packet carries counter 1.
            expect([...sender.seal(header, payload).subarray(-4)]).toEqual([
                0, 0, 0, 1,
            ]);
            // A changed header byte fails authentication.
            const tampered = Uint8Array.from(packet);
            tampered[3] ^= 1;
            expect(receiver.open(tampered)).toBeUndefined();
            // So does a wrong key, and a truncated packet.
            expect(
                new PacketCipher(mode, new Uint8Array(32)).open(packet),
            ).toBeUndefined();
            expect(receiver.open(packet.subarray(0, 20))).toBeUndefined();
        });
    }

    test("an extension's body is decrypted and dropped; padding is removed", () => {
        const key = new Uint8Array(32).fill(3);
        const cipher = new PacketCipher("aead_xchacha20_poly1305_rtpsize", key);
        const header = new Uint8Array(16);
        header[0] = 0xb0; // version 2, padding, extension
        header[1] = 0x78;
        new DataView(header.buffer).setUint16(12, 0xbede);
        new DataView(header.buffer).setUint16(14, 1);
        const body = Uint8Array.of(9, 9, 9, 9, 0xaa, 0xbb, 0, 2); // ext word, payload, 2 bytes padding
        const opened = cipher.open(cipher.seal(header, body))!;
        expect([...opened.payload]).toEqual([0xaa, 0xbb]);
    });

    test("the nonce counter wraps at 2^32 and keys must be 32 bytes", () => {
        const key = new Uint8Array(32);
        const cipher = new PacketCipher(
            "aead_xchacha20_poly1305_rtpsize",
            key,
            2 ** 32 - 1,
        );
        const last = cipher.seal(rtpHeader(0, 0, 1), Uint8Array.of(1));
        expect([...last.subarray(-4)]).toEqual([255, 255, 255, 255]);
        expect(cipher.counter).toBe(0);
        const wrapped = cipher.seal(rtpHeader(1, 960, 1), Uint8Array.of(2));
        expect([...wrapped.subarray(-4)]).toEqual([0, 0, 0, 0]);
        const receiver = new PacketCipher(
            "aead_xchacha20_poly1305_rtpsize",
            key,
        );
        expect([...receiver.open(last)!.payload]).toEqual([1]);
        expect([...receiver.open(wrapped)!.payload]).toEqual([2]);
        expect(
            () =>
                new PacketCipher(
                    "aead_xchacha20_poly1305_rtpsize",
                    new Uint8Array(16),
                ),
        ).toThrow(VoiceError);
        expect(
            () =>
                new PacketCipher(
                    "xsalsa20_poly1305" as never,
                    new Uint8Array(32),
                ),
        ).toThrow(VoiceError);
    });

    test("RTP headers wrap sequence at 2^16 and timestamp at 2^32", () => {
        const header = parseRtpHeader(
            rtpHeader(65_536 + 5, 2 ** 32 + 7, 2 ** 32 - 1),
        )!;
        expect([
            header.sequence,
            header.timestamp,
            header.ssrc,
            header.payloadType,
        ]).toEqual([5, 7, 2 ** 32 - 1, 0x78]);
        expect(
            parseRtpHeader(
                Uint8Array.of(0x40, 0x78, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
            ),
        ).toBeUndefined();
        expect(parseRtpHeader(new Uint8Array(4))).toBeUndefined();
    });

    test("mode choice prefers AES-GCM and refuses servers offering neither", () => {
        expect(
            chooseEncryptionMode([
                "aead_xchacha20_poly1305_rtpsize",
                "aead_aes256_gcm_rtpsize",
            ]),
        ).toBe("aead_aes256_gcm_rtpsize");
        expect(chooseEncryptionMode(["aead_xchacha20_poly1305_rtpsize"])).toBe(
            "aead_xchacha20_poly1305_rtpsize",
        );
        expect(() => chooseEncryptionMode(["xsalsa20_poly1305"])).toThrow(
            VoiceError,
        );
    });
});

describe("protocol helpers", () => {
    test("close codes: what resumes and what does not", () => {
        expect(canResumeVoice(1006)).toBe(true);
        expect(canResumeVoice(VoiceCloseCodes.VoiceServerCrashed)).toBe(true);
        expect(canResumeVoice(VoiceCloseCodes.SessionNoLongerValid)).toBe(
            false,
        );
        expect(canResumeVoice(VoiceCloseCodes.Disconnected)).toBe(false);
        expect(canResumeVoice(VoiceCloseCodes.DaveProtocolRequired)).toBe(
            false,
        );
    });

    test("IP discovery packets", () => {
        const request = discoveryRequest(0x01020304);
        expect(request.length).toBe(74);
        expect([...request.subarray(0, 8)]).toEqual([0, 1, 0, 70, 1, 2, 3, 4]);
        const reply = new Uint8Array(74);
        const view = new DataView(reply.buffer);
        view.setUint16(0, 2);
        view.setUint16(2, 70);
        reply.set(new TextEncoder().encode("203.0.113.9"), 8);
        view.setUint16(72, 50_000);
        expect(parseDiscoveryResponse(reply)).toEqual({
            ip: "203.0.113.9",
            port: 50_000,
        });
        expect(parseDiscoveryResponse(request)).toBeUndefined();
        reply.set(new TextEncoder().encode("not.an.ip.x"), 8);
        expect(parseDiscoveryResponse(reply)).toBeUndefined();
    });

    test("voice gateway URLs use wss and v8, whatever the endpoint looks like", () => {
        expect(voiceGatewayURL("c-ams.discord.media:443")).toBe(
            "wss://c-ams.discord.media:443/?v=8",
        );
        expect(voiceGatewayURL("wss://c-ams.discord.media/path")).toBe(
            "wss://c-ams.discord.media/?v=8",
        );
    });

    test("the UDP socket closes, refuses sends after, and times out discovery", async () => {
        const udp = await VoiceUdp.open("127.0.0.1", 9);
        await expect(udp.discover(1, 30)).rejects.toThrow(/timed out/);
        udp.close();
        udp.close();
        expect(udp.closed).toBe(true);
        expect(udp.send(Uint8Array.of(1))).toBe(false);
        await expect(udp.discover(1)).rejects.toThrow(/closed/);
    });
});

const info = (endpoint: string) => ({
    guildId: "100000000000000001",
    channelId: "100000000000000002",
    userId: "100000000000000003",
    sessionId: "session-1",
    token: "voice-token",
    endpoint,
});

async function connect(
    options: Parameters<typeof startFakeVoiceServer>[0] = {},
    extra: Partial<ConstructorParameters<typeof VoiceNetworking>[2]> = {},
) {
    const server = await startFakeVoiceServer(options);
    cleanup.push(() => server.stop());
    const states: NetworkingState[] = [];
    const closes: { code: number; reason: string }[] = [];
    const audio: { user: string; frame: Uint8Array }[] = [];
    const networking = new VoiceNetworking(
        info(server.endpoint),
        {
            state: (s) => states.push(s),
            close: (code, reason) => closes.push({ code, reason }),
            audio: (user, frame) => audio.push({ user, frame }),
        },
        { url: server.url, dave: false, ...extra },
    );
    cleanup.push(() => networking.destroy());
    return { server, networking, states, closes, audio };
}

describe("voice gateway handshake (v8)", () => {
    for (const mode of SUPPORTED_ENCRYPTION_MODES) {
        test(`identify, discover, select ${mode}, and send audio the server can decrypt`, async () => {
            const { server, networking, states } = await connect({
                modes: [mode],
            });
            await until(() => networking.state === "ready");
            expect(states).toEqual([
                "identifying",
                "discovering",
                "selecting",
                "ready",
            ]);
            expect(server.state.identifies[0]).toEqual({
                server_id: "100000000000000001",
                user_id: "100000000000000003",
                session_id: "session-1",
                token: "voice-token",
                max_dave_protocol_version: 0,
            });
            const select = server.state.selects[0] as {
                protocol: string;
                data: { address: string; port: number; mode: string };
            };
            expect(select.protocol).toBe("udp");
            expect(select.data.address).toBe("127.0.0.1");
            expect(select.data.port).toBe(server.state.client!.port);
            expect(select.data.mode).toBe(mode);
            expect(networking.mode).toBe(mode);
            expect(networking.ssrc).toBe(server.ssrc);

            for (let i = 0; i < 3; i++)
                expect(networking.sendFrame(Uint8Array.of(0xfc, i, i))).toBe(
                    true,
                );
            await until(() => server.state.packets.length === 3);
            const [a, b, c] = server.state.packets;
            expect(server.state.decryptFailures).toBe(0);
            expect([...a!.payload]).toEqual([0xfc, 0, 0]);
            expect(b!.sequence).toBe((a!.sequence + 1) & 0xffff);
            expect(c!.timestamp).toBe((a!.timestamp + 1920) >>> 0);
            expect(a!.ssrc).toBe(server.ssrc);
            // Speaking was announced once, with the negotiated SSRC (not 0).
            expect(server.state.speaking).toEqual([
                { speaking: 1, delay: 0, ssrc: server.ssrc },
            ]);
            networking.setSpeaking(false);
            await until(() => server.state.speaking.length === 2);
            expect(server.state.speaking[1]).toEqual({
                speaking: 0,
                delay: 0,
                ssrc: server.ssrc,
            });
        });
    }

    test("heartbeats carry seq_ack, and the round trip is measured", async () => {
        const { server, networking } = await connect({ heartbeatInterval: 40 });
        await until(() => networking.state === "ready");
        await until(() => server.state.heartbeats.length >= 2);
        const beat = server.state.heartbeats.at(-1) as {
            t: number;
            seq_ack: number;
        };
        expect(typeof beat.t).toBe("number");
        expect(beat.seq_ack).toBeGreaterThanOrEqual(3);
        await until(() => networking.ping >= 0);
    });

    test("a recoverable close resumes with seq_ack and keeps the session", async () => {
        const { server, networking, states, closes } = await connect();
        await until(() => networking.state === "ready");
        // 4015 (voice server crashed) and any close below 4000 resume.
        for (const code of [VoiceCloseCodes.VoiceServerCrashed, 3999]) {
            server.close(code);
            await until(
                () =>
                    server.state.resumes.length > 0 &&
                    networking.state === "ready" &&
                    states.at(-1) === "ready" &&
                    states.includes("resuming"),
            );
            states.length = 0;
        }
        const resume = server.state.resumes[0] as Record<string, unknown>;
        expect(resume).toMatchObject({
            server_id: "100000000000000001",
            session_id: "session-1",
            token: "voice-token",
        });
        expect(typeof resume.seq_ack).toBe("number");
        expect(closes).toEqual([]);
        expect(networking.sendFrame(Uint8Array.of(1, 2, 3))).toBe(true);
    });

    for (const code of [
        VoiceCloseCodes.SessionNoLongerValid,
        VoiceCloseCodes.Disconnected,
    ]) {
        test(`close ${code} ends the session without resuming`, async () => {
            const { server, networking, closes } = await connect();
            await until(() => networking.state === "ready");
            server.close(code, "bye");
            await until(() => closes.length === 1);
            expect(closes[0]!.code).toBe(code);
            expect(networking.state).toBe("closed");
            expect(server.state.resumes).toEqual([]);
            expect(networking.sendFrame(Uint8Array.of(1))).toBe(false);
        });
    }

    test("4017 without DAVE says how to fix it", async () => {
        const { server, networking, closes } = await connect();
        await until(() => networking.state === "ready");
        server.close(
            VoiceCloseCodes.DaveProtocolRequired,
            "E2EE/DAVE protocol required",
        );
        await until(() => closes.length === 1);
        expect(closes[0]!.reason).toContain("install @snazzah/davey");
    });

    test("a server that never answers discovery fails the session", async () => {
        const { closes, networking } = await connect({ discovery: false });
        await until(() => closes.length === 1, 7000);
        expect(networking.state).toBe("closed");
        expect(closes[0]!.reason).toMatch(/discovery/i);
    }, 10_000);

    test("other users' audio is decrypted and attributed by SSRC (op 5)", async () => {
        const { server, networking, audio } = await connect();
        await until(() => networking.state === "ready");
        server.sendAudio(777, Uint8Array.of(9, 9), 1); // unknown SSRC: dropped
        server.json(VoiceOpcodes.Speaking, {
            user_id: "200000000000000001",
            ssrc: 777,
            speaking: 1,
        });
        await Bun.sleep(30);
        server.sendAudio(777, Uint8Array.of(1, 2, 3), 2);
        server.sendAudio(
            777,
            Uint8Array.of(4, 5),
            3,
            Uint8Array.of(0x10, 0, 0, 0),
        );
        await until(() => audio.length === 2);
        expect(audio.map((a) => [a.user, [...a.frame]])).toEqual([
            ["200000000000000001", [1, 2, 3]],
            ["200000000000000001", [4, 5]],
        ]);
        server.json(VoiceOpcodes.ClientDisconnect, {
            user_id: "200000000000000001",
        });
        await Bun.sleep(30);
        server.sendAudio(777, Uint8Array.of(6), 4);
        await Bun.sleep(50);
        expect(audio.length).toBe(2);
    });
});
