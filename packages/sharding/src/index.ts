import { Gateway } from "@lunibee/ws";
export { ShardBus } from "./bus.js";
export type { ShardMessage, ShardMessageHandler } from "./bus.js";

/** Configuration for a sharded Gateway client. */
export interface ShardManagerOptions {
    /** Bot token. */ token: string;
    /** Gateway intents. */ intents: number;
    /** Number of shards. Use `"auto"` to request Discord's recommended count. */ shardCount?: number | "auto";
    /** Gateway reconnect behavior. */ reconnect?: boolean;
    /** Delay between shard starts in milliseconds. */ spawnDelay?: number;
}

/** Runtime state for a managed shard. */
export interface ShardInfo { /** Shard identifier. */ id: number; /** Gateway instance. */ gateway: Gateway; }

/** Manages independent Discord Gateway shards. */
export class ShardManager {
    /** Active Gateway shards indexed by shard identifier. */ public readonly shards = new Map<number, Gateway>();
    /** Number of shards managed by this instance. */ public readonly shardCount: number;
    readonly #options: ShardManagerOptions;
    /** Creates a shard manager. */
    public constructor(options: ShardManagerOptions) {
        if (!options.token?.trim()) throw new TypeError("A Discord bot token is required.");
        if (!Number.isInteger(options.intents) || options.intents < 0) throw new TypeError("Gateway intents must be a non-negative integer.");
        this.#options = { ...options };
        this.shardCount = options.shardCount === "auto" || options.shardCount === undefined ? 1 : options.shardCount;
        if (!Number.isInteger(this.shardCount) || this.shardCount < 1) throw new RangeError("Shard count must be a positive integer.");
        for (let id = 0; id < this.shardCount; id++) this.shards.set(id, this.#createShard(id));
    }
    /** Retrieves Discord's recommended shard count. */
    public async fetchRecommendedShardCount(): Promise<number> {
        const response = await fetch("https://discord.com/api/v10/gateway/bot", { headers: { Authorization: `Bot ${this.#options.token}`, "User-Agent": "Lunibee/0.1.0" } });
        if (!response.ok) throw new Error(`Gateway discovery failed with status ${response.status}`);
        const data = await response.json() as { shards?: unknown };
        if (!Number.isInteger(data.shards) || data.shards < 1) throw new Error("Gateway discovery returned an invalid shard count.");
        return data.shards;
    }
    /** Connects all shards sequentially to avoid a connection burst. */
    public async connect(): Promise<void> { for (const [id, shard] of this.shards) { try { await shard.connect(); } catch (error) { throw new Error(`Failed to connect shard ${id}.`, { cause: error }); } if (id + 1 < this.shardCount && this.#options.spawnDelay && this.#options.spawnDelay > 0) await Bun.sleep(this.#options.spawnDelay); } }
    /** Closes every shard and releases Gateway resources. */ public destroy(): void { for (const shard of this.shards.values()) shard.close(); }
    /** Gets a shard by ID. */ public get(id: number): Gateway | undefined { return this.shards.get(id); }
    /** Returns information for all managed shards. */ public values(): ShardInfo[] { return [...this.shards].map(([id, gateway]) => ({ id, gateway })); }
    #createShard(id: number): Gateway { return new Gateway({ token: this.#options.token, intents: this.#options.intents, shardId: id, shardCount: this.shardCount, reconnect: this.#options.reconnect }); }
}
