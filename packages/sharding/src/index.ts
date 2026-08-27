import { Gateway } from "@lunibee/ws";

/** Configuration for a sharded Gateway client. */
export interface ShardManagerOptions {
    /** Bot token. */
    token: string;
    /** Gateway intents. */
    intents: number;
    /** Number of shards. Use `"auto"` to request Discord's recommended count. @default "auto" */
    shardCount?: number | "auto";
    /** Gateway reconnect behavior. */
    reconnect?: boolean;
}

/** Manages independent Discord Gateway shards. */
export class ShardManager {
    /** Active Gateway shards. */
    public readonly shards = new Map<number, Gateway>();
    /** Number of shards managed by this instance. */
    public readonly shardCount: number;
    readonly #options: ShardManagerOptions;

    /** Creates a shard manager. */
    public constructor(options: ShardManagerOptions) {
        this.#options = options;
        this.shardCount = options.shardCount === "auto" || options.shardCount === undefined ? 1 : options.shardCount;
        for (let id = 0; id < this.shardCount; id++) {
            this.shards.set(id, new Gateway({ token: options.token, intents: options.intents, shardId: id, shardCount: this.shardCount, reconnect: options.reconnect }));
        }
    }

    /** Connects all shards sequentially. */
    public async connect(): Promise<void> {
        for (const shard of this.shards.values()) await shard.connect();
    }

    /** Closes every shard. */
    public destroy(): void {
        for (const shard of this.shards.values()) shard.close();
    }

    /** Gets a shard by ID. */
    public get(id: number): Gateway | undefined { return this.shards.get(id); }
}
