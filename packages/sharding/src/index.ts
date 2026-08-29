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

/** Manages independent Discord Gateway shards with explicit destruction and reinitialization semantics. */
export class ShardManager {
    /** Active Gateway shards indexed by shard identifier. */ public readonly shards = new Map<number, Gateway>();
    /** Number of shards managed by this instance after initialization. */ public get shardCount(): number { return this.shards.size; }
    readonly #options: ShardManagerOptions;
    /** Whether the shard set has been initialized. */ #resolved = false;
    /** Whether this manager is currently destroyed. */ #destroyed = false;
    /** Creates a shard manager. @param options Sharding configuration. @throws {TypeError} If token or intents are invalid. @throws {RangeError} If shard count is invalid. */
    public constructor(options: ShardManagerOptions) { if (!options.token?.trim()) throw new TypeError("A Discord bot token is required."); if (!Number.isInteger(options.intents) || options.intents < 0) throw new TypeError("Gateway intents must be a non-negative integer."); const count = options.shardCount === "auto" || options.shardCount === undefined ? 1 : options.shardCount; if (!Number.isInteger(count) || count < 1) throw new RangeError("Shard count must be a positive integer."); this.#options = { ...options }; if (options.shardCount !== "auto") this.#initialize(count); }
    /** Retrieves Discord's recommended shard count. @returns Recommended shard count. @throws {Error} If discovery fails or returns invalid data. */
    public async fetchRecommendedShardCount(): Promise<number> { const response = await fetch("https://discord.com/api/v10/gateway/bot", { headers: { Authorization: `Bot ${this.#options.token}`, "User-Agent": "Lunibee/0.1.0" } }); if (!response.ok) throw new Error(`Gateway discovery failed with status ${response.status}`); const data = await response.json() as { shards?: unknown }; if (typeof data.shards !== "number" || !Number.isInteger(data.shards) || data.shards < 1) throw new Error("Gateway discovery returned an invalid shard count."); return data.shards; }
    /** Connects all shards sequentially. A destroyed manager is reinitialized before connecting. @returns A promise fulfilled after all shards connect. @throws {Error} If a shard fails to connect. */
    public async connect(): Promise<void> { await this.#ensureInitialized(); for (const [id, shard] of this.shards) { try { await shard.connect(); } catch (error) { this.destroy(); throw new Error(`Failed to connect shard ${id}.`, { cause: error }); } if (id + 1 < this.shardCount && this.#options.spawnDelay && this.#options.spawnDelay > 0) await Bun.sleep(this.#options.spawnDelay); } }
    /** Permanently closes the current shard set and releases Gateway resources. The next connect recreates them. @returns Nothing. */
    public destroy(): void { for (const shard of this.shards.values()) shard.close(); this.shards.clear(); this.#resolved = false; this.#destroyed = true; }
    /** Gets a shard by ID. @param id Shard identifier. @returns Gateway instance or undefined. */ public get(id: number): Gateway | undefined { return this.shards.get(id); }
    /** Returns information for all managed shards. @returns Shard information snapshots. */ public values(): ShardInfo[] { return [...this.shards].map(([id, gateway]) => ({ id, gateway })); }
    /** Ensures a live shard set exists. @returns A promise fulfilled after initialization. @throws {Error} If initialization fails. */
    async #ensureInitialized(): Promise<void> { if (this.#resolved) return; if (this.#destroyed) this.#destroyed = false; const count = this.#options.shardCount === "auto" ? await this.fetchRecommendedShardCount() : this.#options.shardCount ?? 1; this.#initialize(count); }
    /** Creates every shard for a resolved shard count. @param count Number of shards. @returns Nothing. */
    #initialize(count: number): void { if (this.#resolved) return; for (let id = 0; id < count; id++) this.shards.set(id, this.#createShard(id, count)); this.#resolved = true; }
    /** Creates one Gateway instance with its shard identity. @param id Shard identifier. @param count Total shard count. @returns Configured Gateway. */
    #createShard(id: number, count: number): Gateway { return new Gateway({ token: this.#options.token, intents: this.#options.intents, shardId: id, shardCount: count, reconnect: this.#options.reconnect ?? true }); }
}
