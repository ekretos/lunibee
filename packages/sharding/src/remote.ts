import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import type { Server, ServerWebSocket } from "bun";
import {
    HOST_ID,
    MAX_REMOTE_FRAME_BYTES,
    isLoopbackHost,
    REMOTE_PROTOCOL_VERSION,
    RemoteClose,
    parseToCoordinator,
    verifyChallenge,
    type ToHost,
} from "./remote-protocol.js";

/** Where, and how, a coordinator listens for hosts. */
export interface RemoteOptions {
    /** TCP port. `0` picks a free one (read it from `ClusterManager#remotePort`). */
    port: number;
    /**
     * Interface to bind. Default `127.0.0.1`, which only this machine can
     * reach. Any other address needs `tls` or `allowInsecure`.
     */
    hostname?: string;
    /** Shared secret, at least 16 characters. Hosts prove they know it; it never crosses the wire. */
    secret: string;
    /** TLS for `wss://`. Required to listen on a non-loopback address unless `allowInsecure` is set. */
    tls?: { cert: string; key: string };
    /**
     * Listen on a non-loopback address without TLS: frames (shard messages
     * and worker output) travel unencrypted and unsigned. Only for a network
     * you fully trust, or when a TLS proxy in front terminates the connection.
     * Default false.
     */
    allowInsecure?: boolean;
    /**
     * The host IDs that make up the deployment. Clusters are placed on them in
     * this order, and an unlisted host is refused. Without it, the hosts that
     * have joined when `spawn()` starts are used, sorted by ID.
     */
    hosts?: string[];
    /** How many hosts must join before clusters are placed when `hosts` is not set. Default 1. */
    minHosts?: number;
    /** Milliseconds to wait for the hosts to join before `spawn()` fails. Default 60,000. */
    joinTimeout?: number;
    /**
     * Fencing lease in milliseconds. A host that hears nothing from the
     * coordinator for this long kills its workers; the coordinator waits twice
     * as long before it treats the host as lost and restarts its clusters, so
     * a shard never runs in two places. Default 15,000.
     */
    lease?: number;
    /** Milliseconds a new connection has to authenticate before it is closed. Default 3,000. */
    helloTimeout?: number;
    /**
     * Most connections that may be waiting to authenticate at once. When full,
     * the one that has waited longest is closed to make room: a host answers
     * the challenge within a round trip, a connection that holds a slot idle
     * does not. Default 16.
     */
    maxUnauthenticated?: number;
    /** The same limit for one client address (see `clientAddress`). Default 4. */
    maxUnauthenticatedPerAddress?: number;
    /** New connections one client address may open per second; more are refused. Default 10. */
    connectionsPerSecond?: number;
    /**
     * The client address the per-address limits count by. Default: the peer
     * address of the TCP connection. Behind a TLS proxy every peer is the
     * proxy, so return the client address the proxy forwards (only from a
     * header your proxy sets and overwrites).
     */
    clientAddress?: (request: Request, peer: string | undefined) => string;
    /** Also run clusters on the coordinator's own machine. Default false: clusters run on the hosts only. */
    local?: boolean;
}

/** A host as the coordinator sees it. */
export interface HostStatus {
    id: string;
    /** Whether its socket is open and answering. */
    connected: boolean;
    /** When it last sent anything (epoch ms). */
    lastSeen: number;
    /** Clusters currently running on it. */
    clusters: number[];
}

interface SocketData {
    nonce: string;
    /** The client address the per-address limits count by. */
    address: string;
    id?: string;
    /** Whether this socket is counted among the pending (unauthenticated) ones. */
    counted?: boolean;
    helloTimer?: ReturnType<typeof setTimeout>;
}

interface Link {
    id: string;
    ws: ServerWebSocket<SocketData>;
    lastSeen: number;
    children: Map<number, RemoteChild>;
}

type Kill = (signal: string) => boolean;

/** What the coordinator wants to hear about its hosts. */
export interface RemoteHooks {
    join(id: string): void;
    leave(id: string, reason: string): void;
    error(error: Error): void;
}

/**
 * A worker process on another host, shaped like the `ChildProcess` that
 * `ClusterManager` supervises. `send()` and `kill()` travel to the host's
 * agent; its messages and exit travel back, so the manager's restart,
 * IDENTIFY, routing and health logic needs no special case for it.
 */
