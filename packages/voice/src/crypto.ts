import { createCipheriv, createDecipheriv, getCiphers } from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { RTP_OPUS_PAYLOAD_TYPE, VoiceError } from "./protocol.js";

/** Transport encryption modes this package implements. */
export type VoiceEncryptionMode =
    "aead_aes256_gcm_rtpsize" | "aead_xchacha20_poly1305_rtpsize";

const TAG_BYTES = 16;
const NONCE_SUFFIX_BYTES = 4;

/** Modes in order of preference: AES-GCM when the runtime has it, XChaCha20-Poly1305 always. */
export const SUPPORTED_ENCRYPTION_MODES: readonly VoiceEncryptionMode[] =
    getCiphers().includes("aes-256-gcm")
        ? ["aead_aes256_gcm_rtpsize", "aead_xchacha20_poly1305_rtpsize"]
        : ["aead_xchacha20_poly1305_rtpsize"];

/** Picks the first mode in our preference order that the voice server offers. @throws {VoiceError} If none is offered. */
export function chooseEncryptionMode(
    offered: readonly string[],
): VoiceEncryptionMode {
    const mode = SUPPORTED_ENCRYPTION_MODES.find((m) => offered.includes(m));
    if (!mode)
        throw new VoiceError(
            `No supported voice encryption mode offered (got: ${offered.join(", ") || "none"}).`,
        );
    return mode;
}

/** A parsed RTP packet header. */
export interface RtpHeader {
    version: number;
    padding: boolean;
    extension: boolean;
    payloadType: number;
    sequence: number;
    timestamp: number;
    ssrc: number;
    /** Bytes authenticated but not encrypted: the fixed header, CSRCs and the extension header. */
    headerSize: number;
    /** 32-bit words of extension data, encrypted with the payload. */
    extensionWords: number;
}

/** Writes the 12-byte RTP header Discord expects for an outgoing Opus packet. */
export function rtpHeader(
    sequence: number,
    timestamp: number,
    ssrc: number,
): Uint8Array {
    const header = new Uint8Array(12);
    const view = new DataView(header.buffer);
    header[0] = 0x80;
    header[1] = RTP_OPUS_PAYLOAD_TYPE;
    view.setUint16(2, sequence & 0xffff);
    view.setUint32(4, timestamp >>> 0);
    view.setUint32(8, ssrc >>> 0);
    return header;
}

/** Parses an RTP header, or returns `undefined` for anything that is not a complete RTP v2 header. */
export function parseRtpHeader(packet: Uint8Array): RtpHeader | undefined {
    if (packet.length < 12) return undefined;
    const view = new DataView(
        packet.buffer,
        packet.byteOffset,
        packet.byteLength,
    );
    const first = packet[0]!;
    const version = first >> 6;
    if (version !== 2) return undefined;
    const extension = (first & 0x10) !== 0;
    let headerSize = 12 + (first & 0x0f) * 4;
    let extensionWords = 0;
    if (extension) {
        if (packet.length < headerSize + 4) return undefined;
        extensionWords = view.getUint16(headerSize + 2);
        headerSize += 4;
    }
    if (packet.length < headerSize) return undefined;
    return {
        version,
        padding: (first & 0x20) !== 0,
        extension,
        payloadType: packet[1]! & 0x7f,
        sequence: view.getUint16(2),
        timestamp: view.getUint32(4),
        ssrc: view.getUint32(8),
        headerSize,
        extensionWords,
    };
}

/**
 * Seals and opens RTP packets for one voice session ("rtpsize" AEAD modes):
 * the RTP header (and extension header) is authenticated, the rest is
 * encrypted, and a 32-bit nonce counter is appended to the packet. The full
 * nonce is that counter followed by zeros (12 bytes for AES-GCM, 24 for
 * XChaCha20-Poly1305).
 */
export class PacketCipher {
    public readonly mode: VoiceEncryptionMode;
    readonly #key: Uint8Array;
    #counter = 0;

