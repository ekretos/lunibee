/** A JSON value as decoded from a frame. */
export type FrameValue =
    | string
    | number
    | boolean
    | null
    | FrameValue[]
    | { [key: string]: FrameValue };

/** A decoded Gateway frame the client sent. */
export interface SentFrame {
    op: number;
    d: { [key: string]: FrameValue };
}

/** The subset of DOM socket events the Gateway transport reads. */
export interface FakeSocketEvent {
    data?: string | ArrayBufferLike;
    code?: number;
    reason?: string;
}

type Listener = (event: FakeSocketEvent) => void;

/**
 * In-memory stand-in for the global `WebSocket`. Install it with
 * {@link installWebSocket} and drive it with {@link open}, {@link receive}
 * and {@link close}.
 */
export class FakeWebSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];
    readonly url: string;
    readyState = 0;
    binaryType = "blob";
    sent: string[] = [];
    closeCode?: number;
    closeReason?: string;
    closeCalls: Array<{ code: number; reason: string }> = [];
    readonly #listeners = new Map<string, Set<Listener>>();

    constructor(url: string) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }

    addEventListener(event: string, listener: Listener): void {
        let listeners = this.#listeners.get(event);
        if (!listeners) this.#listeners.set(event, (listeners = new Set()));
        listeners.add(listener);
    }

    send(data: string): void {
        if (this.readyState !== FakeWebSocket.OPEN)
            throw new Error("socket is not open");
        this.sent.push(data);
    }

    close(code = 1000, reason = ""): void {
        this.closeCode = code;
        this.closeReason = reason;
        this.closeCalls.push({ code, reason });
        if (this.readyState === FakeWebSocket.CLOSED) return;
        this.readyState = FakeWebSocket.CLOSED;
        this.emit("close", { code, reason });
    }

    open(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", {});
    }

    /** Delivers `payload` as a JSON text frame. */
    receive(payload: object): void {
        this.emit("message", { data: JSON.stringify(payload) });
    }

    /** Delivers a Gateway dispatch (op 0). */
    dispatch(event: string, data: object, sequence: number): void {
        this.receive({ op: 0, t: event, s: sequence, d: data });
    }

    emit(event: string, value: FakeSocketEvent): void {
        for (const listener of this.#listeners.get(event) ?? [])
            listener(value);
    }

    /** Frames sent on this socket, decoded. */
    payloads(): SentFrame[] {
        return this.sent.map((raw): SentFrame => JSON.parse(raw));
    }
}

/** Any constructor the Gateway can call as `new WebSocket(url)`. */
export type SocketConstructor = new (url: string) => object;

/**
 * Replaces `globalThis.WebSocket` with a test double and returns the original.
 * The double implements only what the Gateway uses, hence the cast.
 */
export function installWebSocket(socket: SocketConstructor): typeof WebSocket {
    const original = globalThis.WebSocket;
    globalThis.WebSocket = socket as unknown as typeof WebSocket;
    return original;
}