export class RemoteChild extends EventEmitter {
    public pid: number | undefined;
    public exitCode: number | null = null;
    public signalCode: NodeJS.Signals | null = null;
    public connected = true;

    readonly #send: (frame: unknown) => boolean;
    readonly #kill: Kill;

    public constructor(
        public readonly host: string,
        public readonly cluster: number,
        public readonly epoch: number,
        send: (frame: unknown) => boolean,
        kill: Kill,
    ) {
        super();
        this.#send = send;
        this.#kill = kill;
    }

    /** Sends an IPC frame to the worker. */
    public send(frame: unknown): boolean {
        return this.connected &&
            this.exitCode === null &&
            this.signalCode === null
            ? this.#send(frame)
            : false;
    }

    /** Asks the host to signal the worker; the exit arrives as an event. */
    public kill(signal: string = "SIGTERM"): boolean {
        if (this.exitCode !== null || this.signalCode !== null) return false;
        return this.#kill(signal);
    }

    /** The agent says the worker started. */
    public spawned(pid: number | undefined): void {
        this.pid = pid;
    }

    /** The worker sent a message. */
    public deliver(frame: unknown): void {
        if (this.exitCode === null && this.signalCode === null)
            this.emit("message", frame);
    }

    /** The worker exited, or its host was lost. Emits `exit` once. */
    public finish(code: number | null, signal: string | null): void {
        if (this.exitCode !== null || this.signalCode !== null) return;
        this.connected = false;
        // `exitCode` and `signalCode` must not both stay null once finished.
        this.exitCode = code ?? (signal === null ? 1 : null);
        this.signalCode = (signal as NodeJS.Signals | null) ?? null;
        this.emit("exit", code, signal);
    }
}

/** The coordinator's listener and the hosts that joined it. */
export class RemoteHosts {
    readonly #options: Required<
        Pick<RemoteOptions, "port" | "secret" | "lease">
    > &
        RemoteOptions;
    readonly #links = new Map<string, Link>();
    readonly #waiters = new Set<{ check(): void; abort(error: Error): void }>();
    readonly #hooks: RemoteHooks;
    #server?: Server<SocketData>;
    #watchdog?: ReturnType<typeof setInterval>;
    #epoch = 0;
    #ping = 0;
    /** Sockets that have not said hello yet, oldest first. */
    readonly #pending = new Set<ServerWebSocket<SocketData>>();
    /** Pending sockets per client address. */
    readonly #pendingByAddress = new Map<string, number>();
    /** Connection allowance per client address (token buckets). */
    readonly #rates = new Map<string, { tokens: number; at: number }>();

    public constructor(options: RemoteOptions, hooks: RemoteHooks) {
        if (typeof options.secret !== "string" || options.secret.length < 16)
            throw new RangeError(
                "remote.secret must be a string of at least 16 characters.",
            );
        if (
            !Number.isInteger(options.port) ||
            options.port < 0 ||
            options.port > 65535
        )
            throw new RangeError(
                "remote.port must be an integer from 0 to 65535.",
            );
        if (
            options.tls &&
            (typeof options.tls.cert !== "string" ||
                typeof options.tls.key !== "string" ||
                !options.tls.cert ||
                !options.tls.key)
        )
            throw new TypeError("remote.tls needs a non-empty cert and key.");
        if (
            !options.tls &&
            !options.allowInsecure &&
            !isLoopbackHost(options.hostname ?? "127.0.0.1")
        )
            throw new RangeError(
                "remote listens on a network address without TLS: set remote.tls, bind 127.0.0.1 behind a TLS proxy, or set remote.allowInsecure for a network you fully trust.",
            );
        const lease = options.lease ?? 15_000;
        if (!Number.isFinite(lease) || lease < 30)
            throw new RangeError(
                "remote.lease must be at least 30 milliseconds.",
            );
        for (const id of options.hosts ?? [])
            if (!HOST_ID.test(id))
                throw new RangeError(`"${id}" is not a valid host ID.`);
        if (
            options.hosts &&
            (options.hosts.length === 0 ||
                new Set(options.hosts).size !== options.hosts.length)
        )
            throw new RangeError("remote.hosts must be unique and not empty.");
        if (
            options.minHosts !== undefined &&
            (!Number.isInteger(options.minHosts) || options.minHosts < 1)
        )
            throw new RangeError("remote.minHosts must be a positive integer.");
        this.#options = { ...options, lease };
        this.#hooks = hooks;
    }

