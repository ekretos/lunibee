import { GatewayHeartbeat } from "@lunibee/ws";
import { VOICE_GATEWAY_VERSION, VoiceOpcodes } from "./protocol.js";

/** A JSON voice gateway frame. */
export interface VoicePacket {
    op: number;
    d?: unknown;
    seq?: number;
}

/** A binary voice gateway frame (DAVE): sequence, opcode and payload. */
export interface VoiceBinaryPacket {
    seq: number;
    op: number;
    payload: Uint8Array;
}

/** The parts of a WebSocket {@link VoiceGateway} uses; the global `WebSocket` provides them. */
export interface VoiceSocketLike {
    binaryType: string;
    readonly readyState: number;
    send(data: string | Uint8Array): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: string, listener: (event: never) => void): void;
}

/** Opens a WebSocket. Replace it in tests. */
export type VoiceSocketFactory = (url: string) => VoiceSocketLike;

/** The default factory: the runtime's global `WebSocket`. */
export const globalVoiceSocket: VoiceSocketFactory = (url) =>
    new WebSocket(url) as unknown as VoiceSocketLike;

/** What a {@link VoiceGateway} reports to its owner. */
export interface VoiceGatewayHandlers {
    open(): void;
    packet(packet: VoicePacket): void;
    binary(packet: VoiceBinaryPacket): void;
    close(code: number, reason: string): void;
    error(error: Error): void;
}

/** Client close code for missed heartbeat ACKs: below 4000, so the session resumes. */
export const HEARTBEAT_TIMEOUT_CLOSE = 3001;

/** Builds the voice gateway URL for an endpoint from VOICE_SERVER_UPDATE. */
export function voiceGatewayURL(endpoint: string): string {
    const host = endpoint.replace(/^wss?:\/\//, "").replace(/\/.*$/, "");
    return `wss://${host}/?v=${VOICE_GATEWAY_VERSION}`;
}

/**
 * One voice gateway WebSocket (v8). Parses JSON and binary frames, tracks the
 * last sequence for `seq_ack`, and heartbeats with `@lunibee/ws`'s
 * {@link GatewayHeartbeat} (an unanswered heartbeat closes with
 * {@link HEARTBEAT_TIMEOUT_CLOSE}, which the owner resumes).
 */
export class VoiceGateway {
    /** The last sequence number received, `-1` before any. Sent back as `seq_ack`. */
    public sequence: number;
    readonly #socket: VoiceSocketLike;
    readonly #handlers: VoiceGatewayHandlers;
    readonly #heartbeat: GatewayHeartbeat;
    #closed = false;

    public constructor(
        url: string,
        handlers: VoiceGatewayHandlers,
        options: { factory?: VoiceSocketFactory; sequence?: number } = {},
    ) {
        this.sequence = options.sequence ?? -1;
        this.#handlers = handlers;
        this.#socket = (options.factory ?? globalVoiceSocket)(url);
        this.#socket.binaryType = "arraybuffer";
        this.#heartbeat = new GatewayHeartbeat({
            ackTimeout: 15_000,
            zombieTimeout: 60_000,
            sequence: () => this.sequence,
            isConnected: () => this.#socket.readyState === 1,
            send: () =>
                this.sendJSON({
                    op: VoiceOpcodes.Heartbeat,
                    d: { t: Date.now(), seq_ack: this.sequence },
                }),
            onTimeout: () =>
                this.close(HEARTBEAT_TIMEOUT_CLOSE, "Heartbeat timed out."),
            onError: (error) => this.#handlers.error(error),
        });
        this.#socket.addEventListener("open", () => {
            this.#heartbeat.watch();
            this.#handlers.open();
        });
        this.#socket.addEventListener("message", (event: { data: unknown }) =>
            this.#message(event.data),
        );
        this.#socket.addEventListener("error", () => {
            // The close event that follows carries the outcome.
        });
        this.#socket.addEventListener(
            "close",
            (event: { code: number; reason: string }) => {
                this.#heartbeat.stop();
                // A close we started was already reported (or was a normal one).
                if (this.#closed) return;
                this.#closed = true;
                this.#handlers.close(event.code, event.reason ?? "");
            },
        );
    }

    /** Round trip of the last heartbeat, or -1. */
    public get ping(): number {
        return this.#heartbeat.latency;
    }

    #message(data: unknown): void {
        this.#heartbeat.receivedMessage();
        if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
            const bytes =
                data instanceof Uint8Array ? data : new Uint8Array(data);
            if (bytes.length < 3) return;
            const seq = (bytes[0]! << 8) | bytes[1]!;
            this.sequence = seq;
            this.#handlers.binary({
                seq,
                op: bytes[2]!,
                payload: bytes.subarray(3),
            });
            return;
        }
        if (typeof data !== "string") return;
        let packet: VoicePacket;
        try {
            packet = JSON.parse(data) as VoicePacket;
        } catch {
            this.#handlers.error(
                new Error("The voice gateway sent invalid JSON."),
            );
            return;
        }
        if (!packet || typeof packet.op !== "number") return;
        if (typeof packet.seq === "number") this.sequence = packet.seq;
        if (packet.op === VoiceOpcodes.Hello) {
            const interval = (packet.d as { heartbeat_interval?: number })
                ?.heartbeat_interval;
            if (typeof interval === "number" && interval > 0)
                this.#heartbeat.start(interval);
        } else if (packet.op === VoiceOpcodes.HeartbeatAck)
            this.#heartbeat.acknowledge();
        this.#handlers.packet(packet);
    }

    /** Sends a JSON frame. @returns Whether the socket was open. */
    public sendJSON(packet: VoicePacket): boolean {
        if (this.#socket.readyState !== 1) return false;
        try {
            this.#socket.send(JSON.stringify(packet));
            return true;
        } catch {
            return false;
        }
    }

    /** Sends a binary frame: the opcode byte followed by the payload. */
    public sendBinary(op: number, payload: Uint8Array): boolean {
        if (this.#socket.readyState !== 1) return false;
        const frame = new Uint8Array(payload.length + 1);
        frame[0] = op;
        frame.set(payload, 1);
        try {
            this.#socket.send(frame);
            return true;
        } catch {
            return false;
        }
    }

    /** Closes the socket and stops heartbeating. A `1000` close is not reported back. */
    public close(code = 1000, reason = ""): void {
        this.#heartbeat.stop();
        const reported = this.#closed;
        this.#closed = true;
        try {
            this.#socket.close(code, reason);
        } catch {
            // Already closing.
        }
        // A non-normal close we initiate is reported as such, so the owner can resume.
        if (!reported && code !== 1000) this.#handlers.close(code, reason);
    }
}
