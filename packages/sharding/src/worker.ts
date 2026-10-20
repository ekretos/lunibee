import { readClusterContext, type ClusterContext } from "./context.js";
import type { WorkerReport } from "./health.js";
import { CLUSTER_FRAME, parseParentFrame } from "./protocol.js";
import { threadEndpoint } from "./thread.js";

/** Asks for the right to IDENTIFY, and gives it back. */
export interface IdentifyGate {
    /** Resolves when `shardId` may IDENTIFY now. Rejects if the parent refuses or goes away. */
    acquire(shardId: number): Promise<void>;
    /** `shardId` has sent its IDENTIFY. */
    release(shardId: number): void;
}

/** The part of `process` a worker uses. */
export interface WorkerEndpoint {
    send?(message: unknown): unknown;
    on(event: string, listener: (...args: never[]) => void): unknown;
    off(event: string, listener: (...args: never[]) => void): unknown;
}

type RequestHandler = (data: unknown) => unknown;

/**
 * The worker side of a cluster. It tells the parent when the process is
 * ready, answers the parent's requests, and asks the parent for IDENTIFY
 * slots. `ShardManager` uses it automatically inside a cluster; use it
 * directly when you run your own Gateways.
 */
export class ClusterWorker {
    static #current: ClusterWorker | undefined;

    /** The worker of this process, or `undefined` when it was not forked by a `ClusterManager`. */
    public static current(): ClusterWorker | undefined {
        if (!ClusterWorker.#current) {
            const context = readClusterContext();
            const endpoint =
                typeof process.send === "function"
                    ? (process as unknown as WorkerEndpoint)
                    : threadEndpoint();
            if (context && endpoint)
                ClusterWorker.#current = new ClusterWorker(context, endpoint);
        }
        return ClusterWorker.#current;
    }

    /** Forgets the process-wide worker (tests). */
    public static reset(): void {
        ClusterWorker.#current?.close();
        ClusterWorker.#current = undefined;
    }

    public readonly context: ClusterContext;
    readonly #endpoint: WorkerEndpoint;
    readonly #handlers = new Map<string, RequestHandler>();
    readonly #waiting = new Map<
        number,
        { resolve: () => void; reject: (error: Error) => void }
    >();
    readonly #onMessage: (frame: unknown) => void;
    readonly #onDisconnect: () => void;
    #counter = 0;
    #closed = false;

    public constructor(
        context: ClusterContext,
        endpoint: WorkerEndpoint = process as unknown as WorkerEndpoint,
        options: {
            /**
             * Exit when the parent's IPC channel closes. Without a parent
             * nothing coordinates IDENTIFY or fences this process, and its
             * Gateway sessions would keep running beside a replacement.
             * Default: true for the real process, false for an injected endpoint.
             */
            exitOnParentLoss?: boolean;
            /** Replaces `process.exit`; for tests. */
            exit?: (code: number) => void;
        } = {},
    ) {
        if (typeof endpoint.send !== "function")
            throw new Error(
                "ClusterWorker needs an IPC channel: run it in a process forked by ClusterManager.",
            );
        this.context = context;
        this.#endpoint = endpoint;
        this.#onMessage = (frame) => this.#handle(frame);
        const exitOnLoss =
            options.exitOnParentLoss ??
            endpoint === (process as unknown as WorkerEndpoint);
        const exit = options.exit ?? ((code: number) => process.exit(code));
        this.#onDisconnect = () => {
            this.#failAll("The parent went away.");
            if (exitOnLoss && !this.#closed) exit(1);
        };
        endpoint.on("message", this.#onMessage);
        endpoint.on("disconnect", this.#onDisconnect);
    }

    /** The gate to use when the parent coordinates IDENTIFY, otherwise `undefined`. */
    public get identifyGate(): IdentifyGate | undefined {
        return this.context.coordinatedIdentify ? this.#gate : undefined;
    }

    readonly #gate: IdentifyGate = {
        acquire: (shardId) => {
            if (this.#closed)
                return Promise.reject(
                    new Error("The cluster worker is closed."),
                );
            const id = ++this.#counter;
            return new Promise<void>((resolve, reject) => {
                this.#waiting.set(id, { resolve, reject });
                const error = this.#send({ kind: "identify", id, shardId });
                if (error) {
                    this.#waiting.delete(id);
                    reject(error);
                }
            });
        },
        release: (shardId) => this.#send({ kind: "identify-done", shardId }),
    };

    /** Tells the parent every shard of this process finished its handshake. */
    public ready(shardIds: readonly number[] = this.context.shardIds): void {
        this.#send({ kind: "ready", shardIds: [...shardIds] });
    }

    /** Pushes a health report to the parent without being asked. */
    public reportHealth(report: WorkerReport): void {
        this.#send({ kind: "health", report });
    }

    /**
     * Answers requests of `type` sent with `ClusterManager.requestCluster()`.
     * The return value (or thrown error) goes back to the caller.
     */
    public onRequest(type: string, handler: RequestHandler): this {
        if (!type.trim() || typeof handler !== "function")
            throw new TypeError("A request type and handler are required.");
        this.#handlers.set(type, handler);
        return this;
    }

    /** Stops listening and rejects pending IDENTIFY requests. */
    public close(): void {
        this.#closed = true;
        this.#endpoint.off("message", this.#onMessage);
        this.#endpoint.off("disconnect", this.#onDisconnect);
        this.#failAll("The cluster worker closed.");
    }

    /** @returns The error when the frame could not be sent. */
    #send(body: Record<string, unknown>): Error | undefined {
        try {
            this.#endpoint.send!({ [CLUSTER_FRAME]: body });
            return undefined;
        } catch (thrown) {
            const error =
                thrown instanceof Error ? thrown : new Error(String(thrown));
            // Only a closed channel ends every wait. A frame that cannot be
            // serialized (a BigInt under JSON IPC) fails on its own.
            const endpoint = this.#endpoint as { connected?: boolean };
            if (
                endpoint.connected === false ||
                (error as { code?: unknown }).code === "ERR_IPC_CHANNEL_CLOSED"
            )
                this.#failAll(error.message);
            return error;
        }
    }

    #failAll(reason: string): void {
        for (const waiter of this.#waiting.values())
            waiter.reject(new Error(reason));
        this.#waiting.clear();
    }

    #handle(frame: unknown): void {
        if (!frame || typeof frame !== "object" || !(CLUSTER_FRAME in frame))
            return;
        const parsed = parseParentFrame(
            (frame as Record<string, unknown>)[CLUSTER_FRAME],
        );
        if (!parsed) return;
        if (
            parsed.kind === "identify-grant" ||
            parsed.kind === "identify-deny"
        ) {
            const waiter = this.#waiting.get(parsed.id);
            if (!waiter) return;
            this.#waiting.delete(parsed.id);
            if (parsed.kind === "identify-grant") waiter.resolve();
            else waiter.reject(new Error(parsed.error));
            return;
        }
        const handler = this.#handlers.get(parsed.type);
        const id = parsed.id;
        if (!handler) {
            this.#send({
                kind: "reply",
                id,
                error: `No handler for "${parsed.type}".`,
            });
            return;
        }
        void (async () => {
            try {
                const failed = this.#send({
                    kind: "reply",
                    id,
                    result: await handler(parsed.data),
                });
                // Answer anyway, so the caller sees why instead of a timeout.
                if (failed)
                    this.#send({
                        kind: "reply",
                        id,
                        error: `The reply could not be sent: ${failed.message}`,
                    });
            } catch (error) {
                this.#send({
                    kind: "reply",
                    id,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
            }
        })();
    }
}
