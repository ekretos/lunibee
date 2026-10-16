/**
 * A Discord voice server for tests: a real WebSocket (voice gateway v8) and a
 * real UDP socket on localhost. It answers IDENTIFY, IP discovery,
 * SELECT_PROTOCOL and RESUME, records what the client sends, and decrypts
 * the client's audio with its own "rtpsize" implementation (written from the
 * protocol description, not with the client's PacketCipher), so a bug in the
 * client's encryption cannot hide behind the same bug here.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import type { ServerWebSocket } from "bun";

export interface FakeVoiceOptions {
    /** Modes offered in READY. Default both AEAD modes. */
    modes?: string[];
    heartbeatInterval?: number;
    /** DAVE version in SESSION_DESCRIPTION. Default 0. */
    daveVersion?: number;
    ssrc?: number;
    /** Answer IP discovery. Default true. */
    discovery?: boolean;
}

export interface ReceivedPacket {
    sequence: number;
    timestamp: number;
    ssrc: number;
    payload: Uint8Array;
    at: number;
}

type WS = ServerWebSocket<{ id: number }>;

function decryptRtpsize(
    mode: string,
    key: Uint8Array,
    packet: Uint8Array,
): { sequence: number; timestamp: number; ssrc: number; payload: Uint8Array } {
    const view = new DataView(
        packet.buffer,
        packet.byteOffset,
        packet.byteLength,
    );
    const headerSize = 12; // The client sends no CSRCs or extension.
    const nonceSuffix = packet.subarray(packet.length - 4);
    const tagStart = packet.length - 4 - 16;
    const header = packet.subarray(0, headerSize);
    let payload: Uint8Array;
    if (mode === "aead_aes256_gcm_rtpsize") {
        const nonce = Buffer.alloc(12);
        nonce.set(nonceSuffix, 0);
        const decipher = createDecipheriv("aes-256-gcm", key, nonce);
        decipher.setAAD(header);
        decipher.setAuthTag(packet.subarray(tagStart, packet.length - 4));
        payload = Buffer.concat([
            decipher.update(packet.subarray(headerSize, tagStart)),
            decipher.final(),
        ]);
    } else {
        const nonce = new Uint8Array(24);
        nonce.set(nonceSuffix, 0);
        payload = xchacha20poly1305(key, nonce, header).decrypt(
            packet.subarray(headerSize, packet.length - 4),
        );
    }
    return {
        sequence: view.getUint16(2),
        timestamp: view.getUint32(4),
        ssrc: view.getUint32(8),
        payload,
    };
}

function encryptRtpsize(
    mode: string,
    key: Uint8Array,
    header: Uint8Array,
    payload: Uint8Array,
    counter: number,
): Uint8Array {
    const suffix = new Uint8Array(4);
    new DataView(suffix.buffer).setUint32(0, counter);
    let sealed: Uint8Array;
    if (mode === "aead_aes256_gcm_rtpsize") {
        const nonce = Buffer.alloc(12);
        nonce.set(suffix, 0);
        const cipher = createCipheriv("aes-256-gcm", key, nonce);
        cipher.setAAD(header);
        sealed = Buffer.concat([
            cipher.update(payload),
            cipher.final(),
            cipher.getAuthTag(),
        ]);
    } else {
        const nonce = new Uint8Array(24);
        nonce.set(suffix, 0);
        sealed = xchacha20poly1305(key, nonce, header).encrypt(payload);
    }
    return Buffer.concat([header, sealed, suffix]);
}

