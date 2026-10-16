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