    /** @param counter First nonce counter (default 0). */
    public constructor(
        mode: VoiceEncryptionMode,
        key: Uint8Array,
        counter = 0,
    ) {
        if (key.length !== 32)
            throw new VoiceError("The voice secret key must be 32 bytes.");
        if (!SUPPORTED_ENCRYPTION_MODES.includes(mode))
            throw new VoiceError(`Unsupported voice encryption mode: ${mode}`);
        this.mode = mode;
        this.#key = Uint8Array.from(key);
        this.#counter = counter >>> 0;
    }

    /** The nonce counter of the next sealed packet (wraps at 2^32). */
    public get counter(): number {
        return this.#counter;
    }

    #nonce(suffix: Uint8Array): Uint8Array {
        const nonce = new Uint8Array(
            this.mode === "aead_aes256_gcm_rtpsize" ? 12 : 24,
        );
        nonce.set(suffix, 0);
        return nonce;
    }

    /** Encrypts `payload` under `header`. @returns The datagram: header, ciphertext, tag, nonce suffix. */
    public seal(header: Uint8Array, payload: Uint8Array): Uint8Array {
        const suffix = new Uint8Array(NONCE_SUFFIX_BYTES);
        new DataView(suffix.buffer).setUint32(0, this.#counter);
        this.#counter = (this.#counter + 1) >>> 0;
        const nonce = this.#nonce(suffix);
        let sealed: Uint8Array;
        if (this.mode === "aead_aes256_gcm_rtpsize") {
            const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
            cipher.setAAD(header);
            const body = Buffer.concat([
                cipher.update(payload),
                cipher.final(),
            ]);
            sealed = Buffer.concat([body, cipher.getAuthTag()]);
        } else
            sealed = xchacha20poly1305(this.#key, nonce, header).encrypt(
                payload,
            );
        const out = new Uint8Array(
            header.length + sealed.length + NONCE_SUFFIX_BYTES,
        );
        out.set(header, 0);
        out.set(sealed, header.length);
        out.set(suffix, header.length + sealed.length);
        return out;
    }

    /**
     * Decrypts a received datagram. Removes the encrypted extension data and
     * RTP padding. @returns The header and the plaintext payload, or
     * `undefined` when the packet is malformed or fails authentication.
     */
    public open(
        packet: Uint8Array,
    ): { header: RtpHeader; payload: Uint8Array } | undefined {
        const header = parseRtpHeader(packet);
        if (!header) return undefined;
        const bodyEnd = packet.length - NONCE_SUFFIX_BYTES;
        const tagStart = bodyEnd - TAG_BYTES;
        if (tagStart < header.headerSize) return undefined;
        const aad = packet.subarray(0, header.headerSize);
        const nonce = this.#nonce(packet.subarray(bodyEnd));
        let plain: Uint8Array;
        try {
            if (this.mode === "aead_aes256_gcm_rtpsize") {
                const decipher = createDecipheriv(
                    "aes-256-gcm",
                    this.#key,
                    nonce,
                );
                decipher.setAAD(aad);
                decipher.setAuthTag(packet.subarray(tagStart, bodyEnd));
                plain = Buffer.concat([
                    decipher.update(
                        packet.subarray(header.headerSize, tagStart),
                    ),
                    decipher.final(),
                ]);
            } else
                plain = xchacha20poly1305(this.#key, nonce, aad).decrypt(
                    packet.subarray(header.headerSize, bodyEnd),
                );
        } catch {
            return undefined;
        }
        if (header.padding && plain.length > 0) {
            const pad = plain[plain.length - 1]!;
            if (pad > plain.length) return undefined;
            plain = plain.subarray(0, plain.length - pad);
        }
        const skip = header.extensionWords * 4;
        if (skip > plain.length) return undefined;
        return { header, payload: plain.subarray(skip) };
    }
}