export async function startFakeVoiceServer(options: FakeVoiceOptions = {}) {
    const key = new Uint8Array(randomBytes(32));
    const ssrc = options.ssrc ?? 4242;
    const state = {
        identifies: [] as Record<string, unknown>[],
        resumes: [] as Record<string, unknown>[],
        selects: [] as Record<string, unknown>[],
        heartbeats: [] as Record<string, unknown>[],
        speaking: [] as Record<string, unknown>[],
        binary: [] as { op: number; payload: Uint8Array }[],
        json: [] as { op: number; d: unknown }[],
        packets: [] as ReceivedPacket[],
        raw: [] as Uint8Array[],
        connections: 0,
        mode: undefined as string | undefined,
        client: undefined as { port: number; address: string } | undefined,
        decryptFailures: 0,
    };
    let current: WS | undefined;
    let sequence = 0;
    let serverCounter = 0;

    const udp = await Bun.udpSocket({
        hostname: "127.0.0.1",
        socket: {
            data(socket, data, port, address) {
                const bytes = new Uint8Array(data);
                state.client = { port, address };
                const view = new DataView(
                    bytes.buffer,
                    bytes.byteOffset,
                    bytes.byteLength,
                );
                if (bytes.length === 74 && view.getUint16(0) === 1) {
                    if (options.discovery === false) return;
                    const reply = new Uint8Array(74);
                    const out = new DataView(reply.buffer);
                    out.setUint16(0, 2);
                    out.setUint16(2, 70);
                    out.setUint32(4, view.getUint32(4));
                    reply.set(new TextEncoder().encode(address), 8);
                    out.setUint16(72, port);
                    socket.send(reply, port, address);
                    return;
                }
                if (bytes.length === 8) return; // keepalive
                state.raw.push(bytes);
                if (!state.mode) return;
                try {
                    const packet = decryptRtpsize(state.mode, key, bytes);
                    state.packets.push({ ...packet, at: performance.now() });
                } catch {
                    state.decryptFailures++;
                }
            },
        },
    });

    const send = (ws: WS, op: number, d: unknown) => {
        ws.send(JSON.stringify({ op, d, seq: ++sequence }));
    };

    const server = Bun.serve<{ id: number }>({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req, srv) {
            if (srv.upgrade(req, { data: { id: ++state.connections } })) return;
            return new Response("voice", { status: 426 });
        },
        websocket: {
            open(ws) {
                current = ws;
                send(ws, 8, {
                    heartbeat_interval: options.heartbeatInterval ?? 41_250,
                });
            },
            message(ws, message) {
                if (typeof message !== "string") {
                    const bytes = new Uint8Array(message);
                    state.binary.push({
                        op: bytes[0]!,
                        payload: bytes.subarray(1),
                    });
                    return;
                }
                const { op, d } = JSON.parse(message) as {
                    op: number;
                    d: Record<string, unknown>;
                };
                state.json.push({ op, d });
                if (op === 0) {
                    state.identifies.push(d);
                    send(ws, 2, {
                        ssrc,
                        ip: "127.0.0.1",
                        port: udp.port,
                        modes: options.modes ?? [
                            "aead_aes256_gcm_rtpsize",
                            "aead_xchacha20_poly1305_rtpsize",
                        ],
                    });
                } else if (op === 1) {
                    state.selects.push(d);
                    state.mode = (d.data as { mode: string }).mode;
                    send(ws, 4, {
                        mode: state.mode,
                        secret_key: [...key],
                        dave_protocol_version: options.daveVersion ?? 0,
                    });
                } else if (op === 3) {
                    state.heartbeats.push(d);
                    send(ws, 6, { t: d.t });
                } else if (op === 5) state.speaking.push(d);
                else if (op === 7) {
                    state.resumes.push(d);
                    send(ws, 9, null);
                }
            },
        },
    });

    return {
        url: `ws://127.0.0.1:${server.port}/?v=8`,
        endpoint: `127.0.0.1:${server.port}`,
        key,
        ssrc,
        state,
        /** Sends a JSON frame to the connected client. */
        json(op: number, d: unknown) {
            if (current) send(current, op, d);
        },
        /** Sends a binary (DAVE) frame: sequence, opcode, payload. */
        binary(op: number, payload: Uint8Array) {
            const frame = new Uint8Array(payload.length + 3);
            frame[0] = (++sequence >> 8) & 0xff;
            frame[1] = sequence & 0xff;
            frame[2] = op;
            frame.set(payload, 3);
            current?.send(frame);
        },
        /** Closes the client's voice WebSocket with `code`. */
        close(code: number, reason = "") {
            current?.close(code, reason);
        },
        /** Sends another user's audio to the client. */
        sendAudio(
            fromSsrc: number,
            frame: Uint8Array,
            seq: number,
            extension?: Uint8Array,
        ) {
            if (!state.client || !state.mode) throw new Error("no client yet");
            const header = new Uint8Array(12 + (extension ? 4 : 0));
            const view = new DataView(header.buffer);
            header[0] = extension ? 0x90 : 0x80;
            header[1] = 0x78;
            view.setUint16(2, seq);
            view.setUint32(4, seq * 960);
            view.setUint32(8, fromSsrc);
            let body = frame;
            if (extension) {
                // One-byte header extension (0xBEDE) with `extension.length / 4` words.
                view.setUint16(12, 0xbede);
                view.setUint16(14, extension.length / 4);
                body = Buffer.concat([extension, frame]);
            }
            const packet = encryptRtpsize(
                state.mode,
                key,
                header,
                body,
                serverCounter++,
            );
            udp.send(packet, state.client.port, state.client.address);
        },
        stop() {
            server.stop(true);
            udp.close();
        },
    };
}
