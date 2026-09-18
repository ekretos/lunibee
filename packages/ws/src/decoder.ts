/**
 * Turns WebSocket data into complete Gateway text frames.
 *
 * The contract is deliberately boring: bytes in, whole frames out. A decoder
 * knows nothing about opcodes, sessions, heartbeats or JSON validity — it only
 * knows when a frame is *complete*. Parsing the text is the protocol layer's
 * job, so malformed JSON is not a decoding failure; malformed *compressed
 * bytes* are.
 */
import {
    createInflate,
    constants as zlibConstants,
    type Inflate,
} from "node:zlib";

/** Decodes transport data into complete frames. */
export interface GatewayDecoder {
    /**
     * Feeds one WebSocket message.
     *
     * A decoder that can answer synchronously must do so: delivery timing is
     * observable to consumers, and an uncompressed frame has no reason to cost
     * a microtask.
     *
     * @returns Every frame completed by this chunk; empty while a frame is
     *   still arriving.
     */
    push(data: unknown): string[] | Promise<string[]>;
    /** Discards buffered state. Call when a connection is replaced. */
    reset(): void;
}

/** Normalises a binary WebSocket payload into bytes. */
async function toBytes(data: unknown): Promise<Uint8Array> {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof Blob !== "undefined" && data instanceof Blob)
        return new Uint8Array(await data.arrayBuffer());
    throw new TypeError(
        "Gateway returned an unsupported compressed frame type.",
    );
}

/** Passes text frames through unchanged, for an uncompressed connection. */
export class PlainTextDecoder implements GatewayDecoder {
    public push(data: unknown): string[] {
        return [String(data)];
    }
    public reset(): void {
        // Stateless: nothing to discard.
    }
}

/**
 * Decodes Discord's `zlib-stream` transport compression.
 *
 * Discord sends one zlib stream whose logical payloads are separated by the
 * `Z_SYNC_FLUSH` marker `00 00 FF FF`. A payload may span several WebSocket
 * messages, so output is produced only when that marker arrives: a partial
 * payload is retained rather than guessed at.
 *
 * The inflater carries state across frames, so `push` calls must not
 * interleave. {@link WebSocketTransport} serialises them by construction.
 */
export class ZlibStreamDecoder implements GatewayDecoder {
    readonly #create: () => Inflate;
    #inflate?: Inflate;
    #chunks: Uint8Array[] = [];
    #failure?: Error;
    /**
     * Rejector for the operation currently awaiting the inflater.
     *
     * zlib does **not** invoke a `write` or `flush` callback once the stream
     * has errored — it emits `error` and abandons the callback — so an
     * awaited callback alone hangs forever on corrupt input. The error handler
     * settles the waiter instead.
     */
    #pendingReject?: (error: Error) => void;

    /** @param create Inflater factory; injected in tests. */
    public constructor(create: () => Inflate = () => createInflate()) {
        this.#create = create;
    }

    /**
     * A text frame on a compressed connection is already a complete frame, so
     * it is returned synchronously and never touches the inflater. Discord
     * sends everything binary under `zlib-stream`; tolerating a string costs
     * nothing, and treating one as a decode failure — or delaying it by a
     * microtask — would both change observable behaviour.
     */
    public push(data: unknown): string[] | Promise<string[]> {
        if (typeof data === "string") return [data];
        return this.#inflateFrame(data);
    }

    async #inflateFrame(data: unknown): Promise<string[]> {
        const chunk = await toBytes(data);
        const inflate = (this.#inflate ??= this.#open());
        // A stream that has already failed cannot be trusted for any later
        // frame: its dictionary state is undefined from the error onwards.
        if (this.#failure) throw this.#failure;
        const complete =
            chunk.length >= 4 &&
            chunk[chunk.length - 4] === 0x00 &&
            chunk[chunk.length - 3] === 0x00 &&
            chunk[chunk.length - 2] === 0xff &&
            chunk[chunk.length - 1] === 0xff;

        await this.#awaiting((settle) =>
            inflate.write(chunk, (error) => (error ? settle(error) : settle())),
        );
        if (!complete) return [];

        await this.#awaiting((settle) =>
            inflate.flush(zlibConstants.Z_SYNC_FLUSH, () => settle()),
        );

        const parts = this.#chunks;
        this.#chunks = [];
        if (parts.length === 0) return [];
        const total = parts.reduce((size, part) => size + part.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) {
            merged.set(part, offset);
            offset += part.length;
        }
        return [new TextDecoder().decode(merged)];
    }

    public reset(): void {
        const inflate = this.#inflate;
        this.#inflate = undefined;
        this.#chunks = [];
        this.#failure = undefined;
        this.#pendingReject = undefined;
        if (!inflate) return;
        inflate.removeAllListeners();
        try {
            inflate.close();
        } catch {
            // Closing a stream that already failed is not itself a failure.
        }
    }

    /**
     * Runs one inflater operation, failing it if the stream errors meanwhile.
     */
    #awaiting(
        run: (settle: (error?: Error | null) => void) => void,
    ): Promise<void> {
        if (this.#failure) return Promise.reject(this.#failure);
        return new Promise<void>((resolve, reject) => {
            this.#pendingReject = reject;
            run((error) => {
                this.#pendingReject = undefined;
                if (error) reject(error);
                else if (this.#failure) reject(this.#failure);
                else resolve();
            });
        });
    }

    #open(): Inflate {
        const inflate = this.#create();
        inflate.on("data", (chunk: Uint8Array) => this.#chunks.push(chunk));
        inflate.on("error", (error: Error) => {
            this.#failure = error;
            // Settle whatever is waiting: zlib will not call its callback.
            const reject = this.#pendingReject;
            this.#pendingReject = undefined;
            reject?.(error);
        });
        return inflate;
    }
}

/** Creates the decoder a connection needs. */
export function createDecoder(compress: boolean | undefined): GatewayDecoder {
    return compress ? new ZlibStreamDecoder() : new PlainTextDecoder();
}
