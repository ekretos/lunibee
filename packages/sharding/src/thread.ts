import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
    isMainThread,
    parentPort,
    Worker,
    workerData,
    type ResourceLimits,
} from "node:worker_threads";

/** Marks the `workerData` of a cluster that runs as a thread. */
const THREAD_MARKER = "__lunibeeClusterThread";

/**
 * A cluster running as a worker thread, shaped like the `ChildProcess` that
 * `ClusterManager` supervises: frames travel with `postMessage`, and `kill()`
 * terminates the thread (a thread cannot run a signal handler, so `SIGTERM`
 * ends it at once, like a process without a handler).
 */
class ThreadChild extends EventEmitter {
    public readonly pid: number;
    public exitCode: number | null = null;
    public signalCode: NodeJS.Signals | null = null;
    public connected = true;
    readonly #worker: Worker;
    #signal?: NodeJS.Signals;

    public constructor(worker: Worker) {
        super();
        this.#worker = worker;
        this.pid = worker.threadId;
        worker.on("message", (frame: unknown) => this.emit("message", frame));
        worker.on("error", (error: unknown) => this.emit("error", error));
        worker.once("exit", (code: number) => {
            this.connected = false;
            if (this.#signal) {
                this.signalCode = this.#signal;
                this.emit("exit", null, this.#signal);
            } else {
                this.exitCode = code;
                this.emit("exit", code, null);
            }
        });
    }

    public send(frame: unknown): boolean {
        if (!this.connected) return false;
        try {
            this.#worker.postMessage(frame);
            return true;
        } catch {
            return false;
        }
    }

    public kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
        if (!this.connected) return false;
        this.#signal ??= signal;
        void this.#worker.terminate();
        return true;
    }
}

/** Options for {@link threadFork}. */
export interface ThreadForkOptions {
    /** Heap limits for each cluster thread (`worker_threads` `resourceLimits`). */
    resourceLimits?: ResourceLimits;
}

/**
 * Runs each cluster as a worker thread of the manager's process instead of a
 * forked process: pass it as `ClusterManager`'s `fork`. Threads start faster
 * and use less memory; a crash that takes the process down (an out-of-memory
 * abort, a native fault) takes every cluster with it. The worker script is the
 * same: `ShardManager`, `ShardBus` and `ClusterWorker` find the parent through
 * `parentPort`.
 */
export function threadFork(
    options: ThreadForkOptions = {},
): (script: string, env: Record<string, string | undefined>) => ChildProcess {
    return (script, env) => {
        const defined: Record<string, string> = {};
        for (const [key, value] of Object.entries(env))
            if (value !== undefined) defined[key] = value;
        const worker = new Worker(script, {
            env: defined,
            workerData: { [THREAD_MARKER]: true },
            ...(options.resourceLimits
                ? { resourceLimits: options.resourceLimits }
                : {}),
        });
        return new ThreadChild(worker) as unknown as ChildProcess;
    };
}

/** The parent link of a cluster thread: the part of `process` a worker uses. */
export interface ThreadEndpoint {
    send(message: unknown): boolean;
    on(event: string, listener: (...args: never[]) => void): ThreadEndpoint;
    off(event: string, listener: (...args: never[]) => void): ThreadEndpoint;
}

let endpoint: ThreadEndpoint | undefined;

/** The parent link when this code runs in a cluster thread started by {@link threadFork}, otherwise `undefined`. */
export function threadEndpoint(): ThreadEndpoint | undefined {
    const port = parentPort;
    if (
        isMainThread ||
        !port ||
        !(workerData as Record<string, unknown> | null)?.[THREAD_MARKER]
    )
        return undefined;
    endpoint ??= portEndpoint(port);
    return endpoint;
}

/** Wraps a message port as a worker endpoint. @internal */
export function portEndpoint(port: {
    postMessage(message: unknown): void;
    on(event: "message", listener: (frame: unknown) => void): unknown;
    off(event: "message", listener: (frame: unknown) => void): unknown;
}): ThreadEndpoint {
    const wrapped: ThreadEndpoint = {
        send: (message) => {
            port.postMessage(message);
            return true;
        },
        // Only messages cross a thread boundary; `disconnect` never fires.
        on: (event, listener) => {
            if (event === "message")
                port.on("message", listener as (frame: unknown) => void);
            return wrapped;
        },
        off: (event, listener) => {
            if (event === "message")
                port.off("message", listener as (frame: unknown) => void);
            return wrapped;
        },
    };
    return wrapped;
}
