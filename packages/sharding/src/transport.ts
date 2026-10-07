import type { ShardMessage } from "./bus.js";

/** Carries {@link ShardMessage}s between the processes or threads that run shards. */
export interface ShardBusTransport {
    /** Sends a message to the other shards. Delivery to the sender itself is not required. */
    post(message: ShardMessage): void;
    /** Listens for messages from other shards. */
    onMessage(listener: (message: ShardMessage) => void): void;
    /** Listens for the shards of a cluster that died, so pending requests to them can fail early. */
    onPeerDown?(listener: (shardIds: readonly number[]) => void): void;
    /** Stops listening and releases the channel. */
    close(): void;
}

/** One process: shards in the same process (or worker threads of it) talk over a `BroadcastChannel`. */
export class BroadcastChannelTransport implements ShardBusTransport {
    readonly #channel: BroadcastChannel;

    public constructor(name: string) {
        this.#channel = new BroadcastChannel(name);
    }

    public post(message: ShardMessage): void {
        this.#channel.postMessage(message);
    }

    public onMessage(listener: (message: ShardMessage) => void): void {
        this.#channel.addEventListener("message", (event) =>
            listener(event.data as ShardMessage),
        );
    }

    public close(): void {
        this.#channel.close();
    }
}

/** Marks a bus message on the IPC channel, so it cannot be confused with the bot's own `process.send()` traffic. */
export const BUS_FRAME = "__lunibeeBus";
/** Marks the parent's notice that a cluster's shards are gone. */
export const PEER_DOWN_FRAME = "__lunibeePeerDown";

/** The part of `process` (or a child process handle) the IPC transport uses. */
export interface IpcEndpoint {
    send?(message: unknown): unknown;
    on(event: "message", listener: (message: unknown) => void): unknown;
    off(event: "message", listener: (message: unknown) => void): unknown;
}

/**
 * Forked clusters: a worker `send()`s to its parent, and the parent
 * ({@link ClusterManager}) relays to every other worker. Selected
 * automatically in a worker forked by `ClusterManager`.
 */
export class IpcTransport implements ShardBusTransport {
    readonly #endpoint: IpcEndpoint;
    readonly #listener: (frame: unknown) => void;
    #message?: (message: ShardMessage) => void;
    #down?: (shardIds: readonly number[]) => void;

    public constructor(endpoint: IpcEndpoint = process as IpcEndpoint) {
        if (typeof endpoint.send !== "function")
            throw new Error(
                "IpcTransport needs an IPC channel: run the shard in a process forked by ClusterManager.",
            );
        this.#endpoint = endpoint;
        this.#listener = (frame) => {
            const record = frame as Record<string, unknown> | null;
            if (!record || typeof record !== "object") return;
            if (BUS_FRAME in record)
                this.#message?.(record[BUS_FRAME] as ShardMessage);
            else if (PEER_DOWN_FRAME in record)
                this.#down?.(record[PEER_DOWN_FRAME] as number[]);
        };
        endpoint.on("message", this.#listener);
    }

    public post(message: ShardMessage): void {
        this.#endpoint.send!({ [BUS_FRAME]: message });
    }

    public onMessage(listener: (message: ShardMessage) => void): void {
        this.#message = listener;
    }

    public onPeerDown(listener: (shardIds: readonly number[]) => void): void {
        this.#down = listener;
    }

    public close(): void {
        this.#endpoint.off("message", this.#listener);
    }
}

/** Picks the transport for a bus: IPC inside a forked cluster, `BroadcastChannel` otherwise. */
export function defaultTransport(name: string): ShardBusTransport {
    if (
        process.env.LUNIBEE_SHARD_BUS === "ipc" &&
        typeof process.send === "function"
    )
        return new IpcTransport();
    return new BroadcastChannelTransport(name);
}
