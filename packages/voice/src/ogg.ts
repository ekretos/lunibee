import { VoiceError } from "./protocol.js";

const CAPTURE = [0x4f, 0x67, 0x67, 0x53]; // "OggS"
const OPUS_HEAD = "OpusHead";
const OPUS_TAGS = "OpusTags";
/** Largest Ogg page: 27-byte header, 255 segment sizes, 255 segments of 255 bytes. */
const MAX_PAGE = 27 + 255 + 255 * 255;
/** Largest packet kept while it spans pages; an Opus packet is far smaller. */
const MAX_PACKET = 64 * 1024;

function startsWith(bytes: Uint8Array, text: string): boolean {
    if (bytes.length < text.length) return false;
    for (let i = 0; i < text.length; i++)
        if (bytes[i] !== text.charCodeAt(i)) return false;
    return true;
}

function findCapture(buffer: Uint8Array, from: number): number {
    for (let i = from; i + 4 <= buffer.length; i++)
        if (
            buffer[i] === CAPTURE[0] &&
            buffer[i + 1] === CAPTURE[1] &&
            buffer[i + 2] === CAPTURE[2] &&
            buffer[i + 3] === CAPTURE[3]
        )
            return i;
    return -1;
}

/**
 * Reads Opus packets out of an Ogg/Opus stream without decoding them (the
 * passthrough path: no Opus library, no re-encoding). Skips the OpusHead and
 * OpusTags headers. Memory is bounded by one page and one packet.
 * @throws {VoiceError} For an Ogg stream that is not 48 kHz Opus with at most two channels.
 */
export async function* demuxOggOpus(
    chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<Uint8Array> {
    let buffer: Uint8Array = new Uint8Array(0);
    let partial: Uint8Array[] = [];
    let partialSize = 0;
    let sawHead = false;
    /** Bytes read without finding any Ogg page. */
    let skipped = 0;

    const take = (bytes: Uint8Array): Uint8Array | undefined => {
        // A segment shorter than 255 bytes ends the packet.
        if (partial.length === 0) return bytes;
        partial.push(bytes);
        const out = new Uint8Array(partialSize + bytes.length);
        let offset = 0;
        for (const part of partial) {
            out.set(part, offset);
            offset += part.length;
        }
        partial = [];
        partialSize = 0;
        return out;
    };

    for await (const chunk of chunks) {
        const merged = new Uint8Array(buffer.length + chunk.length);
        merged.set(buffer, 0);
        merged.set(chunk, buffer.length);
        buffer = merged;
        let offset = 0;
        for (;;) {
            const start = findCapture(buffer, offset);
            if (start === -1) {
                // Keep a possible partial capture pattern for the next chunk.
                offset = Math.max(offset, buffer.length - 3);
                break;
            }
            if (buffer.length < start + 27) {
                offset = start;
                break;
            }
            const segments = buffer[start + 26]!;
            const dataStart = start + 27 + segments;
            if (buffer.length < dataStart) {
                offset = start;
                break;
            }
            let size = 0;
            for (let i = 0; i < segments; i++) size += buffer[start + 27 + i]!;
            if (buffer.length < dataStart + size) {
                offset = start;
                break;
            }
            let cursor = dataStart;
            for (let i = 0; i < segments; i++) {
                const length = buffer[start + 27 + i]!;
                const segment = buffer.slice(cursor, cursor + length);
                cursor += length;
                if (length === 255) {
                    partial.push(segment);
                    partialSize += length;
                    if (partialSize > MAX_PACKET)
                        throw new VoiceError(
                            "An Ogg packet is too large to be Opus audio.",
                        );
                    continue;
                }
                const packet = take(segment);
                if (!packet || packet.length === 0) continue;
                if (startsWith(packet, OPUS_HEAD)) {
                    const channels = packet[9] ?? 0;
                    if (channels < 1 || channels > 2)
                        throw new VoiceError(
                            `Unsupported Opus channel count: ${channels}.`,
                        );
                    sawHead = true;
                    continue;
                }
                if (startsWith(packet, OPUS_TAGS)) continue;
                if (!sawHead)
                    throw new VoiceError(
                        "The Ogg stream does not carry Opus audio.",
                    );
                yield packet;
            }
            offset = cursor;
        }
        if (!sawHead && findCapture(buffer, 0) === -1) skipped += offset;
        buffer = buffer.slice(offset);
        if (buffer.length > MAX_PAGE || skipped > MAX_PAGE)
            throw new VoiceError("The input is not an Ogg stream.");
    }
    if (!sawHead && (skipped > 0 || buffer.length > 0))
        throw new VoiceError("The input is not an Ogg/Opus stream.");
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let r = i << 24;
        for (let j = 0; j < 8; j++)
            r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
        table[i] = r >>> 0;
    }
    return table;
})();

