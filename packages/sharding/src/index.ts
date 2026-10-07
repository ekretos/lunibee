import { fetchGatewayBot, type GatewayBotInfo } from "./gateway-bot.js";
import { Gateway, GatewayState } from "@lunibee/ws";

/** Runtime-agnostic delay used between shard starts (works under Node and Bun). @param ms Milliseconds to wait. */
const sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

export { fetchGatewayBot, type GatewayBotInfo } from "./gateway-bot.js";
export { ShardBus } from "./bus.js";
export {
    BroadcastChannelTransport,
    IpcTransport,
    type IpcEndpoint,
    type ShardBusTransport,
} from "./transport.js";
export { ShardSupervisor, type SupervisorOptions } from "./supervisor.js";
export type {
    ShardBusErrorHandler,
    ShardBusOptions,
    ShardMessage,
    ShardMessageHandler,
    ShardReply,
} from "./bus.js";

export { ClusterManager } from "./cluster.js";
export type { ClusterManagerOptions, ClusterInfo } from "./cluster.js";

/** Whether a shard has no live socket, so connecting it costs an IDENTIFY. */
function needsConnection(gateway: Gateway): boolean {
    return (
        gateway.state === GatewayState.Connect ||
        gateway.state === GatewayState.Reconnect ||
        gateway.state === GatewayState.Closed
    );
}

/** States reached only after IDENTIFY or RESUME has been sent. */
const HANDSHAKE_SENT = new Set<string>([
    GatewayState.Identify,
    GatewayState.Resume,
    GatewayState.Ready,
    GatewayState.Dispatch,
    GatewayState.Heartbeat,
    GatewayState.Closed,
]);

/** Resolves once the shard has sent IDENTIFY/RESUME (or closed), or after `timeout` ms. */
function handshakeSent(gateway: Gateway, timeout: number): Promise<void> {
    if (HANDSHAKE_SENT.has(gateway.state)) return Promise.resolve();
    return new Promise((resolve) => {
        const done = (): void => {
            clearTimeout(timer);
            gateway.off("stateChange", onState);
            resolve();
        };
        const onState = (change: unknown): void => {
            if (HANDSHAKE_SENT.has((change as { next: string }).next)) done();
        };
        const timer = setTimeout(done, timeout);
        gateway.on("stateChange", onState);
    });
}

/** Configuration for a sharded Gateway client. */
export interface ShardManagerOptions {
    /** Bot token. */
    token: string;
    /** Gateway intents. */
    intents: number;
    /** Number of shards. Use `"auto"` to request Discord's recommended count. */
    shardCount?: number | "auto";
    /** Gateway reconnect behavior. */
    reconnect?: boolean;
    /**
     * Delay between shard starts in milliseconds. Defaults to 5000 to respect
     * Discord's IDENTIFY rate limit (one per 5s per rate-limit key); set 0 to
     * opt out when an external scheduler already paces the handshakes.
     */ spawnDelay?: number;
    /**
     * Shards that may IDENTIFY at once (Discord's `max_concurrency`). Defaults
     * to the value from `/gateway/bot` when it was fetched (auto shard count),
     * else 1.
     */ maxConcurrency?: number;
    /**
     * How long a startup round waits for its shards to send IDENTIFY/RESUME
     * before the next round's `spawnDelay` starts. Defaults to 15000 ms.
     */ handshakeTimeout?: number;
    /** Interval in milliseconds to automatically check for recommended shard count and re-scale if needed. Must be an integer >= 1000. */
    autoScaleInterval?: number;
    /** Optional handler invoked when a background auto-scale check fails. Receives the thrown error. */
    onAutoScaleError?: (error: unknown) => void;
}
/** Health snapshot for one shard. */
export interface ShardHealth {
    id: number;
    /** Gateway connection state. */
    state: Gateway["state"];
    /** Last heartbeat round-trip in ms, or -1 before the first ACK. */
    ping: number;
}
/** What `ShardManager` emits about its shards. */
export interface ShardManagerEvents {
    /** A shard finished its handshake and is receiving events. */
    shardReady: [shardId: number];
    /** A shard's connection closed (it may reconnect by itself). */
    shardDisconnect: [shardId: number, close: { code: number; action: string }];
    /** A shard resumed its session after a reconnect. */
    shardResume: [shardId: number];
    /** A shard reported an error. */
    shardError: [shardId: number, error: Error];
    /** A shard reconnected too often too fast and is backing off (see `Gateway` `unstable`). */
    shardUnstable: [
        shardId: number,
        info: { reconnects: number; delay: number },
    ];
}

