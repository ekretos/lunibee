import { Gateway } from "@lunibee/ws";

/** Configuration for a sharded Gateway client. */
export interface ShardManagerOptions {
    /** Bot token. */ token: string;
    /** Gateway intents. */ intents: number;
    /** Number of shards. Use `"auto"` to request Discord's recommended count. */ shardCount?: number | "auto";
    /** Gateway reconnect behavior. */ reconnect?: boolean;
    /** Delay between shard starts in milliseconds. */ spawnDelay?: number;
    /** Maximum number of concurrent identify operations. */ identifyConcurrency?: number;
}
/** Runtime state for a managed shard. */
export interface ShardInfo { /** Shard identifier. */ id: number; /** Gateway instance. */ gateway: Gateway; /** Last observed state. */ state: "idle" | "connecting" | "ready" | "closed" | "failed"; /** Last error, when failed. */ error?: Error; }

/** Manages independent Discord Gateway shards with bounded startup concurrency. */
export class ShardManager {
    /** Active Gateway shards indexed by shard identifier. */ public readonly shards = new Map<number, Gateway>();
    readonly #states = new Map<number, ShardInfo["state"]>();
    readonly #errors = new Map<number, Error>();
    /** Number of shards managed by this instance. */ public readonly shardCount: number;
    readonly #options: ShardManagerOptions;

    /** Creates a shard manager. */
    public constructor(options: ShardManagerOptions) {
        if (!options.token?.trim()) throw new TypeError("A Discord bot token is required.");
        if (!Number.isInteger(options.intents) || options.intents < 0) throw new RangeError("Gateway intents must be a non-negative integer.");
        this.#options = { identifyConcurrency: 1, reconnect: true, ...options };
        this.shardCount = options.shardCount === "auto" || options.shardCount === undefined ? 1 : options.shardCount;
        if (!Number.isInteger(this.shardCount) || this.shardCount < 1) throw new RangeError("Shard count must be a positive integer.");
        if (!Number.isInteger(this.#options.identifyConcurrency) || this.#options.identifyConcurrency! < 1) throw new RangeError("Identify concurrency must be a positive integer.");
        for (let id = 0; id < this.shardCount; id++) { this.shards.set(id, this.#createShard(id)); this.#states.set(id, "idle"); }
    }

    /** Retrieves Discord's recommended shard count. */
    public async fetchRecommendedShardCount(signal?: AbortSignal): Promise<number> {
        const response = await fetch("https://discord.com/api/v10/gateway/bot", { headers: { Authorization: `Bot ${this.#options.token}`, "User-Agent": "Lunibee/0.1.0" }, signal });
        if (!response.ok) throw new Error(`Gateway discovery failed with status ${response.status}`);
        const data = await response.json() as { shards?: unknown };
        if (!Number.isInteger(data.shards) || data.shards < 1) throw new Error("Gateway discovery returned an invalid shard count.");
        return data.shards;
    }

    /** Connects all shards while respecting the configured identify concurrency. */
    public async connect(): Promise<void> {
        const ids = [...this.shards.keys()];
        const concurrency = Math.min(this.#options.identifyConcurrency!, ids.length);
        let cursor = 0;
        const worker = async (): Promise<void> => {
            while (cursor < ids.length) {
                const id = ids[cursor++]; const shard = this.shards.get(id)!;
                this.#states.set(id, "connecting");
                try { await shard.connect(); this.#states.set(id, "ready"); }
                catch (error) { const normalized = error instanceof Error ? error : new Error(String(error), { cause: error }); this.#errors.set(id, normalized); this.#states.set(id, "failed"); throw new Error(`Failed to connect shard ${id}.`, { cause: normalized }); }
                if (this.#options.spawnDelay && this.#options.spawnDelay > 0) await Bun.sleep(this.#options.spawnDelay);
            }
        };
        const results = await Promise.allSettled(Array.from({ length: concurrency }, () => worker()));
        const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failure) throw failure.reason;
    }

    /** Closes every shard and releases Gateway resources. */
    public destroy(): void { for (const [id, shard] of this.shards) { shard.close(); this.#states.set(id, "closed"); } }
    /** Gets a shard by ID. */ public get(id: number): Gateway | undefined { return this.shards.get(id); }
    /** Returns information for all managed shards. */
    public values(): ShardInfo[] { return [...this.shards].map(([id, gateway]) => ({ id, gateway, state: this.#states.get(id) ?? "idle", ...(this.#errors.has(id) ? { error: this.#errors.get(id) } : {}) })); }
    /** Returns the number of shards that are ready. */ public get readyCount(): number { let count = 0; for (const state of this.#states.values()) if (state === "ready") count++; return count; }
    /** Returns the number of failed shards. */ public get failedCount(): number { let count = 0; for (const state of this.#states.values()) if (state === "failed") count++; return count; }
    #createShard(id: number): Gateway { return new Gateway({ token: this.#options.token, intents: this.#options.intents, shardId: id, shardCount: this.shardCount, reconnect: this.#options.reconnect }); }
}
