import { fetchGatewayBot, type GatewayBotInfo } from "./gateway-bot.js";
import { Gateway, GatewayState } from "@lunibee/ws";
import {
    readClusterContext,
    validateShardIds,
    type ClusterContext,
} from "./context.js";
import type {
    ShardHealth,
    ShardStatus,
    WorkerMetrics,
    WorkerReport,
} from "./health.js";
import { REQUEST_ASSIGN, REQUEST_HEALTH } from "./protocol.js";
import { ClusterWorker, type IdentifyGate } from "./worker.js";

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
export type {
    ClusterManagerOptions,
    ClusterManagerEvents,
    ClusterInfo,
    BroadcastResult,
    RequestOptions,
} from "./cluster.js";
export {
    allocateShards,
    assertCompleteAllocation,
    isClusterWorker,
    readClusterContext,
    validateShardIds,
    type ClusterContext,
} from "./context.js";
export { ClusterWorker, type IdentifyGate } from "./worker.js";
export {
    IdentifyCoordinator,
    IDENTIFY_INTERVAL,
    type IdentifyBudget,
    type IdentifyCoordinatorOptions,
} from "./identify.js";
export { RequestTracker } from "./requests.js";
export type {
    ClusterHealth,
    ClusterManagerHealth,
    ClusterState,
    ShardHealth,
    ShardStatus,
    WorkerMetrics,
    WorkerReport,
} from "./health.js";

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
    /** Gateway intents as an array, e.g. `[GatewayIntentBits.Guilds]`. */
    intents: ConstructorParameters<typeof Gateway>[0]["intents"];
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
    /**
     * The shards this manager runs, out of `shardCount`. Defaults to all of
     * them, or to the cluster's own list inside a worker forked by
     * `ClusterManager`. Must be unique integers in `[0, shardCount)`.
     */
    shardIds?: number[];
    /**
     * The worker contract. Read from the environment inside a worker forked by
     * `ClusterManager`; pass `false` to ignore it, or a context to override it.
     */
    cluster?: ClusterContext | false;
    /**
     * Where to get IDENTIFY slots. Inside a coordinated cluster this is the
     * parent, so the limit holds across all clusters. Pass `false` to pace
     * locally with `spawnDelay` instead.
     */
    identify?: IdentifyGate | false;
    /** The worker to report to. Defaults to this process's `ClusterWorker` inside a cluster. */
    worker?: ClusterWorker | false;
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
    /** Every shard this manager owns is ready. Emitted again after a shard drops and recovers. */
    ready: [];
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
    /** Total shards in the deployment once initialized, 0 before and after `destroy()`. */
    public get shardCount(): number {
        return this.#resolved ? this.#total : 0;
    }
    /** IDs of the shards this manager owns. */
    public get shardIds(): number[] {
        return [...this.shards.keys()].sort((a, b) => a - b);
    }
    readonly #options: ShardManagerOptions;
    /** Shards this manager was asked to own; every shard when `undefined`. */
    #ids: number[] | undefined;
    readonly #gate: IdentifyGate | undefined;
    readonly #worker: ClusterWorker | undefined;
    readonly #lifecycle = new Map<
        number,
        { status: ShardStatus; readyAt?: number; disconnectedAt?: number }
    >();
    /** Whether `ready` was announced since the last shard dropped. */
    #announced = false;
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
        if (!Array.isArray(options.intents))
            throw new TypeError(
                "Gateway intents must be an array, e.g. [GatewayIntentBits.Guilds].",
            );
        const context =
            options.cluster === false
                ? null
                : (options.cluster ?? readClusterContext());
        if (context) {
            if (options.shardCount === "auto")
                throw new RangeError(
                    'shardCount "auto" is the ClusterManager\'s decision inside a cluster worker.',
                );
            if (
                options.shardCount !== undefined &&
                options.shardCount !== context.shardCount
            )
                throw new RangeError(
                    `shardCount ${options.shardCount} differs from the cluster's ${context.shardCount}.`,
                );
            if (options.autoScaleInterval !== undefined)
                throw new TypeError(
                    "autoScaleInterval belongs to ClusterManager inside a cluster worker.",
                );
            if (
                options.shardIds &&
                !options.shardIds.every((id) => context.shardIds.includes(id))
            )
                throw new RangeError(
                    "shardIds must be a subset of the cluster's own shards.",
                );
        }
        const count = context
            ? context.shardCount
            : options.shardCount === "auto" || options.shardCount === undefined
              ? 1
              : options.shardCount;
        if (!Number.isInteger(count) || count < 1)
            throw new RangeError("Shard count must be a positive integer.");
        this.#ids = options.shardIds ?? context?.shardIds;
        if (this.#ids && options.shardCount !== "auto")
            validateShardIds(this.#ids, count);
        this.#worker =
            options.worker === false
                ? undefined
                : (options.worker ??
                  (context && options.cluster === undefined
                      ? ClusterWorker.current()
                      : undefined));
        this.#gate =
            options.identify === false
                ? undefined
                : (options.identify ??
                  (context?.coordinatedIdentify
                      ? this.#worker?.identifyGate
                      : undefined));
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
        this.#worker?.onRequest(REQUEST_HEALTH, (data) =>
            this.report(
                (data as { metrics?: boolean } | null | undefined)?.metrics ===
                    true,
            ),
        );
        this.#worker?.onRequest(REQUEST_ASSIGN, async (data) => {
            const ids = (data as { shardIds?: unknown } | null)?.shardIds;
            if (!Array.isArray(ids))
                throw new TypeError("shardIds must be an array.");
            await this.addShards(ids as number[]);
            return { shardIds: ids };
        });
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
        // Only shards without a live socket spend an IDENTIFY; connect() is a
        // no-op for the rest, so they are neither counted nor paced.
        await this.#start(
            [...this.shards]
                .filter(([, gateway]) => needsConnection(gateway))
                .map(([id]) => id),
        );
        if (this.#options.autoScaleInterval && !this.#autoScaleTimer) {
            this.#autoScaleTimer = setInterval(() => {
                void this.checkAutoScale();
            }, this.#options.autoScaleInterval);
        }
    }
    /**
     * Takes over more shards of the same deployment (recovery after another
     * cluster gave up) and connects them through the same IDENTIFY path.
     * @throws {RangeError} If an ID is invalid, already owned, or the manager is not initialized.
     */
    public async addShards(shardIds: readonly number[]): Promise<void> {
        await this.#ensureInitialized();
        validateShardIds(shardIds, this.#total);
        for (const id of shardIds)
            if (this.shards.has(id))
                throw new RangeError(`Shard ${id} is already owned.`);
        for (const id of shardIds)
            this.shards.set(id, this.#createShard(id, this.#total));
        if (this.#ids) this.#ids = [...this.#ids, ...shardIds];
        this.#announced = false;
        try {
            // Only the new shards are torn down on failure: the ones that were
            // already running keep their sessions.
            await this.#start([...shardIds], false);
        } catch (error) {
            for (const id of shardIds) {
                this.shards.get(id)?.close();
                this.shards.delete(id);
                this.#lifecycle.delete(id);
            }
            if (this.#ids)
                this.#ids = this.#ids.filter((id) => !shardIds.includes(id));
            throw error;
        }
    }
    /** Starts the given shards: through the coordinated IDENTIFY gate when there is one, else in paced rounds. */
    async #start(ids: number[], destroyOnFailure = true): Promise<void> {
        const gate = this.#gate;
        if (gate) {
            const timeout = this.#options.handshakeTimeout ?? 15_000;
            const results = await Promise.allSettled(
                ids.map(async (id) => {
                    const gateway = this.shards.get(id)!;
                    this.#setStatus(id, "connecting");
                    await gate.acquire(id);
                    try {
                        await gateway.connect();
                        await handshakeSent(gateway, timeout);
                    } finally {
                        gate.release(id);
                    }
                }),
            );
            const failed = results.findIndex(
                (result) => result.status === "rejected",
            );
            if (failed !== -1) {
                if (destroyOnFailure) this.destroy();
                throw new Error(`Failed to connect shard ${ids[failed]}.`, {
                    cause: (results[failed] as PromiseRejectedResult).reason,
                });
            }
            return;
        }
        const limit = this.#gatewayInfo?.sessionStartLimit;
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
            for (const id of round) this.#setStatus(id, "connecting");
            const results = await Promise.allSettled(
                round.map((id) => this.shards.get(id)!.connect()),
            );
            const failed = results.findIndex(
                (result) => result.status === "rejected",
            );
            if (failed !== -1) {
                if (destroyOnFailure) this.destroy();
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
        for (const id of this.shards.keys()) this.#setStatus(id, "destroyed");
        this.shards.clear();
        this.#lifecycle.clear();
        this.#announced = false;
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
    /** Sends a voice state update (op 4) on the shard that owns the guild. @returns Whether it was sent; `false` if that shard is absent or disconnected. */
    public sendVoiceState(
        guildId: string,
        channelId: string | null,
        options: { selfMute?: boolean; selfDeaf?: boolean } = {},
    ): boolean {
        return (
            this.shards
                .get(this.getShardIdForGuild(guildId))
                ?.sendVoiceState(guildId, channelId, options) ?? false
        );
    }
    /** Gets a shard by ID. @param id Shard identifier. @returns Gateway instance or undefined. */
    public get(id: number): Gateway | undefined {
        return this.shards.get(id);
    }
    /** Returns each shard's connection state, lifecycle status and heartbeat latency. */
    public health(): ShardHealth[] {
        return [...this.shards].map(([id, gateway]) => {
            const life = this.#lifecycle.get(id);
            return {
                id,
                state: gateway.state,
                ping: gateway.ping,
                status: life?.status ?? "idle",
                ...(life?.readyAt !== undefined
                    ? { readyAt: life.readyAt }
                    : {}),
                ...(life?.disconnectedAt !== undefined
                    ? { disconnectedAt: life.disconnectedAt }
                    : {}),
            };
        });
    }
    /** A health report for the parent: shard health and, on request, process metrics. */
    public report(metrics = false): WorkerReport {
        let numbers: WorkerMetrics | undefined;
        if (metrics) {
            const memory = process.memoryUsage();
            const cpu = process.cpuUsage();
            numbers = {
                rssBytes: memory.rss,
                heapUsedBytes: memory.heapUsed,
                cpuUserMicros: cpu.user,
                cpuSystemMicros: cpu.system,
            };
        }
        return {
            shards: this.health(),
            ...(numbers ? { metrics: numbers } : {}),
            reportedAt: Date.now(),
        };
    }
    #setStatus(id: number, status: ShardStatus): void {
        const life = this.#lifecycle.get(id) ?? { status };
        life.status = status;
        const now = Date.now();
        if (status === "ready") life.readyAt = now;
        if (status === "disconnected") life.disconnectedAt = now;
        this.#lifecycle.set(id, life);
        if (status !== "ready") this.#announced = false;
        else this.#maybeAnnounce();
    }
    /** Emits `ready` and tells the parent once every owned shard is ready. */
    #maybeAnnounce(): void {
        if (this.#announced || this.shards.size === 0) return;
        for (const id of this.shards.keys())
            if (this.#lifecycle.get(id)?.status !== "ready") return;
        this.#announced = true;
        this.#emit("ready");
        this.#worker?.ready(this.shardIds);
        this.#worker?.reportHealth(this.report());
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
        const ids = this.#ids ?? Array.from({ length: count }, (_, i) => i);
        validateShardIds(ids, count);
        for (const id of ids) this.shards.set(id, this.#createShard(id, count));
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
        gateway.on("ready", () => {
            this.#setStatus(id, "ready");
            this.#emit("shardReady", id);
        });
        gateway.on("resumed", () => {
            this.#setStatus(id, "ready");
            this.#emit("shardResume", id);
        });
        gateway.on("close", (close) => {
            this.#setStatus(id, "disconnected");
            this.#emit(
                "shardDisconnect",
                id,
                close as { code: number; action: string },
            );
        });
        gateway.on("error", (error) =>
            this.#emit("shardError", id, error as Error),
        );
        gateway.on("unstable", (info) => {
            this.#setStatus(id, "unstable");
            this.#emit(
                "shardUnstable",
                id,
                info as { reconnects: number; delay: number },
            );
        });
        return gateway;
    }
}

/** Discord.js-familiar alias for {@link ShardManager}. */
export { ShardManager as ShardingManager };
