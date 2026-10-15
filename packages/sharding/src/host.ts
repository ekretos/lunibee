import type { ChildProcess } from "node:child_process";
import { fork } from "node:child_process";
import {
    KILL_SIGNALS,
    REMOTE_PROTOCOL_VERSION,
    RemoteClose,
    HOST_ID,
    isLoopbackHost,
    parseToHost,
    signChallenge,
    type ToCoordinator,
} from "./remote-protocol.js";

/** Options for a {@link ClusterHost}. */
export interface ClusterHostOptions {
    /** The coordinator's address: `wss://host:port`. `ws://` is accepted for this machine, or anywhere with `allowInsecure`. */
    url: string;
    /** Connect with `ws://` to a coordinator on another machine, over a network you fully trust. Default false. */
    allowInsecure?: boolean;
    /** The coordinator's shared secret. */
    secret: string;
    /** This host's ID: letters, digits, `.`, `_`, `-`. Must be unique in the deployment. */
    id: string;
    /**
     * The worker script this host runs for every cluster. A coordinator cannot
     * choose it: remote workers run only what the host owner configured.
     */
    script: string;
    /** Starts a worker process. Defaults to `child_process.fork()`. */
    fork?: (
        script: string,
        env: Record<string, string | undefined>,
    ) => ChildProcess;
    /** First delay before reconnecting, in ms. Default 1000. */
    reconnectDelay?: number;
    /** Longest delay between reconnect attempts, in ms. Default 30,000. */
    maxReconnectDelay?: number;
}

/** What a {@link ClusterHost} emits. */
export interface ClusterHostEvents {
    /** The coordinator accepted this host. */
    connected: [];
    /** The connection ended. Every worker was killed first. */
    disconnected: [info: { code: number; reason: string }];
    /** A worker started for a cluster. */
    clusterSpawn: [cluster: number];
    /** A worker exited. */
    clusterExit: [cluster: number, code: number | null, signal: string | null];
    /** A refused frame, a failed start or a rejected connection. */
    error: [error: Error];
}

interface Running {
    epoch: number;
    child: ChildProcess;
}

/**
 * The agent that makes a machine part of a deployment. It connects to the
 * coordinator, starts the worker script for the clusters the coordinator
 * places here, and relays their IPC frames both ways. The coordinator's
 * `ClusterManager` supervises those workers exactly like local ones.
 *
 * Fencing: when the connection closes, or the coordinator stays silent for a
 * whole lease, the host kills every worker at once. The coordinator waits
 * longer than that before it restarts the clusters elsewhere, so a shard is
 * never owned in two places.
 */
export class ClusterHost {
    readonly #options: ClusterHostOptions;
    readonly #running = new Map<number, Running>();
    readonly #listeners = new Map<
        keyof ClusterHostEvents,
        Set<(...args: never[]) => void>
    >();
    #socket?: WebSocket;
    #lease = 15_000;
    #lastRx = 0;
    #watchdog?: ReturnType<typeof setInterval>;
    #retry?: ReturnType<typeof setTimeout>;
    #delay: number;
    #closed = true;
    #connected = false;
    #firstConnect?: { resolve: () => void; reject: (error: Error) => void };

    public constructor(options: ClusterHostOptions) {
        if (!HOST_ID.test(options.id))
            throw new RangeError(
                "id must be 1-64 letters, digits, '.', '_' or '-'.",
            );
        if (!options.secret || options.secret.length < 16)
            throw new RangeError("secret must be at least 16 characters.");
        if (!options.script?.trim())
            throw new TypeError("A worker script path is required.");
        let url: URL;
        try {
            url = new URL(options.url);
        } catch {
            throw new TypeError("url must be an absolute ws:// or wss:// URL.");
        }
        if (url.protocol !== "ws:" && url.protocol !== "wss:")
            throw new TypeError("url must start with ws:// or wss://.");
        if (url.username || url.password)
            throw new TypeError("url must not contain credentials.");
        if (
            url.protocol === "ws:" &&
            !options.allowInsecure &&
            !isLoopbackHost(url.hostname)
        )
            throw new TypeError(
                "url must use wss:// to reach another machine (allowInsecure: true overrides this for a network you fully trust).",
            );
        this.#options = options;
        this.#delay = options.reconnectDelay ?? 1000;
    }

    /** Whether the coordinator has accepted this host and the link is open. */
    public get connected(): boolean {
        return this.#connected;
    }