    /** The port in use, once started. */
    public get port(): number | undefined {
        return this.#server?.port;
    }

    /** Host IDs that are connected now, sorted. */
    public connected(): string[] {
        return [...this.#links.keys()].sort();
    }

    /** Opens the listener. Safe to call twice. */
    public start(): void {
        if (this.#server) return;
        const { port, hostname, tls, lease } = this.#options;
        this.#server = Bun.serve<SocketData>({
            port,
            hostname: hostname ?? "127.0.0.1",
            ...(tls ? { tls } : {}),
            fetch: (request, server) => {
                const peer = server.requestIP(request)?.address;
                const address =
                    this.#options.clientAddress?.(request, peer) ??
                    peer ??
                    "unknown";
                // Refused before the upgrade: the cheapest answer to a flood.
                if (!this.#allowConnection(address))
                    return new Response("Too many connections.", {
                        status: 429,
                    });
                if (
                    server.upgrade(request, {
                        data: {
                            nonce: randomBytes(16).toString("hex"),
                            address,
                        },
                    })
                )
                    return undefined;
                return new Response("Lunibee cluster coordinator", {
                    status: 426,
                });
            },
            websocket: {
                maxPayloadLength: MAX_REMOTE_FRAME_BYTES,
                idleTimeout: 0,
                open: (ws) => this.#open(ws),
                message: (ws, raw) => this.#message(ws, raw),
                close: (ws, _code, reason) => this.#closed(ws, reason),
            },
        });
        const pingMs = Math.max(10, Math.floor(lease / 3));
        this.#watchdog = setInterval(() => this.#tick(), pingMs);
        (this.#watchdog as { unref?: () => void }).unref?.();
    }

    /** Closes the listener and every host connection. */
    public stop(): void {
        if (this.#watchdog) clearInterval(this.#watchdog);
        this.#watchdog = undefined;
        for (const link of [...this.#links.values()]) {
            this.#post(link, { t: "bye", reason: "The coordinator stopped." });
            this.#drop(link, "The coordinator stopped.", RemoteClose.Shutdown);
        }
        void this.#server?.stop(true);
        this.#server = undefined;
        this.abortWaits();
    }

    /** Resolves when the given hosts (or `count` hosts) are connected. @throws {Error} On timeout. */
    public waitFor(
        hosts: readonly string[] | undefined,
        count: number,
        timeoutMs: number,
    ): Promise<void> {
        const done = (): boolean =>
            hosts
                ? hosts.every((id) => this.#links.has(id))
                : this.#links.size >= count;
        if (done()) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            const waiter = {
                check: (): void => {
                    if (!done()) return;
                    clearTimeout(timer);
                    this.#waiters.delete(waiter);
                    resolve();
                },
                abort: (error: Error): void => {
                    clearTimeout(timer);
                    this.#waiters.delete(waiter);
                    reject(error);
                },
            };
            const timer = setTimeout(() => {
                const missing = hosts?.filter((id) => !this.#links.has(id));
                waiter.abort(
                    new Error(
                        hosts
                            ? `Hosts did not join within ${timeoutMs}ms: [${missing}].`
                            : `Only ${this.#links.size} of ${count} hosts joined within ${timeoutMs}ms.`,
                    ),
                );
            }, timeoutMs);
            this.#waiters.add(waiter);
        });
    }

    /** Fails everything waiting for hosts to join (a shutdown). */
    public abortWaits(): void {
        for (const waiter of [...this.#waiters])
            waiter.abort(new Error("The coordinator stopped."));
    }

    /** Hosts and the clusters running on them. */
    public status(declared: readonly string[] = []): HostStatus[] {
        const ids = new Set([...declared, ...this.#links.keys()]);
        return [...ids].sort().map((id) => {
            const link = this.#links.get(id);
            return {
                id,
                connected: link !== undefined,
                lastSeen: link?.lastSeen ?? 0,
                clusters: link
                    ? [...link.children.keys()].sort((a, b) => a - b)
                    : [],
            };
        });
    }

    /**
     * Starts a worker on `hostId`. If the host is not connected the returned
     * child exits at once, which `ClusterManager` handles like a crash.
     */
    public createChild(
        hostId: string,
        cluster: number,
        env: Record<string, string>,
    ): ChildProcess {
        const epoch = ++this.#epoch;
        const link = this.#links.get(hostId);
        const child = new RemoteChild(
            hostId,
            cluster,
            epoch,
            (frame) =>
                link !== undefined &&
                this.#post(link, { t: "frame", cluster, epoch, frame }),
            (signal) =>
                link !== undefined &&
                this.#post(link, { t: "kill", cluster, epoch, signal }),
        );
        if (!link) {
            queueMicrotask(() => child.finish(null, "SIGHUP"));
            return child as unknown as ChildProcess;
        }
        link.children.get(cluster)?.finish(null, "SIGKILL");
        link.children.set(cluster, child);
        if (!this.#post(link, { t: "spawn", cluster, epoch, env }))
            queueMicrotask(() => child.finish(null, "SIGHUP"));
        return child as unknown as ChildProcess;
    }

    #post(link: Link, message: ToHost): boolean {
        try {
            return link.ws.send(JSON.stringify(message)) > 0;
        } catch {
            return false;
        }
    }

    /** Takes one connection from the address's per-second allowance. */
    #allowConnection(address: string): boolean {
        const rate = this.#options.connectionsPerSecond ?? 10;
        const now = Date.now();
        let bucket = this.#rates.get(address);
        if (!bucket) {
            bucket = { tokens: rate, at: now };
            this.#rates.set(address, bucket);
            // A bounded map: forget the address idle longest.
            if (this.#rates.size > 10_000)
                this.#rates.delete(this.#rates.keys().next().value as string);
        }
        bucket.tokens = Math.min(
            rate,
            bucket.tokens + ((now - bucket.at) / 1000) * rate,
        );
        bucket.at = now;
        if (bucket.tokens < 1) return false;
        bucket.tokens--;
        return true;
    }

    /** Closes a pending socket to make room for a newer one. */
    #evict(victim: ServerWebSocket<SocketData>): void {
        this.#uncount(victim);
        clearTimeout(victim.data.helloTimer);
        victim.close(RemoteClose.TooManyConnections, "Too many connections.");
    }

    #open(ws: ServerWebSocket<SocketData>): void {
        // An address at its limit gives up its oldest pending socket, then
        // the whole listener does: a connection that holds a slot without
        // answering cannot keep a host that answers at once from joining.
        const address = ws.data.address;
        if (
            (this.#pendingByAddress.get(address) ?? 0) >=
            (this.#options.maxUnauthenticatedPerAddress ?? 4)
        )
            for (const other of this.#pending)
                if (other.data.address === address) {
                    this.#evict(other);
                    break;
                }
        if (this.#pending.size >= (this.#options.maxUnauthenticated ?? 16)) {
            const oldest = this.#pending.values().next().value;
            if (oldest) this.#evict(oldest);
        }
        this.#pending.add(ws);
        this.#pendingByAddress.set(
            address,
            (this.#pendingByAddress.get(address) ?? 0) + 1,
        );
        ws.data.counted = true;
        ws.data.helloTimer = setTimeout(
            () => ws.close(RemoteClose.HelloTimeout, "No hello."),
            this.#options.helloTimeout ?? 3_000,
        );
        ws.send(
            JSON.stringify({
                t: "challenge",
                nonce: ws.data.nonce,
                version: REMOTE_PROTOCOL_VERSION,
            } satisfies ToHost),
        );
    }

    #message(ws: ServerWebSocket<SocketData>, raw: string | Buffer): void {
        if (typeof raw !== "string") {
            ws.close(RemoteClose.BadRequest, "Text frames only.");
            return;
        }
        const message = parseToCoordinator(raw);
        if (!message) {
            ws.close(RemoteClose.BadRequest, "Malformed frame.");
            return;
        }
        if (ws.data.id === undefined) {
            this.#hello(ws, message);
            return;
        }
        const link = this.#links.get(ws.data.id);
        if (!link || link.ws !== ws) return;
        link.lastSeen = Date.now();
        if (message.t === "pong" || message.t === "hello") return;
        const child = link.children.get(message.cluster);
        // A frame from an earlier process of the same cluster is stale.
        if (!child || child.epoch !== message.epoch) return;
        switch (message.t) {
            case "spawned":
                child.spawned(message.pid);
                break;
            case "frame":
                child.deliver(message.frame);
                break;
            case "exit":
                link.children.delete(message.cluster);
                child.finish(message.code, message.signal);
                break;
            case "error":
                this.#hooks.error(
                    new Error(
                        `Host ${link.id} could not run cluster ${message.cluster}: ${message.message}`,
                    ),
                );
                link.children.delete(message.cluster);
                child.finish(1, null);
                break;
        }
    }

    #hello(
        ws: ServerWebSocket<SocketData>,
        message: ReturnType<typeof parseToCoordinator>,
    ): void {
        if (message?.t !== "hello") {
            ws.close(RemoteClose.BadRequest, "Expected hello.");
            return;
        }
        const { id } = message;
        if (message.version !== REMOTE_PROTOCOL_VERSION) {
            ws.close(RemoteClose.VersionMismatch, "Protocol version mismatch.");
            return;
        }
        if (
            !HOST_ID.test(id) ||
            !verifyChallenge(
                this.#options.secret,
                ws.data.nonce,
                id,
                message.mac,
            )
        ) {
            ws.close(RemoteClose.AuthFailed, "Authentication failed.");
            return;
        }
        if (this.#options.hosts && !this.#options.hosts.includes(id)) {
            ws.close(
                RemoteClose.UnknownHost,
                "Host is not part of this deployment.",
            );
            return;
        }
        if (this.#links.has(id)) {
            ws.close(
                RemoteClose.DuplicateHost,
                "A host with this ID is connected.",
            );
            return;
        }
        clearTimeout(ws.data.helloTimer);
        this.#uncount(ws);
        ws.data.id = id;
        const link: Link = {
            id,
            ws,
            lastSeen: Date.now(),
            children: new Map(),
        };
        this.#links.set(id, link);
        const lease = this.#options.lease;
        this.#post(link, {
            t: "welcome",
            leaseMs: lease,
            pingMs: Math.max(10, Math.floor(lease / 3)),
        });
        this.#hooks.join(id);
        for (const waiter of [...this.#waiters]) waiter.check();
    }

    #uncount(ws: ServerWebSocket<SocketData>): void {
        if (!ws.data.counted) return;
        ws.data.counted = false;
        this.#pending.delete(ws);
        const left = (this.#pendingByAddress.get(ws.data.address) ?? 1) - 1;
        if (left > 0) this.#pendingByAddress.set(ws.data.address, left);
        else this.#pendingByAddress.delete(ws.data.address);
    }

    #closed(ws: ServerWebSocket<SocketData>, reason: string): void {
        clearTimeout(ws.data.helloTimer);
        this.#uncount(ws);
        const link = ws.data.id ? this.#links.get(ws.data.id) : undefined;
        if (link && link.ws === ws)
            this.#drop(link, reason || "The connection closed.");
    }

    /** Forgets a host and ends every worker it ran. */
    #drop(link: Link, reason: string, code?: number): void {
        if (this.#links.get(link.id) !== link) return;
        this.#links.delete(link.id);
        if (code !== undefined)
            try {
                link.ws.close(code, reason.slice(0, 100));
            } catch {
                // Already closed.
            }
        for (const child of [...link.children.values()])
            child.finish(null, "SIGHUP");
        link.children.clear();
        this.#hooks.leave(link.id, reason);
    }

    #tick(): void {
        const now = Date.now();
        for (const link of [...this.#links.values()]) {
            // The host fences itself after one lease of silence; the
            // coordinator waits for a second before it lets anything restart.
            if (now - link.lastSeen > this.#options.lease * 2) {
                this.#drop(
                    link,
                    "The host stopped answering.",
                    RemoteClose.HostLost,
                );
                continue;
            }
            this.#post(link, { t: "ping", n: ++this.#ping });
        }
    }
}