function oggCrc(bytes: Uint8Array): number {
    let crc = 0;
    for (const byte of bytes)
        crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
    return crc;
}

/**
 * Writes Opus packets as an Ogg/Opus stream (48 kHz, stereo), which players
 * and FFmpeg read. Each packet counts as 20 ms (960 samples), as Discord sends.
 * Pages hold up to 50 packets (one second).
 */
export class OggOpusWriter {
    readonly #serial: number;
    #sequence = 0;
    #granule = 0n;
    #packets: Uint8Array[] = [];
    #lacing = 0;
    #ended = false;

    public constructor(serial = (Math.random() * 0x100000000) >>> 0) {
        this.#serial = serial;
    }

    /** The two header pages (OpusHead, OpusTags). Write them first. */
    public header(vendor = "lunibee"): Uint8Array {
        const head = new Uint8Array(19);
        head.set(new TextEncoder().encode(OPUS_HEAD));
        const view = new DataView(head.buffer);
        head[8] = 1; // version
        head[9] = 2; // channels
        view.setUint16(10, 0, true); // pre-skip
        view.setUint32(12, 48_000, true);
        const vendorBytes = new TextEncoder().encode(vendor);
        const tags = new Uint8Array(8 + 4 + vendorBytes.length + 4);
        tags.set(new TextEncoder().encode(OPUS_TAGS));
        const tagsView = new DataView(tags.buffer);
        tagsView.setUint32(8, vendorBytes.length, true);
        tags.set(vendorBytes, 12);
        return concat([
            this.#page([head], 0x02, 0n),
            this.#page([tags], 0, 0n),
        ]);
    }

    /** Adds one packet. @returns A page once 50 packets are buffered, else an empty array. */
    public write(packet: Uint8Array): Uint8Array {
        if (this.#ended) throw new VoiceError("The Ogg stream has ended.");
        const lacing = Math.floor(packet.length / 255) + 1;
        if (lacing > 255)
            throw new VoiceError("An Opus packet is too large for one page.");
        // A page has at most 255 segments: flush first when this one would not fit.
        const before = this.#lacing + lacing > 255 ? this.flush() : undefined;
        this.#packets.push(packet);
        this.#lacing += lacing;
        this.#granule += 960n;
        const after =
            this.#packets.length >= 50 ? this.flush() : new Uint8Array(0);
        return before ? concat([before, after]) : after;
    }

    /** Writes the buffered packets as a page (empty array when there are none). */
    public flush(): Uint8Array {
        if (this.#packets.length === 0) return new Uint8Array(0);
        const packets = this.#packets;
        this.#packets = [];
        this.#lacing = 0;
        return this.#page(packets, 0, this.#granule);
    }

    /** Writes the last page (end-of-stream flag). Further writes throw. */
    public end(): Uint8Array {
        if (this.#ended) return new Uint8Array(0);
        this.#ended = true;
        const packets = this.#packets;
        this.#packets = [];
        this.#lacing = 0;
        return this.#page(packets, 0x04, this.#granule);
    }

    #page(packets: Uint8Array[], flags: number, granule: bigint): Uint8Array {
        const lacing: number[] = [];
        for (const packet of packets) {
            let left = packet.length;
            while (left >= 255) {
                lacing.push(255);
                left -= 255;
            }
            lacing.push(left);
        }
        const body = concat(packets);
        const page = new Uint8Array(27 + lacing.length + body.length);
        const view = new DataView(page.buffer);
        page.set(CAPTURE);
        page[5] = flags;
        view.setBigUint64(6, granule, true);
        view.setUint32(14, this.#serial, true);
        view.setUint32(18, this.#sequence++, true);
        page[26] = lacing.length;
        page.set(lacing, 27);
        page.set(body, 27 + lacing.length);
        view.setUint32(22, oggCrc(page), true);
        return page;
    }
}

function concat(parts: Uint8Array[]): Uint8Array {
    let length = 0;
    for (const part of parts) length += part.length;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}
