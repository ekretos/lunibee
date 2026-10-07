import { defaultTransport, type ShardBusTransport } from "./transport.js";

/** Message envelope exchanged between Lunibee shards. */
export interface ShardMessage<T = unknown> {
    /** Sending shard ID. */
    source: number;
    /** Target shard ID, or null for broadcast. */
    target: number | null;
    /** Application message type. */
    type: string;
    /** Message payload. */
    data: T;
    /** Unique message ID. */
    id: string;
    /** Set on requests that expect a reply (see {@link ShardBus.request}). */
    expectsReply?: boolean;
}
/** A reply collected by {@link ShardBus.broadcastRequest}. */
export interface ShardReply<R = unknown> {
    /** Replying shard ID. */
    shardId: number;
    /** Handler result, when it succeeded. */
    result?: R;
    /** Handler error message, when it failed. */
    error?: string;
}
/** Internal reply envelope type. */
const REPLY_TYPE = "__lunibee:reply";
/** Payload carried by a reply envelope. */
type ReplyPayload = { requestId: string; result?: unknown; error?: string };
/** Handler invoked for shard messages. @typeParam T Message payload type. */
export type ShardMessageHandler<T = unknown> = (
    message: ShardMessage<T>,
) => unknown;
/** Listener for errors thrown or rejected by shard message handlers. */
export type ShardBusErrorHandler = (
    error: unknown,
    message: ShardMessage,
) => void;
/** Options for a {@link ShardBus}. */
export interface ShardBusOptions {
    /**
     * How messages travel. Defaults to IPC inside a cluster forked by
     * `ClusterManager`, and to a `BroadcastChannel` otherwise.
     */
    transport?: ShardBusTransport;
    /** Most requests waiting for a reply at once (default 10,000); more are rejected. */
    maxPending?: number;
}
/** Cross-shard messaging: send, broadcast, and request/reply over a {@link ShardBusTransport}. */
export class ShardBus {
    /** Underlying transport. */
    readonly #transport: ShardBusTransport;
    /** Most requests waiting for a reply at once. */
    readonly #maxPending: number;
    /** Message handlers by message type. */
    readonly #handlers = new Map<string, Set<ShardMessageHandler>>();
    /** Handler error listeners. */
    readonly #errorHandlers = new Set<ShardBusErrorHandler>();
    /** Current shard ID. */
    readonly #shardId: number;
    /** Application-specific channel namespace. */
    readonly #namespace: string;
    /** BroadcastChannel name used by this bus. */
    public readonly channelName: string;
    /** Monotonic message counter. */
    #counter = 0;
    /** Reply collectors for in-flight requests, by request message ID. */
    readonly #pending = new Map<
        string,
        {
            target: number | null;
            reply: (reply: ShardReply) => void;
            fail: (error: Error) => void;
        }
    >();
    /** Creates a shard bus. @param shardId Shard ID. @param channelName Application-specific channel name. @throws {RangeError} If shard ID is invalid. @throws {TypeError} If channel name is empty. */
    public constructor(
        shardId: number,
        channelName: string,
        options: ShardBusOptions = {},
    ) {
        if (!Number.isInteger(shardId) || shardId < 0)
            throw new RangeError("Shard ID must be a non-negative integer.");
        if (!channelName?.trim())
            throw new TypeError(
                "An application-specific shard channel name is required.",
            );
        this.#shardId = shardId;
        this.#namespace = channelName.trim();
        this.channelName = this.#namespace;
        this.#maxPending = options.maxPending ?? 10_000;
        this.#transport =
            options.transport ?? defaultTransport(this.channelName);
        this.#transport.onMessage((message) => this.#dispatch(message));
        this.#transport.onPeerDown?.((shardIds) => this.#peerDown(shardIds));
    }
    /** Registers a message handler. @param type Message type. @param handler Handler callback. @returns This bus. @throws {TypeError} If type or handler is invalid. */
    public on<T>(type: string, handler: ShardMessageHandler<T>): this {
        if (!type.trim() || typeof handler !== "function")
            throw new TypeError("Shard message type and handler are required.");
        let handlers = this.#handlers.get(type);
        if (!handlers) this.#handlers.set(type, (handlers = new Set()));
        handlers.add(handler as ShardMessageHandler);
        return this;
    }
    /** Removes a message handler. @param type Message type. @param handler Handler callback. @returns This bus. */
    public off<T>(type: string, handler: ShardMessageHandler<T>): this {
        this.#handlers.get(type)?.delete(handler as ShardMessageHandler);
        return this;
    }
    /** Registers a listener for errors thrown or rejected by message handlers. Without one, handler errors are isolated and dropped. @param handler Error listener. @returns This bus. @throws {TypeError} If handler is invalid. */
    public onError(handler: ShardBusErrorHandler): this {
        if (typeof handler !== "function")
            throw new TypeError("Shard bus error handler is required.");
        this.#errorHandlers.add(handler);
        return this;
    }
    /** Removes a handler error listener. @param handler Error listener. @returns This bus. */
    public offError(handler: ShardBusErrorHandler): this {
        this.#errorHandlers.delete(handler);
        return this;
    }
    /** Sends a targeted shard message. @param target Target shard ID. @param type Message type. @param data Payload. @returns Unique message ID. */
    public send<T>(target: number, type: string, data: T): string {
        if (!Number.isInteger(target) || target < 0)
            throw new RangeError(
                "Shard target must be a non-negative integer.",
            );
        return this.#publish(target, type, data);
    }
    /** Broadcasts to all other shards. @param type Message type. @param data Payload. @returns Unique message ID. */
    public broadcast<T>(type: string, data: T): string {
        return this.#publish(null, type, data);
    }
    /**
     * Registers a handler that answers requests of `type`. Its return value (or
     * thrown error) is sent back to the requesting shard. Discord.js-familiar
     * replacement for `broadcastEval` that never evaluates received code.
     * @returns This bus.
     */
    public respond<T, R>(
        type: string,
        handler: (data: T, message: ShardMessage<T>) => R | Promise<R>,
    ): this {
        return this.on<T>(type, async (message) => {
            if (!message.expectsReply) return;
            const reply: ReplyPayload = { requestId: message.id };
            try {
                reply.result = await handler(message.data, message);
            } catch (error) {
                reply.error =
                    error instanceof Error ? error.message : String(error);
            }
            this.#publish(message.source, REPLY_TYPE, reply);
        });
    }
    /**
     * Sends a request to one shard and resolves with its handler's result.
     * @throws {Error} If the handler failed or no reply arrives in time.
     */
    public async request<R = unknown, T = unknown>(
        target: number,
        type: string,
        data: T,
        timeoutMs = 5000,
    ): Promise<R> {
        if (!Number.isInteger(target) || target < 0)
            throw new RangeError(
                "Shard target must be a non-negative integer.",
            );
        const [reply] = await this.#collect<R>(
            target,
            type,
            data,
            timeoutMs,
            1,
            true,
        );
        if (!reply)
            throw new Error(
                `Shard ${target} did not reply to "${type}" within ${timeoutMs}ms.`,
            );
        if (reply.error !== undefined) throw new Error(reply.error);
        return reply.result as R;
    }
    /**
     * Sends a request to every other shard and collects replies until
     * `expected` have arrived or `timeoutMs` elapses (never rejects).
     */
    public broadcastRequest<R = unknown, T = unknown>(
        type: string,
        data: T,
        options: { timeoutMs?: number; expected?: number } = {},
    ): Promise<ShardReply<R>[]> {
        return this.#collect<R>(
            null,
            type,
            data,
            options.timeoutMs ?? 5000,
            options.expected ?? Number.POSITIVE_INFINITY,
        );
    }
    /** Publishes a request and gathers replies. */
    #collect<R>(
        target: number | null,
        type: string,
        data: unknown,
        timeoutMs: number,
        expected: number,
        rejectOnPeerDown = false,
    ): Promise<ShardReply<R>[]> {
        const replies: ShardReply<R>[] = [];
        if (this.#pending.size >= this.#maxPending)
            return Promise.reject(
                new Error(
                    `Too many shard requests waiting for a reply (${this.#maxPending}).`,
                ),
            );
        return new Promise((resolve, reject) => {
            let requestId = "";
            const finish = (): void => {
                clearTimeout(timer);
                this.#pending.delete(requestId);
                resolve(replies);
            };
            const timer = setTimeout(finish, timeoutMs);
            requestId = this.#publish(target, type, data, true);
            this.#pending.set(requestId, {
                target,
                reply: (reply) => {
                    replies.push(reply as ShardReply<R>);
                    if (replies.length >= expected) finish();
                },
                fail: (error) => {
                    if (rejectOnPeerDown) {
                        clearTimeout(timer);
                        this.#pending.delete(requestId);
                        reject(error);
                    }
                },
            });
        });
    }
    /** Closes the transport. @returns Nothing. */
    public close(): void {
        this.#transport.close();
        this.#handlers.clear();
        this.#errorHandlers.clear();
    }
    /** Publishes a message. @param target Target shard ID or null. @param type Message type. @param data Payload. @returns Unique message ID. */
    #publish<T>(
        target: number | null,
        type: string,
        data: T,
        expectsReply = false,
    ): string {
        if (!type.trim())
            throw new TypeError("Shard message type is required.");
        const id = `${this.#namespace}:${this.#shardId}:${++this.#counter}`;
        this.#transport.post({
            source: this.#shardId,
            target,
            type,
            data,
            id,
            ...(expectsReply ? { expectsReply } : {}),
        } satisfies ShardMessage<T>);
        return id;
    }
    /** Routes an incoming message to matching handlers. @param message Message envelope. @returns Nothing. */
    #dispatch(message: ShardMessage): void {
        if (
            !message ||
            typeof message !== "object" ||
            typeof message.type !== "string"
        )
            return;
        if (
            message.source === this.#shardId ||
            (message.target !== null && message.target !== this.#shardId)
        )
            return;
        if (message.type === REPLY_TYPE) {
            const reply = message.data as ReplyPayload;
            this.#pending.get(reply?.requestId)?.reply({
                shardId: message.source,
                ...(reply.error !== undefined
                    ? { error: reply.error }
                    : { result: reply.result }),
            });
            return;
        }
        for (const handler of this.#handlers.get(message.type) ?? []) {
            try {
                const result = handler(message);
                if (
                    result &&
                    typeof (result as PromiseLike<unknown>).then === "function"
                )
                    void Promise.resolve(result).catch((error) =>
                        this.#reportError(error, message),
                    );
            } catch (error) {
                this.#reportError(error, message);
            }
        }
    }
    /** Fails requests waiting on shards that no longer exist. */
    #peerDown(shardIds: readonly number[]): void {
        const down = new Set(shardIds);
        for (const [id, pending] of this.#pending)
            if (pending.target !== null && down.has(pending.target)) {
                pending.fail(
                    new Error(
                        `Shard ${pending.target} went away before it replied.`,
                    ),
                );
                this.#pending.delete(id);
            }
    }
    /** Forwards a handler error to error listeners, isolating listener failures. Without a listener it is raised as a process warning, never dropped. @param error Handler error. @param message Message being handled. @returns Nothing. */
    #reportError(error: unknown, message: ShardMessage): void {
        if (this.#errorHandlers.size === 0) {
            process.emitWarning(
                error instanceof Error ? error : new Error(String(error)),
                { code: "LUNIBEE_SHARD_BUS_ERROR" },
            );
            return;
        }
        for (const handler of this.#errorHandlers) {
            try {
                handler(error, message);
            } catch {
                /* Error listener failures are isolated. */
            }
        }
    }
}
