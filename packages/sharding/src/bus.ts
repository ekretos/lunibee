/** Message envelope exchanged between Lunibee shards. */
export interface ShardMessage<T = unknown> {
    /** Sending shard ID. */ source: number;
    /** Target shard ID, or null for broadcast. */ target: number | null;
    /** Application message type. */ type: string;
    /** Message payload. */ data: T;
    /** Unique message ID. */ id: string;
}
/** Handler invoked for shard messages. @typeParam T Message payload type. */
export type ShardMessageHandler<T = unknown> = (
    message: ShardMessage<T>,
) => unknown;
/** Bun/Node-compatible cross-shard transport using BroadcastChannel. */
export class ShardBus {
    /** Underlying broadcast channel. */ readonly #channel: BroadcastChannel;
    /** Message handlers by message type. */ readonly #handlers = new Map<
        string,
        Set<ShardMessageHandler>
    >();
    /** Current shard ID. */ readonly #shardId: number;
    /** Application-specific channel namespace. */ readonly #namespace: string;
    /** BroadcastChannel name used by this bus. */ public readonly channelName: string;
    /** Monotonic message counter. */ #counter = 0;
    /** Creates a shard bus. @param shardId Shard ID. @param channelName Application-specific channel name. @throws {RangeError} If shard ID is invalid. @throws {TypeError} If channel name is empty. */
    public constructor(shardId: number, channelName: string) {
        if (!Number.isInteger(shardId) || shardId < 0)
            throw new RangeError("Shard ID must be a non-negative integer.");
        if (!channelName?.trim())
            throw new TypeError(
                "An application-specific shard channel name is required.",
            );
        this.#shardId = shardId;
        this.#namespace = channelName.trim();
        this.channelName = this.#namespace;
        this.#channel = new BroadcastChannel(this.channelName);
        this.#channel.addEventListener("message", (event) =>
            this.#dispatch(event.data as ShardMessage),
        );
    }
    /** Registers a message handler. @param type Message type. @param handler Handler callback. @returns This bus. @throws {TypeError} If type or handler is invalid. */ public on<
        T,
    >(type: string, handler: ShardMessageHandler<T>): this {
        if (!type.trim() || typeof handler !== "function")
            throw new TypeError("Shard message type and handler are required.");
        let handlers = this.#handlers.get(type);
        if (!handlers) this.#handlers.set(type, (handlers = new Set()));
        handlers.add(handler as ShardMessageHandler);
        return this;
    }
    /** Removes a message handler. @param type Message type. @param handler Handler callback. @returns This bus. */ public off<
        T,
    >(type: string, handler: ShardMessageHandler<T>): this {
        this.#handlers.get(type)?.delete(handler as ShardMessageHandler);
        return this;
    }
    /** Sends a targeted shard message. @param target Target shard ID. @param type Message type. @param data Payload. @returns Unique message ID. */ public send<
        T,
    >(target: number, type: string, data: T): string {
        if (!Number.isInteger(target) || target < 0)
            throw new RangeError(
                "Shard target must be a non-negative integer.",
            );
        return this.#publish(target, type, data);
    }
    /** Broadcasts to all other shards. @param type Message type. @param data Payload. @returns Unique message ID. */ public broadcast<
        T,
    >(type: string, data: T): string {
        return this.#publish(null, type, data);
    }
    /** Closes the transport. @returns Nothing. */ public close(): void {
        this.#channel.close();
        this.#handlers.clear();
    }
    /** Publishes a message. @param target Target shard ID or null. @param type Message type. @param data Payload. @returns Unique message ID. */ #publish<
        T,
    >(target: number | null, type: string, data: T): string {
        if (!type.trim())
            throw new TypeError("Shard message type is required.");
        const id = `${this.#namespace}:${this.#shardId}:${++this.#counter}`;
        this.#channel.postMessage({
            source: this.#shardId,
            target,
            type,
            data,
            id,
        } satisfies ShardMessage<T>);
        return id;
    }
    /** Routes an incoming message to matching handlers. @param message Message envelope. @returns Nothing. */ #dispatch(
        message: ShardMessage,
    ): void {
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
        for (const handler of this.#handlers.get(message.type) ?? []) {
            try {
                const result = handler(message);
                if (
                    result &&
                    typeof (result as PromiseLike<unknown>).then === "function"
                )
                    void Promise.resolve(result).catch(() => undefined);
            } catch {
                /* Consumer errors are isolated. */
            }
        }
    }
}