/** Runtime state for a managed shard. */
export interface ShardInfo {
    /** Shard identifier. */
    id: number;
    /** Gateway instance. */
    gateway: Gateway;
}

/** Manages independent Discord Gateway shards with explicit destruction and reinitialization semantics. */
export class ShardManager {
    /** Discord's minimum interval between IDENTIFY payloads, in milliseconds. */
    public static readonly IDENTIFY_INTERVAL = 5000;
    /** Active Gateway shards indexed by shard identifier. */
    public readonly shards = new Map<number, Gateway>();
    /** Number of shards managed by this instance after initialization. */
    public get shardCount(): number {
        return this.shards.size;
    }
    readonly #options: ShardManagerOptions;
    /** Whether the shard set has been initialized. */
    #resolved = false;
    /** Whether this manager is currently destroyed. */
    #destroyed = false;
    /** Whether the manager was created in auto shard-count mode. Preserved across reshards so auto-scaling keeps running. */
    readonly #auto: boolean;
    #autoScaleTimer?: ReturnType<typeof setInterval>;
    /** The shard count of the current shard set; kept while a reshard has no shards so `getShardIdForGuild` stays right. */
    #total: number;
    readonly #listeners = new Map<
        keyof ShardManagerEvents,
        Set<(...args: unknown[]) => void>
    >();
    /** Last `/gateway/bot` answer, used for concurrency and the start limit. */
    #gatewayInfo?: GatewayBotInfo;
    /** Creates a shard manager. @param options Sharding configuration. @throws {TypeError} If token or intents are invalid. @throws {RangeError} If shard count is invalid. */
    public constructor(options: ShardManagerOptions) {
        if (!options.token?.trim())
            throw new TypeError("A Discord bot token is required.");
        if (!Number.isInteger(options.intents) || options.intents < 0)
            throw new TypeError(
                "Gateway intents must be a non-negative integer.",
            );
        const count =
            options.shardCount === "auto" || options.shardCount === undefined
                ? 1
                : options.shardCount;
        if (!Number.isInteger(count) || count < 1)
            throw new RangeError("Shard count must be a positive integer.");
        if (
            options.autoScaleInterval !== undefined &&
            (!Number.isInteger(options.autoScaleInterval) ||
                options.autoScaleInterval < 1000)
        )
            throw new RangeError(
                "autoScaleInterval must be an integer of at least 1000 milliseconds.",
            );
        if (
            options.spawnDelay !== undefined &&
            (!Number.isFinite(options.spawnDelay) || options.spawnDelay < 0)
        )
            throw new RangeError(
                "spawnDelay must be a non-negative finite number of milliseconds.",
            );
        if (
            options.maxConcurrency !== undefined &&
            (!Number.isInteger(options.maxConcurrency) ||
                options.maxConcurrency < 1)
        )
            throw new RangeError("maxConcurrency must be a positive integer.");
        if (
            options.handshakeTimeout !== undefined &&
            (!Number.isFinite(options.handshakeTimeout) ||
                options.handshakeTimeout < 0)
        )
            throw new RangeError(
                "handshakeTimeout must be a non-negative number of milliseconds.",
            );
        this.#total = count;
        this.#auto = options.shardCount === "auto";
        // Discord allows one IDENTIFY per 5s per rate-limit key. Spawning
        // shards back-to-back trips that limit and the gateway answers with
        // close 4008 / invalid session, so 5s is the default rather than an
        // opt-in.
        this.#options = {
            spawnDelay: ShardManager.IDENTIFY_INTERVAL,
            ...options,
        };
        if (options.shardCount !== "auto") this.#initialize(count);
    }
    /** Retrieves Discord's recommended shard count. @returns Recommended shard count. @throws {Error} If discovery fails or returns invalid data. */
    public async fetchRecommendedShardCount(): Promise<number> {
        return (await this.fetchGatewayInfo()).shards;
    }
    /** Retrieves `/gateway/bot`: recommended shards and the IDENTIFY budget. Remembered for pacing the next connect. @throws {Error} If discovery fails or returns invalid data. */
    public async fetchGatewayInfo(): Promise<GatewayBotInfo> {
        const info = await fetchGatewayBot(this.#options.token);
        this.#gatewayInfo = info;
        return info;
    }
    /** Connects all shards sequentially. A destroyed manager is reinitialized before connecting. @returns A promise fulfilled after all shards connect. @throws {Error} If a shard fails to connect. */
    public async connect(): Promise<void> {
        // Clear any timer from a previous connect() so a second call cannot leak one.
        if (this.#autoScaleTimer) {
            clearInterval(this.#autoScaleTimer);
            this.#autoScaleTimer = undefined;
        }
        await this.#ensureInitialized();
        const limit = this.#gatewayInfo?.sessionStartLimit;
        // Only shards without a live socket spend an IDENTIFY; connect() is a
        // no-op for the rest, so they are neither counted nor paced.
        const ids = [...this.shards]
            .filter(([, gateway]) => needsConnection(gateway))
            .map(([id]) => id);
        if (limit && limit.remaining < ids.length)
            // Live shards are left running: the budget only blocks new ones.
            throw new Error(
                `Session start limit exhausted: ${limit.remaining} of ${limit.total} IDENTIFYs left for ${ids.length} shards; resets in ${Math.ceil(limit.resetAfter / 1000)}s.`,
            );
        // Shards whose IDs differ modulo max_concurrency use different
        // IDENTIFY rate-limit keys, so each round of consecutive IDs may start
        // together; rounds are spaced by spawnDelay. An override may lower the
        // concurrency but never exceed what Discord reported.
        const concurrency = Math.min(
            this.#options.maxConcurrency ?? limit?.maxConcurrency ?? 1,
            limit?.maxConcurrency ?? Infinity,
        );
        // Discord's IDENTIFY rate-limit key is `shard_id % max_concurrency`: one
        // IDENTIFY per key per 5 seconds. Each round starts the next shard of
        // every bucket, so a round never puts two shards on one key.
        const buckets = new Map<number, number[]>();
        for (const id of ids) {
            const key = id % concurrency;
            const bucket = buckets.get(key);
            if (bucket) bucket.push(id);
            else buckets.set(key, [id]);
        }
        const rounds = Math.max(
            0,
            ...[...buckets.values()].map((bucket) => bucket.length),
        );
        for (let index = 0; index < rounds; index++) {
            const round = [...buckets.values()]
                .map((bucket) => bucket[index])
                .filter((id): id is number => id !== undefined);
            const results = await Promise.allSettled(
                round.map((id) => this.shards.get(id)!.connect()),
            );
            const failed = results.findIndex(
                (result) => result.status === "rejected",
            );
            if (failed !== -1) {
                this.destroy();
                throw new Error(`Failed to connect shard ${round[failed]}.`, {
                    cause: (results[failed] as PromiseRejectedResult).reason,
                });
            }
            if (
                index + 1 < rounds &&
                this.#options.spawnDelay &&
                this.#options.spawnDelay > 0
            ) {
                // connect() resolves when the socket opens; IDENTIFY follows
                // HELLO. Start the interval from the handshake itself so a late
                // HELLO cannot squeeze two rounds' IDENTIFYs together.
                await Promise.all(
                    round.map((id) =>
                        handshakeSent(
                            this.shards.get(id)!,
                            this.#options.handshakeTimeout ?? 15_000,
                        ),
                    ),
                );
                await sleep(this.#options.spawnDelay);
            }
        }
        if (this.#options.autoScaleInterval && !this.#autoScaleTimer) {
            this.#autoScaleTimer = setInterval(() => {
                void this.checkAutoScale();
            }, this.#options.autoScaleInterval);
        }
    }
    /** Checks if the recommended shard count has changed and reconnects if so. */
    public async checkAutoScale(): Promise<void> {
        if (!this.#auto) return;
        try {
            const recommended = await this.fetchRecommendedShardCount();
            if (recommended !== this.shardCount) {
                await this.reshard(recommended);
            }
        } catch (error) {
            // Surface the failure instead of silently swallowing it; the next
            // interval tick retries.
            this.#options.onAutoScaleError?.(error);
        }
    }
    /** Forces a reshard to a new shard count, replacing all active shards. @param count New shard count. */
    public async reshard(count: number): Promise<void> {
        this.#options.shardCount = count;
        this.destroy();
        await this.connect();
    }
    /** Permanently closes the current shard set and releases Gateway resources. The next connect recreates them. @returns Nothing. */
    public destroy(): void {
        for (const shard of this.shards.values()) shard.close();
        this.shards.clear();
        this.#resolved = false;
        this.#destroyed = true;
        if (this.#autoScaleTimer) {
            clearInterval(this.#autoScaleTimer);
            this.#autoScaleTimer = undefined;
        }
    }
    /** Listens for an aggregated shard event. @returns This manager. */
    public on<E extends keyof ShardManagerEvents>(
        event: E,
        listener: (...args: ShardManagerEvents[E]) => void,
    ): this {
        let set = this.#listeners.get(event);
        if (!set) this.#listeners.set(event, (set = new Set()));
        set.add(listener as unknown as (...args: unknown[]) => void);
        return this;
    }
    /** Stops listening for a shard event. @returns This manager. */
    public off<E extends keyof ShardManagerEvents>(
        event: E,
        listener: (...args: ShardManagerEvents[E]) => void,
    ): this {
        this.#listeners
            .get(event)
            ?.delete(listener as unknown as (...args: unknown[]) => void);
        return this;
    }
    #emit<E extends keyof ShardManagerEvents>(
        event: E,
        ...args: ShardManagerEvents[E]
    ): void {
        for (const listener of this.#listeners.get(event) ?? [])
            try {
                listener(...args);
            } catch {
                // A faulty listener must not disturb the shard.
            }
    }
    /** Calculates the target shard ID for a Discord guild snowflake. @param guildId Guild snowflake. @returns Shard identifier. */
    public getShardIdForGuild(guildId: string): number {
        const id = BigInt(guildId);
        return Number((id >> 22n) % BigInt(this.#total));
    }
    /** Gets a shard by ID. @param id Shard identifier. @returns Gateway instance or undefined. */
    public get(id: number): Gateway | undefined {
        return this.shards.get(id);
    }
    /** Returns each shard's connection state and heartbeat latency. */
    public health(): ShardHealth[] {
        return [...this.shards].map(([id, gateway]) => ({
            id,
            state: gateway.state,
            ping: gateway.ping,
        }));
    }
    /** Returns information for all managed shards. @returns Shard information snapshots. */
    public values(): ShardInfo[] {
        return [...this.shards].map(([id, gateway]) => ({ id, gateway }));
    }
    /** Ensures a live shard set exists. @returns A promise fulfilled after initialization. @throws {Error} If initialization fails. */
    async #ensureInitialized(): Promise<void> {
        if (this.#resolved) return;
        if (this.#destroyed) this.#destroyed = false;
        const count =
            this.#options.shardCount === "auto"
                ? await this.fetchRecommendedShardCount()
                : (this.#options.shardCount ?? 1);
        this.#initialize(count);
    }
    /** Creates every shard for a resolved shard count. @param count Number of shards. @returns Nothing. */
    #initialize(count: number): void {
        if (this.#resolved) return;
        this.#total = count;
        for (let id = 0; id < count; id++)
            this.shards.set(id, this.#createShard(id, count));
        this.#resolved = true;
    }
    /** Creates one Gateway instance with its shard identity. @param id Shard identifier. @param count Total shard count. @returns Configured Gateway. */
    #createShard(id: number, count: number): Gateway {
        const gateway = new Gateway({
            token: this.#options.token,
            intents: this.#options.intents,
            shardId: id,
            shardCount: count,
            reconnect: this.#options.reconnect ?? true,
        });
        gateway.on("ready", () => this.#emit("shardReady", id));
        gateway.on("resumed", () => this.#emit("shardResume", id));
        gateway.on("close", (close) =>
            this.#emit(
                "shardDisconnect",
                id,
                close as { code: number; action: string },
            ),
        );
        gateway.on("error", (error) =>
            this.#emit("shardError", id, error as Error),
        );
        gateway.on("unstable", (info) =>
            this.#emit(
                "shardUnstable",
                id,
                info as { reconnects: number; delay: number },
            ),
        );
        return gateway;
    }
}

/** Discord.js-familiar alias for {@link ShardManager}. */
export { ShardManager as ShardingManager };
