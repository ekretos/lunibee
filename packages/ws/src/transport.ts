/**
 * The WebSocket a Gateway connection runs on.
 *
 * Owns socket construction, listener wiring, sending, closing, and replacement.
 * It is infrastructure, not Discord semantics: it never inspects an opcode, a
 * session, or a heartbeat. Frames go out as text and come back as text.
 */
import { createDecoder, type GatewayDecoder } from "./decoder.js";

/** Creates the underlying socket. Injected to support alternative runtimes. */
export type SocketFactory = (url: string) => WebSocket;

/** Callbacks a transport reports to its owner. */
export interface TransportHandlers {
    /** The socket opened and is ready to send. */
    onOpen: () => void;
    /** A complete frame arrived, already decompressed. */
    onFrame: (raw: string) => void;
    /** The socket closed. */
    onClose: (code: number, reason: string) => void;
    /** A socket or decoding failure. Not a close on its own. */
    onError: (error: Error) => void;
}

/** Outcome of opening a connection. */
export type ConnectResult = { ok: true } | { ok: false; error: Error };

/** Configuration for {@link WebSocketTransport}. */
export interface TransportOptions {
    /** Handlers for this transport's lifetime. */
    handlers: TransportHandlers;
    /** Frame decoder. Defaults to plain text, or zlib-stream when compressing. */
    decoder?: GatewayDecoder;
    /** Whether the connection negotiates `zlib-stream` compression. */
    compress?: boolean;
    /** Socket constructor. Defaults to the ambient `WebSocket`. */
    createSocket?: SocketFactory;
}

/** WebSocket states. Compared numerically so a stub needs no static constants. */
const CONNECTING = 0;
const OPEN = 1;

/**
 * A replaceable WebSocket connection.
 *
 * **Generations.** Each {@link connect} takes a generation, and every event is
 * checked against the current one. A socket that has been replaced still holds
 * its listeners and can still fire — especially a frame that finishes
 * decompressing after the swap — and every such event is dropped. The owner
 * therefore never has to ask "is this still my socket?".
 */
export class WebSocketTransport {
    readonly #handlers: TransportHandlers;
    readonly #decoder: GatewayDecoder;
    readonly #createSocket: SocketFactory;
    readonly #compress: boolean;
    #socket?: WebSocket;
    #generation = 0;
    /** Serialises decoding so stateful decoders never see interleaved chunks. */
    #queue: Promise<void> = Promise.resolve();

    public constructor(options: TransportOptions) {
        this.#handlers = options.handlers;
        this.#compress = options.compress ?? false;
        this.#decoder = options.decoder ?? createDecoder(options.compress);
        this.#createSocket =
            options.createSocket ?? ((url: string) => new WebSocket(url));
    }

    /** Whether a socket is open and able to send. */
    public get connected(): boolean {
        return this.#socket?.readyState === OPEN;
    }

    /** Whether a socket is connecting or open, and therefore still in play. */
    public get live(): boolean {
        return this.#socket !== undefined && this.#socket.readyState <= OPEN;
    }

    /** Current connection generation; increments on every {@link connect}. */
    public get generation(): number {
        return this.#generation;
    }

    /**
     * Opens a connection, replacing any existing one.
     *
     * A construction failure is returned rather than reported through
     * `onError`: the caller is mid-`connect` and must decide what the failure
     * means for the attempt it is running.
     */
    public connect(url: string): ConnectResult {
        // Never leave a predecessor behind: an orphan keeps its listeners and
        // would go on feeding this transport's owner.
        this.#discard(1000, "Superseded by a new connection");
        const generation = ++this.#generation;
        // A replaced connection's decoder state is meaningless to the new one.
        this.#decoder.reset();
        this.#queue = Promise.resolve();

        let socket: WebSocket;
        try {
            socket = this.#createSocket(url);
        } catch (error) {
            return { ok: false, error: this.#asError(error) };
        }
        if (this.#compress) {
            try {
                (socket as { binaryType?: string }).binaryType = "arraybuffer";
            } catch {
                // Runtimes that pin binaryType are handled by the decoder.
            }
        }
        this.#socket = socket;

        socket.addEventListener("open", () => {
            if (!this.#owns(generation)) return;
            this.#handlers.onOpen();
        });
        socket.addEventListener("message", (event) => {
            if (!this.#owns(generation)) return;
            // A decoder that answers synchronously is delivered synchronously:
            // an uncompressed frame must not become a microtask, because
            // dispatch timing is observable to consumers.
            let decoded: string[] | Promise<string[]>;
            try {
                decoded = this.#decoder.push(event.data);
            } catch (error) {
                this.#handlers.onError(this.#asError(error));
                return;
            }
            if (!(decoded instanceof Promise)) {
                for (const frame of decoded) this.#handlers.onFrame(frame);
                return;
            }
            // A stateful decoder must never see interleaved chunks, and the
            // generation is re-checked once the chunk is actually decoded: the
            // socket may have been replaced while this frame was in flight.
            this.#queue = this.#queue
                .then(async () => {
                    const frames = await decoded;
                    if (!this.#owns(generation)) return;
                    for (const frame of frames) this.#handlers.onFrame(frame);
                })
                .catch((error) => {
                    if (!this.#owns(generation)) return;
                    this.#handlers.onError(this.#asError(error));
                });
        });
        socket.addEventListener("close", (event) => {
            if (!this.#owns(generation)) return;
            this.#socket = undefined;
            // A closed socket owns nothing further. Retiring its generation
            // here is what makes every later event from it — a late frame, a
            // second close, an error — stale by construction, including a
            // frame that was still decompressing when the socket went away.
            this.#generation++;
            this.#decoder.reset();
            this.#handlers.onClose(event.code, event.reason ?? "");
        });
        socket.addEventListener("error", () => {
            if (!this.#owns(generation)) return;
            this.#handlers.onError(new Error("Gateway WebSocket error"));
        });
        return { ok: true };
    }

    /**
     * Writes a frame.
     * @returns Whether it reached the socket.
     */
    public send(data: string): boolean {
        if (!this.connected) return false;
        try {
            this.#socket!.send(data);
            return true;
        } catch (error) {
            this.#handlers.onError(this.#asError(error));
            return false;
        }
    }

    /** Closes the current socket, if any. Its `close` event still fires. */
    public close(code = 1000, reason = ""): void {
        const socket = this.#socket;
        if (!socket) return;
        try {
            socket.close(code, reason);
        } catch (error) {
            this.#handlers.onError(this.#asError(error));
        }
    }

    /**
     * Abandons the current socket without reporting its close.
     *
     * Used for a deliberate shutdown, where the owner has already decided the
     * connection is over and must not be woken by the resulting close event.
     */
    public destroy(code = 1000, reason = ""): void {
        this.#discard(code, reason);
        this.#decoder.reset();
    }

    /** Whether `generation` still owns this transport. */
    #owns(generation: number): boolean {
        return generation === this.#generation;
    }

    /** Detaches and closes the current socket without emitting its close. */
    #discard(code: number, reason: string): void {
        const socket = this.#socket;
        if (!socket) return;
        // Bumping the generation first makes every event this socket may still
        // fire — including a close caused by the call below — a stale event.
        this.#generation++;
        this.#socket = undefined;
        try {
            socket.close(code, reason);
        } catch (error) {
            this.#handlers.onError(this.#asError(error));
        }
    }

    #asError(error: unknown): Error {
        return error instanceof Error ? error : new Error(String(error));
    }
}
