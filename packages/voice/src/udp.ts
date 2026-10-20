import { VoiceError } from "./protocol.js";

/** The parts of a UDP socket {@link VoiceUdp} uses; `Bun.udpSocket` provides them. */
export interface UdpSocketLike {
    send(data: Uint8Array, port: number, address: string): boolean;
    close(): void;
}

/** Opens a UDP socket that calls `onData` for each datagram. Replace it in tests. */
export type UdpSocketFactory = (
    onData: (data: Uint8Array) => void,
) => Promise<UdpSocketLike>;

/** The default factory: an IPv4 `Bun.udpSocket` on an ephemeral port. */
export const bunUdpSocket: UdpSocketFactory = async (onData) =>
    (await Bun.udpSocket({
        socket: {
            data: (_socket, data) => onData(new Uint8Array(data)),
            // An ICMP "port unreachable" surfaces as ECONNREFUSED: the voice
            // server is gone or not there yet. Datagrams are best effort;
            // the gateway's heartbeat decides whether the session is alive.
            error: () => undefined,
        },
    })) as unknown as UdpSocketLike;

const KEEPALIVE_MS = 5_000;
const DISCOVERY_TIMEOUT_MS = 5_000;

/** Builds an IP discovery request (type 0x1, length 70) for `ssrc`. */
export function discoveryRequest(ssrc: number): Uint8Array {
    const packet = new Uint8Array(74);
    const view = new DataView(packet.buffer);
    view.setUint16(0, 1);
    view.setUint16(2, 70);
    view.setUint32(4, ssrc >>> 0);
    return packet;
}

/** Reads an IP discovery response (type 0x2): our external address and port. */
export function parseDiscoveryResponse(
    packet: Uint8Array,
): { ip: string; port: number } | undefined {
    if (packet.length !== 74) return undefined;
    const view = new DataView(
        packet.buffer,
        packet.byteOffset,
        packet.byteLength,
    );
    if (view.getUint16(0) !== 2 || view.getUint16(2) !== 70) return undefined;
    const end = packet.indexOf(0, 8);
    const ip = new TextDecoder().decode(
        packet.subarray(8, end === -1 || end > 72 ? 72 : end),
    );
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return undefined;
    return { ip, port: view.getUint16(72) };
}

/**
 * The voice UDP socket: sends audio to the voice server, receives other
 * users' audio, runs IP discovery and a keepalive every 5 s. `close()` ends
 * the socket and its timer; nothing is left open.
 */
export class VoiceUdp {
    readonly #socket: UdpSocketLike;
    readonly #ip: string;
    readonly #port: number;
    readonly #keepalive: ReturnType<typeof setInterval>;
    readonly #listeners = new Set<(packet: Uint8Array) => void>();
    /** Pending `discover()` calls, ended by `close()`. */
    readonly #discoveries = new Set<() => void>();
    #counter = 0;
    #closed = false;

    private constructor(socket: UdpSocketLike, ip: string, port: number) {
        this.#socket = socket;
        this.#ip = ip;
        this.#port = port;
        this.#keepalive = setInterval(
            () => this.#sendKeepalive(),
            KEEPALIVE_MS,
        );
        (this.#keepalive as { unref?: () => void }).unref?.();
    }

    /** Opens a socket towards the voice server at `ip:port`. */
    public static async open(
        ip: string,
        port: number,
        factory: UdpSocketFactory = bunUdpSocket,
    ): Promise<VoiceUdp> {
        let udp: VoiceUdp | undefined;
        const socket = await factory((data) => {
            if (udp) udp.#receive(data);
        });
        udp = new VoiceUdp(socket, ip, port);
        return udp;
    }

    /** Whether `close()` was called. */
    public get closed(): boolean {
        return this.#closed;
    }

    /** Listens for datagrams. @returns A function that removes the listener. */
    public onPacket(listener: (packet: Uint8Array) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    /** Sends one datagram to the voice server. @returns Whether it was handed to the socket. */
    public send(packet: Uint8Array): boolean {
        if (this.#closed) return false;
        try {
            return this.#socket.send(packet, this.#port, this.#ip);
        } catch {
            return false;
        }
    }

    /** Asks the voice server for our external address. @throws {VoiceError} On timeout or when closed. */
    public discover(
        ssrc: number,
        timeoutMs = DISCOVERY_TIMEOUT_MS,
    ): Promise<{ ip: string; port: number }> {
        return new Promise((resolve, reject) => {
            const settle = (
                error?: Error,
                found?: { ip: string; port: number },
            ): void => {
                clearTimeout(timer);
                remove();
                this.#discoveries.delete(abort);
                if (error) reject(error);
                else resolve(found!);
            };
            const abort = (): void =>
                settle(new VoiceError("The voice UDP socket is closed."));
            const timer = setTimeout(
                () => settle(new VoiceError("IP discovery timed out.")),
                timeoutMs,
            );
            const remove = this.onPacket((packet) => {
                const found = parseDiscoveryResponse(packet);
                if (found) settle(undefined, found);
            });
            this.#discoveries.add(abort);
            if (!this.send(discoveryRequest(ssrc))) abort();
        });
    }

    #sendKeepalive(): void {
        const packet = new Uint8Array(8);
        new DataView(packet.buffer).setUint32(0, this.#counter, true);
        this.#counter = (this.#counter + 1) >>> 0;
        this.send(packet);
    }

    #receive(data: Uint8Array): void {
        if (this.#closed) return;
        for (const listener of [...this.#listeners])
            try {
                listener(data);
            } catch {
                // A listener's failure must not stop the others.
            }
    }

    /** Closes the socket and stops the keepalive. Safe to call twice. */
    public close(): void {
        if (this.#closed) return;
        this.#closed = true;
        clearInterval(this.#keepalive);
        // A pending discovery ends now, not when its timer fires.
        for (const abort of [...this.#discoveries]) abort();
        this.#listeners.clear();
        try {
            this.#socket.close();
        } catch {
            // Already closed.
        }
    }
}