    /** Cluster IDs running on this host. */
    public clusters(): number[] {
        return [...this.#running.keys()].sort((a, b) => a - b);
    }

    /** Listens for a host event. @returns This host. */
    public on<E extends keyof ClusterHostEvents>(
        event: E,
        listener: (...args: ClusterHostEvents[E]) => void,
    ): this {
        let set = this.#listeners.get(event);
        if (!set) this.#listeners.set(event, (set = new Set()));
        set.add(listener as never);
        return this;
    }

    /** Stops listening for a host event. @returns This host. */
    public off<E extends keyof ClusterHostEvents>(
        event: E,
        listener: (...args: ClusterHostEvents[E]) => void,
    ): this {
        this.#listeners.get(event)?.delete(listener as never);
        return this;
    }

    #emit<E extends keyof ClusterHostEvents>(
        event: E,
        ...args: ClusterHostEvents[E]
    ): void {
        for (const listener of this.#listeners.get(event) ?? [])
            try {
                (listener as (...a: ClusterHostEvents[E]) => void)(...args);
            } catch {
                // A faulty listener must not disturb the host.
            }
    }

    /**
     * Connects and resolves once the coordinator accepts this host. After
     * that, a lost connection is retried with backoff until {@link close}.
     * @throws {Error} If the first attempt is refused (bad secret, unknown or duplicate ID).
     */
    public connect(): Promise<void> {
        if (!this.#closed) return Promise.resolve();
        this.#closed = false;
        return new Promise<void>((resolve, reject) => {
            this.#firstConnect = { resolve, reject };
            this.#open();
        });
    }

    /** Kills every worker, closes the connection and stops reconnecting. */
    public close(): Promise<void> {
        this.#closed = true;
        if (this.#retry) clearTimeout(this.#retry);
        this.#retry = undefined;
        this.#fence();
        if (this.#watchdog) clearInterval(this.#watchdog);
        this.#watchdog = undefined;
        this.#connected = false;
        const socket = this.#socket;
        this.#socket = undefined;
        this.#firstConnect?.reject(new Error("The host was closed."));
        this.#firstConnect = undefined;
        if (!socket || socket.readyState === WebSocket.CLOSED)
            return Promise.resolve();
        return new Promise<void>((resolve) => {
            socket.addEventListener("close", () => resolve(), { once: true });
            try {
                socket.close(1000, "Host closed.");
            } catch {
                resolve();
            }
        });
    }

    #open(): void {
        const socket = new WebSocket(this.#options.url);
        this.#socket = socket;
        socket.addEventListener("message", (event) =>
            this.#message(socket, event.data),
        );
        socket.addEventListener("error", () => {
            // The close event that follows carries the outcome.
        });
        socket.addEventListener("close", (event) => {
            if (this.#socket === socket) this.#lost(event.code, event.reason);
        });
    }

    #send(socket: WebSocket, message: ToCoordinator): boolean {
        if (socket.readyState !== WebSocket.OPEN) return false;
        try {
            socket.send(JSON.stringify(message));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * A spawn this host will not run (an environment variable outside the
     * allowlist, say) is answered with an error, so the coordinator fails the
     * cluster at once instead of waiting for it to start.
     */
    #refuseSpawn(socket: WebSocket, data: unknown): void {
        if (typeof data !== "string" || data.length > 65_536) return;
        let frame: { t?: unknown; cluster?: unknown; epoch?: unknown };
        try {
            frame = JSON.parse(data) as typeof frame;
        } catch {
            return;
        }
        if (
            frame?.t !== "spawn" ||
            !Number.isInteger(frame.cluster) ||
            !Number.isInteger(frame.epoch)
        )
            return;
        this.#send(socket, {
            t: "error",
            cluster: frame.cluster as number,
            epoch: frame.epoch as number,
            message:
                "This host refused the spawn request (malformed or not allowed).",
        });
    }

    #message(socket: WebSocket, data: unknown): void {
        if (this.#socket !== socket) return;
        const message = parseToHost(data);
        if (!message) {
            this.#emit(
                "error",
                new Error("The coordinator sent a malformed frame."),
            );
            this.#refuseSpawn(socket, data);
            return;
        }
        this.#lastRx = Date.now();
        switch (message.t) {
            case "challenge":
                if (message.version !== REMOTE_PROTOCOL_VERSION) {
                    socket.close(
                        RemoteClose.VersionMismatch,
                        "Protocol version mismatch.",
                    );
                    return;
                }
                this.#send(socket, {
                    t: "hello",
                    id: this.#options.id,
                    mac: signChallenge(
                        this.#options.secret,
                        message.nonce,
                        this.#options.id,
                    ),
                    version: REMOTE_PROTOCOL_VERSION,
                });
                return;
            case "welcome":
                this.#lease = message.leaseMs;
                this.#connected = true;
                this.#delay = this.#options.reconnectDelay ?? 1000;
                this.#startWatchdog();
                this.#firstConnect?.resolve();
                this.#firstConnect = undefined;
                this.#emit("connected");
                return;
            case "ping":
                this.#send(socket, { t: "pong", n: message.n });
                return;
            case "bye":
                this.#fence();
                return;
            case "spawn":
                this.#spawn(
                    socket,
                    message.cluster,
                    message.epoch,
                    message.env,
                );
                return;
            case "frame": {
                const run = this.#running.get(message.cluster);
                if (run?.epoch === message.epoch && run.child.connected)
                    try {
                        run.child.send(message.frame as never);
                    } catch {
                        // The worker is exiting; its exit event reports it.
                    }
                return;
            }
            case "kill": {
                const run = this.#running.get(message.cluster);
                if (
                    run?.epoch === message.epoch &&
                    KILL_SIGNALS.has(message.signal)
                )
                    try {
                        run.child.kill(message.signal as NodeJS.Signals);
                    } catch {
                        // Already gone.
                    }
                return;
            }
        }
    }

    #spawn(
        socket: WebSocket,
        cluster: number,
        epoch: number,
        env: Record<string, string>,
    ): void {
        const reply = (message: ToCoordinator): void => {
            if (this.#socket === socket) this.#send(socket, message);
        };
        if (this.#running.has(cluster)) {
            reply({
                t: "error",
                cluster,
                epoch,
                message: `Cluster ${cluster} is already running here.`,
            });
            return;
        }
        let child: ChildProcess;
        try {
            const forkWorker = this.#options.fork ?? defaultFork;
            child = forkWorker(this.#options.script, {
                ...process.env,
                ...env,
            });
        } catch (error) {
            reply({
                t: "error",
                cluster,
                epoch,
                message: error instanceof Error ? error.message : String(error),
            });
            return;
        }
        this.#running.set(cluster, { epoch, child });
        child.on("message", (frame) =>
            reply({ t: "frame", cluster, epoch, frame }),
        );
        child.once("exit", (code, signal) => {
            if (this.#running.get(cluster)?.child === child)
                this.#running.delete(cluster);
            this.#emit("clusterExit", cluster, code, signal);
            reply({ t: "exit", cluster, epoch, code, signal });
        });
        child.on("error", (error) =>
            this.#emit(
                "error",
                error instanceof Error ? error : new Error(String(error)),
            ),
        );
        reply({
            t: "spawned",
            cluster,
            epoch,
            ...(child.pid ? { pid: child.pid } : {}),
        });
        this.#emit("clusterSpawn", cluster);
    }

    /** Kills every worker now. Used whenever the coordinator might consider the host gone. */
    #fence(): void {
        for (const { child } of [...this.#running.values()])
            try {
                child.kill("SIGKILL");
            } catch {
                // Already gone.
            }
    }

    #startWatchdog(): void {
        if (this.#watchdog) clearInterval(this.#watchdog);
        this.#lastRx = Date.now();
        this.#watchdog = setInterval(
            () => {
                if (Date.now() - this.#lastRx > this.#lease) {
                    this.#fence();
                    // Closing triggers the reconnect path.
                    this.#socket?.close(
                        RemoteClose.HostLost,
                        "Coordinator silent.",
                    );
                }
            },
            Math.max(10, Math.floor(this.#lease / 3)),
        );
        (this.#watchdog as { unref?: () => void }).unref?.();
    }

    #lost(code: number, reason: string): void {
        if (this.#watchdog) clearInterval(this.#watchdog);
        this.#watchdog = undefined;
        this.#socket = undefined;
        const wasConnected = this.#connected;
        this.#connected = false;
        this.#fence();
        if (wasConnected) this.#emit("disconnected", { code, reason });
        if (this.#closed) return;
        const refused =
            code === RemoteClose.AuthFailed ||
            code === RemoteClose.UnknownHost ||
            code === RemoteClose.DuplicateHost ||
            code === RemoteClose.VersionMismatch;
        const first = this.#firstConnect;
        if (first) {
            this.#firstConnect = undefined;
            this.#closed = true;
            first.reject(
                new Error(
                    `The coordinator refused this host (${code}${reason ? `: ${reason}` : ""}).`,
                ),
            );
            return;
        }
        if (refused)
            this.#emit(
                "error",
                new Error(
                    `The coordinator refused this host (${code}: ${reason}).`,
                ),
            );
        const wait = Math.round(this.#delay * (1 + Math.random() * 0.2));
        this.#delay = Math.min(
            this.#options.maxReconnectDelay ?? 30_000,
            this.#delay * 2,
        );
        this.#retry = setTimeout(() => {
            this.#retry = undefined;
            if (!this.#closed) this.#open();
        }, wait);
    }
}

function defaultFork(
    script: string,
    env: Record<string, string | undefined>,
): ChildProcess {
    return fork(script, [], { env: env as NodeJS.ProcessEnv });
}
