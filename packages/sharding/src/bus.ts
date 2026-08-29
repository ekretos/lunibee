/** Message envelope exchanged between Lunibee shards. */
export interface ShardMessage<T = unknown> {
    /** Originating shard identifier. */
    source: number;
    /** Destination shard identifier, or null for broadcast. */
    target: number | null;
    /** Application-defined message type. */
    type: string;
    /** Application payload. */
    data: T;
    /** Monotonic message identifier within this process. */
    id: string;
}

/** Handler invoked for messages addressed to a shard. */
export type ShardMessageHandler<T = unknown> = (message: ShardMessage<T>) => unknown;

/** Bun/Node compatible cross-shard transport using BroadcastChannel when available. */
export class ShardBus {
    readonly #channel: BroadcastChannel;
    readonly #handlers = new Map<string, Set<ShardMessageHandler>>();
    readonly #shardId: number;
    #counter = 0;

    /** Creates a bus scoped to a shard. */
    public constructor(shardId: number, channelName = "lunibee-shards") {
        if (!Number.isInteger(shardId) || shardId < 0) throw new RangeError("Shard ID must be a non-negative integer.");
        this.#shardId = shardId;
        this.#channel = new BroadcastChannel(channelName);
        this.#channel.addEventListener("message", event => this.#dispatch(event.data as ShardMessage));
    }

    /** Registers a handler for one message type. */
    public on<T>(type: string, handler: ShardMessageHandler<T>): this {
        if (!type.trim() || typeof handler !== "function") throw new TypeError("Shard message type and handler are required.");
        let handlers = this.#handlers.get(type);
        if (!handlers) this.#handlers.set(type, handlers = new Set());
        handlers.add(handler as ShardMessageHandler);
        return this;
    }

    /** Removes a message handler. */
    public off<T>(type: string, handler: ShardMessageHandler<T>): this {
        this.#handlers.get(type)?.delete(handler as ShardMessageHandler);
        return this;
    }

    /** Sends a message to one shard. */
    public send<T>(target: number, type: string, data: T): string {
        if (!Number.isInteger(target) || target < 0) throw new RangeError("Shard target must be a non-negative integer.");
        return this.#publish(target, type, data);
    }

    /** Broadcasts a message to every shard except the sender. */
    public broadcast<T>(type: string, data: T): string {
        return this.#publish(null, type, data);
    }

    /** Closes the transport and releases the channel. */
    public close(): void {
        this.#channel.close();
        this.#handlers.clear();
    }

    #publish<T>(target: number | null, type: string, data: T): string {
        if (!type.trim()) throw new TypeError("Shard message type is required.");
        const id = `${this.#shardId}:${++this.#counter}`;
        const message: ShardMessage<T> = { source: this.#shardId, target, type, data, id };
        this.#channel.postMessage(message);
        return id;
    }

    #dispatch(message: ShardMessage): void {
        if (!message || typeof message !== "object" || typeof message.type !== "string") return;
        if (message.source === this.#shardId || (message.target !== null && message.target !== this.#shardId)) return;
        for (const handler of this.#handlers.get(message.type) ?? []) {
            try {
                const result = handler(message);
                if (result && typeof (result as PromiseLike<unknown>).then === "function") void Promise.resolve(result).catch(() => undefined);
            } catch {
                // A faulty shard consumer must not terminate the transport.
            }
        }
    }
}
