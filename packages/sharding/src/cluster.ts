import { EventEmitter } from "node:events";
import {
    assertGuildsPerShard,
    fetchGatewayBot,
    resolveShardCount,
    type GatewayBotInfo,
} from "./gateway-bot.js";
import { fork, type ChildProcess } from "node:child_process";
import { cpus } from "node:os";
import { REPLY_TYPE, type ReplyPayload, type ShardReply } from "./bus.js";
import {
    planClusters,
    type ClusterCountSource,
    isClusterWorker,
    validateShardIds,
    WORKER_MARKER,
} from "./context.js";
import type {
    ClusterHealth,
    ClusterManagerHealth,
    ClusterState,
    ShardHealth,
    WorkerMetrics,
    WorkerReport,
} from "./health.js";
import {
    IdentifyCoordinator,
    type IdentifyBudget,
    type IdentifyEvent,
} from "./identify.js";
import type { LeaderLock } from "./leader.js";
import {
    CLUSTER_FRAME,
    PARENT_ID,
    REQUEST_ASSIGN,
    REQUEST_HEALTH,
    parseChildFrame,
    type ChildFrame,
} from "./protocol.js";
import { RemoteHosts, type HostStatus, type RemoteOptions } from "./remote.js";
import { RequestTracker } from "./requests.js";
import { ShardSupervisor, type SupervisorOptions } from "./supervisor.js";
import { BUS_FRAME, PEER_DOWN_FRAME } from "./transport.js";

/** Stands in for a cluster process that could not be forked: already exited, kill() a no-op. */
function notStarted(): ChildProcess {
    return Object.assign(new EventEmitter(), {
        exitCode: 1,
        signalCode: null,
        connected: false,
        pid: undefined,
        kill: () => false,
    }) as unknown as ChildProcess;
}

/** What the `plan` event reports. */
export interface ClusterPlanInfo {
    /** The deployment's shard count (Discord's `num_shards`), the same in every worker. */
    totalShards: number;
    clusterCount: number;
    /** `"clusterCount"`, `"shardsPerCluster"` or `"default"` (the number of CPUs). */
    clusterCountSource: ClusterCountSource;
    /** The count asked for; larger than `clusterCount` when there were more clusters than shards. */
    requestedClusterCount: number;
    clusters: { id: number; shards: number[] }[];
    maxConcurrency: number;
    startup: "safe" | "sequential";
    identifyCoordinated: boolean;
}

/** Configuration for managing multiple shard clusters. */
export interface ClusterManagerOptions {
    /** Discord bot token. */
    token: string;
    /** Path to the worker script to execute for each cluster. */
    script: string;
    /** Total number of shards. Use "auto" to request Discord's recommended count. */
    shardCount?: number | "auto";
    /**
     * A sizing hint for `shardCount: "auto"`: run at least
     * `ceil(guildCount / guildsPerShard)` shards, and never fewer than Discord
     * recommends. 1 to 2500 (Discord's limit); Discord recommends about 1000.
     * It only picks the shard count: Discord puts each guild on shard
     * `(guild_id >> 22) % shardCount`, so shards get about this many guilds,
     * not exactly, and ownership never follows from it.
     */
    guildsPerShard?: number;
    /** The bot's guild count for `guildsPerShard`, instead of asking Discord for it. */
    guildCount?: number;
    /**
     * The shards this deployment runs, out of `shardCount`. Use it to split one
     * bot across hosts: each host runs a `ClusterManager` with its own range.
     * Defaults to every shard.
     */
    shardIds?: number[];
    /** Number of clusters to spawn. Defaults to the number of logical CPUs. Not combinable with `shardsPerCluster`. */
    clusterCount?: number;
    /** Shards per cluster; the cluster count follows. Not combinable with `clusterCount`. */
    shardsPerCluster?: number;
    /**
     * Discord's `max_concurrency` for IDENTIFY pacing. Fetched from `/gateway/bot`
     * when `shardCount` is "auto" (this value may only lower it); otherwise defaults to 1.
     */
    maxConcurrency?: number;
    /** Ask `/gateway/bot` for `max_concurrency` and the session budget even with a fixed `shardCount`. */
    fetchLimits?: boolean;
    /**
     * How shards start across the whole deployment.
     * - `"safe"` (default): as fast as Discord allows. One IDENTIFY per
     *   rate-limit key (`shard_id % max_concurrency`) every `identify.interval`,
     *   keys in parallel; a slot is freed as soon as the IDENTIFY is sent.
     * - `"sequential"`: one shard at a time across all clusters, in the order
     *   they ask (cluster by cluster, as they spawn). Each slot is held until that shard is READY (or
     *   `identify.holdTimeout` passes), then the next shard waits the interval.
     *   Slow, for debugging and small bots. Needs IDENTIFY coordination.
     */
    startup?: "safe" | "sequential";
    /** IDENTIFY coordination across clusters. On by default. */
    identify?: {
        /** Set `false` to let every cluster pace its own IDENTIFYs. */
        coordinate?: boolean;
        /** Milliseconds between IDENTIFYs on one key. Default 5000. */
        interval?: number;
        /** A slot a worker never releases is released after this many ms. Default 60,000. */
        holdTimeout?: number;
    };
    /** Milliseconds between forking two clusters, to spread the CPU cost of starting. Default 500. IDENTIFY pacing does not depend on it. */
    spawnInterval?: number;
    /**
     * A cluster that has not reported ready this many ms after it was forked is
     * killed and restarted like a crash. Off by default, because a worker that
     * never reports ready (no `ShardManager`, no `ClusterWorker`) would be killed.
     */
    startTimeout?: number;
    /** Make `spawn()` wait until every cluster reported ready. Default false. */
    waitForReady?: boolean;
    /**
     * When a cluster crashes more often than `supervisor.maxRestarts` allows,
     * move its shards to the healthiest ready cluster instead of leaving them
     * offline. Default false.
     */
    reassignOnGiveUp?: boolean;
    /**
     * Largest shard-bus message, request payload or worker reply the manager
     * handles, in UTF-8 bytes (a string as it is, anything else as its JSON text). Bigger ones from a worker are
     * dropped before they are relayed (an `error` event says so; a request
     * waiting for the answer times out as usual), and bigger ones passed to
     * `request()`, `broadcast()` or `requestCluster()` throw a `RangeError`.
     * Default 8 MiB, the same limit as the host link.
     */
    maxMessageBytes?: number;
    /** Default timeout for `request()`, `requestCluster()` and `broadcast()`. Default 5000. */
    requestTimeout?: number;
    /** Most requests waiting for answers at once. Default 10,000. */
    maxPendingRequests?: number;
    /**
     * Accept hosts on other machines. The coordinator listens for
     * `ClusterHost` agents, places clusters on them and supervises those
     * workers like local ones. See {@link RemoteOptions}.
     */
    remote?: RemoteOptions;
    /**
     * Run several coordinators of one deployment, one active at a time, so a
     * standby takes over when the active one dies (`RedisLeaderLock`, or your
     * own {@link LeaderLock}). `spawn()` waits until this coordinator holds
     * the lock. The leader renews it every quarter of `ttl`; if it cannot for
     * half of `ttl` (or another holds it) it kills every cluster at once,
     * closes the host listener, and waits to lead again. A new leader waits
     * two `remote.lease`s before it starts clusters, so the previous leader's
     * hosts have fenced themselves. Point hosts at every coordinator
     * (`ClusterHost` `url` as a list).
     */
    leader?: {
        lock: LeaderLock;
        /** Lock lifetime in ms. Default 10,000; at least 100. */
        ttl?: number;
    };
    /** Starts a worker process. Defaults to `child_process.fork()`; replace it for tests or custom launchers. */
    fork?: (
        script: string,
        env: Record<string, string | undefined>,
    ) => ChildProcess;
    /** Interval in milliseconds to automatically check for recommended shard count and re-scale if needed. */
    autoScaleInterval?: number;
    /** Optional handler invoked when a background auto-scale check fails. Receives the thrown error. */
    onAutoScaleError?: (error: Error) => void;
    /** Grace period in milliseconds to await a cluster's clean exit after SIGTERM before force-killing. Defaults to 5000. */
    shutdownTimeout?: number;
    /**
     * Whether a cluster that exits unexpectedly is re-forked with the same
     * shard assignment. Defaults to true: without it a crashed child leaves
     * its shards permanently offline and nothing reports it.
     */
    restartOnExit?: boolean;
    /** Delay in milliseconds before re-forking a crashed cluster. Defaults to 5000. */
    restartDelay?: number;
    /**
     * Backoff, jitter and a give-up limit for restarts. `restartDelay` is its
     * first delay unless it sets its own. The default restarts every crash
     * after a fixed delay, as before.
     */
    supervisor?: Omit<SupervisorOptions, "restartDelay"> & {
        restartDelay?: number;
    };
    /** Called when a cluster crashed more often than `supervisor.maxRestarts` allows and will not be restarted. */
    onGiveUp?(cluster: ClusterInfo): void;
    /** Called whenever a cluster process exits, before any restart. */
    onClusterExit?(
        cluster: ClusterInfo,
        code: number | null,
        signal: NodeJS.Signals | null,
    ): void;
}

/** Information about a cluster. The object is live: it is updated as the cluster changes. */
export interface ClusterInfo {
    /** Cluster identifier. */
    id: number;
    /** The current child process (the last one while a restart is pending). For a cluster on another host this is a proxy; `pid` is the pid on that host. */
    process: ChildProcess;
    /** Where it runs: `"local"` or a host ID. */
    host: string;
    /** The shard IDs managed by this cluster. */
    shards: number[];
    /** Where the cluster is in its life. */
    state: ClusterState;
    /** How many times it was restarted after a crash. */
    restarts: number;
    /** When the current process was forked (epoch ms). */
    startedAt: number;
    /** When the current process reported ready. */
    readyAt?: number;
    /** When any process of this cluster last reported ready. */
    lastReadyAt?: number;
    /** The worker's last health report. */
    report?: WorkerReport;
}

/** What `ClusterManager` emits. */
export interface ClusterManagerEvents {
    /** A cluster process was forked. */
    clusterSpawn: [cluster: ClusterInfo];
    /** A cluster's shards all finished their handshake. */
    clusterReady: [cluster: ClusterInfo];
    /** Every cluster is ready. Emitted again after a recovery. */
    ready: [];
    /** A cluster process exited. `expected` is true for a deliberate shutdown. */
    clusterExit: [
        cluster: ClusterInfo,
        code: number | null,
        signal: NodeJS.Signals | null,
        expected: boolean,
    ];
    /** A restart was scheduled after a crash. */
    clusterRestart: [
        cluster: ClusterInfo,
        info: { delay: number; attempt: number },
    ];
    /** A cluster keeps crashing: three or more restarts are pending or recent. */
    clusterUnstable: [
        cluster: ClusterInfo,
        info: { attempt: number; delay: number },
    ];
    /** A cluster did not report ready within `startTimeout` and was killed. */
    clusterStartTimeout: [cluster: ClusterInfo];
    /** A cluster crashed too often and will not be restarted. */
    clusterGiveUp: [cluster: ClusterInfo];
    /** A failed cluster's shards were moved to another cluster. */
    shardsReassigned: [info: { shardIds: number[]; from: number; to: number }];
    /** A host joined the deployment. */
    hostJoin: [hostId: string];
    /** A host left or was lost. Its clusters are treated as crashed. */
    hostLeave: [hostId: string, reason: string];
    /** A lost host's cluster is restarting on another host (`remote.moveClusters`). */
    clusterMoved: [cluster: ClusterInfo, info: { from: string; to: string }];
    /** This coordinator took the `leader` lock and will start the clusters. */
    leaderAcquired: [];
    /** This coordinator lost the `leader` lock and killed its clusters; it waits to lead again. */
    leaderLost: [reason: string];
    /** An IDENTIFY is waiting for the session-start budget to reset. */
    identifyWait: [info: { shardId: number; waitMs: number }];
    /** The allocation of a start: total shards, the cluster count and where it came from, each cluster's shards. */
    plan: [plan: ClusterPlanInfo];
    /** The IDENTIFY queue: a shard asked for a slot, got it, or gave it back. */
    identify: [event: IdentifyEvent];
    /** `shutdownAll()` finished: every cluster process has exited (or was killed after the timeout). */
    shutdown: [info: { clusters: number; durationMs: number }];
    /** Something went wrong that did not stop the deployment (a bad frame, a failed recovery). */
    error: [error: Error];
}

/** Options for a request to a shard or cluster. */
export interface RequestOptions {
    /** Milliseconds to wait. Defaults to `requestTimeout`. */
    timeoutMs?: number;
    /** Cancels the wait. */
    signal?: AbortSignal;
}

/** What a broadcast collected. It never rejects for a slow or failed shard. */
export interface BroadcastResult<R = unknown> {
    /** One reply per answering shard: its result, or the error its handler threw. */
    replies: ShardReply<R>[];
    /** Shards that did not answer: down, restarting, or too slow. */
    missing: number[];
}

type LiveState = "starting" | "ready";

/** Default for `maxMessageBytes`. */
const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

/**
 * The size of a payload in UTF-8 bytes: a string as it is, anything else as
 * its JSON text. `Infinity` for one that cannot be serialized (a cycle).
 */
function payloadSize(value: unknown): number {
    if (value === undefined || value === null) return 0;
    if (typeof value === "string") return Buffer.byteLength(value, "utf8");
    if (typeof value !== "object") return String(value).length;
    try {
        const text = JSON.stringify(value);
        return text === undefined ? 0 : Buffer.byteLength(text, "utf8");
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

const isLive = (state: ClusterState): state is LiveState =>
    state === "starting" || state === "ready";

/**
 * Orchestrates cluster processes: forks one worker per cluster, gives each a
 * fixed set of shards, restarts crashed clusters with backoff, hands out
 * IDENTIFY slots across all of them, routes shard-bus messages to the cluster
 * that owns the target shard, and answers requests, broadcasts and health
 * queries for the whole deployment.
 *
 * Ownership: the `ClusterManager` decides which cluster owns which shard and
 * keeps processes alive; the `ShardManager` inside each worker runs those
 * shards' Gateways. A shard is never owned by two clusters at once.
 *
 * Works under Node.js and Bun (`child_process.fork()` with IPC).
 */
export class ClusterManager {
    /** Live clusters (starting or ready) indexed by cluster ID. A crashed cluster leaves this map until it is restarted. */
    public readonly clusters = new Map<number, ClusterInfo>();
    /** Total number of shards in the deployment. */
    public shardCount = 0;

    readonly #options: ClusterManagerOptions;
    /** Whether the manager was created in auto shard-count mode. Preserved across respawns so auto-scaling keeps running. */
    readonly #auto: boolean;
    #autoScaleTimer?: ReturnType<typeof setInterval>;
    /** Every cluster this deployment knows, whatever its state. */
    readonly #infos = new Map<number, ClusterInfo>();
    /** Which cluster owns each shard. */
    readonly #owner = new Map<number, number>();
    #startPromise?: Promise<void>;
    #stopPromise?: Promise<void>;
    #wasStarted = false;
    /** Set while a deliberate shutdown is in progress so exits are not restarted. */
    #stopping = false;
    /** Bumped by every stop, so a start that was waiting notices it is stale. */
    #generation = 0;
    #leading = false;
    #renewTimer?: ReturnType<typeof setInterval>;
    /** When the last successful renewal was sent (epoch ms). */
    #lastRenew = 0;
    #renewing = false;
    /** Bumped by every leadership term, so a late renewal of an old one is ignored. */
    #term = 0;
    /** Pending restart timers, kept so shutdown can cancel them. */
    readonly #restartTimers = new Set<ReturnType<typeof setTimeout>>();
    /** Restarts waiting for a lost host to fence itself, by cluster. */
    readonly #fencing = new Map<number, ReturnType<typeof setTimeout>>();
    readonly #startTimers = new Map<number, ReturnType<typeof setTimeout>>();
    readonly #pauses = new Set<() => void>();
    readonly #readyWaiters = new Set<{
        resolve: () => void;
        reject: (error: Error) => void;
        timer?: ReturnType<typeof setTimeout>;
    }>();
    readonly #supervisor: ShardSupervisor;
    readonly #tracker: RequestTracker;
    #coordinator?: IdentifyCoordinator;
    #allReady = false;
    #clusterCount = 0;
    /** Shards of each cluster that are waiting for an IDENTIFY slot. */
    readonly #identifyWaiting = new Map<number, Set<number>>();
    readonly #remote?: RemoteHosts;
    /** Which host runs each cluster. Fixed for the life of a spawn, so a cluster returns to its host. */
    readonly #hostOf = new Map<number, string>();
    #lastWait = "";
    readonly #listeners = new Map<
        keyof ClusterManagerEvents,
        Set<(...args: never[]) => void>
    >();

    /** Creates a cluster manager. @param options Clustering configuration. @throws {TypeError} If token or script is missing. @throws {RangeError} If a numeric option is invalid. */
    public constructor(options: ClusterManagerOptions) {
        if (!options.token?.trim())
            throw new TypeError("A Discord bot token is required.");
        if (!options.script?.trim())
            throw new TypeError("A script path is required for clustering.");
        if (
            options.autoScaleInterval !== undefined &&
            (!Number.isInteger(options.autoScaleInterval) ||
                options.autoScaleInterval < 1000)
        ) {
            throw new RangeError(
                "autoScaleInterval must be an integer of at least 1000 milliseconds.",
            );
        }
        if (
            options.clusterCount !== undefined &&
            options.shardsPerCluster !== undefined
        )
            throw new RangeError(
                "Set either clusterCount or shardsPerCluster, not both.",
            );
        for (const [name, value] of [
            ["clusterCount", options.clusterCount],
            ["shardsPerCluster", options.shardsPerCluster],
            ["maxConcurrency", options.maxConcurrency],
        ] as const)
            if (value !== undefined && (!Number.isInteger(value) || value < 1))
                throw new RangeError(`${name} must be a positive integer.`);
        if (
            options.maxMessageBytes !== undefined &&
            (!Number.isInteger(options.maxMessageBytes) ||
                options.maxMessageBytes < 1)
        )
            throw new RangeError("maxMessageBytes must be a positive integer.");
        for (const [name, value] of [
            ["spawnInterval", options.spawnInterval],
            ["startTimeout", options.startTimeout],
            ["requestTimeout", options.requestTimeout],
        ] as const)
            if (value !== undefined && !(value >= 0))
                throw new RangeError(`${name} cannot be negative.`);
        if (
            options.startup !== undefined &&
            options.startup !== "safe" &&
            options.startup !== "sequential"
        )
            throw new RangeError('startup must be "safe" or "sequential".');
        if (
            options.startup === "sequential" &&
            options.identify?.coordinate === false
        )
            throw new RangeError(
                'startup: "sequential" needs IDENTIFY coordination; remove identify.coordinate: false.',
            );
        if (options.guildsPerShard !== undefined) {
            assertGuildsPerShard(options.guildsPerShard);
            if (typeof options.shardCount === "number")
                throw new RangeError(
                    'guildsPerShard needs shardCount: "auto".',
                );
        }
        if (options.shardIds && typeof options.shardCount === "number")
            validateShardIds(options.shardIds, options.shardCount);

        this.#auto = options.shardCount === "auto";
        const ttl = options.leader?.ttl;
        if (
            options.leader &&
            (typeof options.leader.lock?.acquire !== "function" ||
                typeof options.leader.lock.release !== "function")
        )
            throw new TypeError(
                "leader.lock must have acquire() and release().",
            );
        if (ttl !== undefined && (!Number.isInteger(ttl) || ttl < 100))
            throw new RangeError(
                "leader.ttl must be an integer of at least 100.",
            );
        this.#options = { ...options };
        this.#supervisor = new ShardSupervisor({
            restartDelay: options.restartDelay,
            ...options.supervisor,
        });
        this.#tracker = new RequestTracker(
            "parent",
            options.maxPendingRequests,
        );
        if (options.remote)
            this.#remote = new RemoteHosts(options.remote, {
                join: (id) => this.#hostJoined(id),
                leave: (id, reason) => this.#emit("hostLeave", id, reason),
                error: (error) => this.#emit("error", error),
            });
    }

    /** Listens for a deployment event. @returns This manager. */
    public on<E extends keyof ClusterManagerEvents>(
        event: E,
        listener: (...args: ClusterManagerEvents[E]) => void,
    ): this {
        let set = this.#listeners.get(event);
        if (!set) this.#listeners.set(event, (set = new Set()));
        set.add(listener as never);
        return this;
    }

    /** Stops listening for a deployment event. @returns This manager. */
    public off<E extends keyof ClusterManagerEvents>(
        event: E,
        listener: (...args: ClusterManagerEvents[E]) => void,
    ): this {
        this.#listeners.get(event)?.delete(listener as never);
        return this;
    }

    #emit<E extends keyof ClusterManagerEvents>(
        event: E,
        ...args: ClusterManagerEvents[E]
    ): void {
        for (const listener of this.#listeners.get(event) ?? [])
            try {
                (listener as (...a: ClusterManagerEvents[E]) => void)(...args);
            } catch {
                // A faulty listener must not break supervision.
            }
    }

    /** Retrieves Discord's recommended shard count. @returns Recommended shard count. @throws {Error} If discovery fails or returns invalid data. */
    public async fetchRecommendedShardCount(): Promise<number> {
        return resolveShardCount(
            this.#options.token,
            await fetchGatewayBot(this.#options.token),
            this.#options,
        );
    }

    /** The cluster that owns a shard, or `undefined` when the shard is not part of this deployment. */
    public clusterForShard(shardId: number): ClusterInfo | undefined {
        const id = this.#owner.get(shardId);
        return id === undefined ? undefined : this.#infos.get(id);
    }

    /** Which cluster owns each shard. A copy: change ownership through recovery, not by writing to it. */
    public assignments(): ReadonlyMap<number, number> {
        return new Map(this.#owner);
    }

    /**
     * Spawns all clusters. Calling it again while clusters run, or while the
     * first call is still starting them, returns the same promise.
     * @throws {Error} If called from a cluster worker (a worker must not start the fleet again).
     */
    public spawn(): Promise<void> {
        if (isClusterWorker())
            return Promise.reject(
                new Error(
                    "A cluster worker cannot start a ClusterManager: it would fork the whole fleet again.",
                ),
            );
        if (this.#stopPromise)
            return this.#stopPromise.then(() => this.spawn());
        if (!this.#startPromise) {
            const attempt = this.#start();
            this.#startPromise = attempt;
            attempt.catch(() => {
                if (this.#startPromise === attempt)
                    this.#startPromise = undefined;
            });
        }
        return this.#startPromise;
    }

    async #resolveGateway(): Promise<{
        count: number;
        maxConcurrency: number;
        budget?: IdentifyBudget;
    }> {
        const { shardCount, maxConcurrency, fetchLimits } = this.#options;
        let info: GatewayBotInfo | undefined;
        let count: number | undefined;
        if (shardCount === "auto" || shardCount === undefined) {
            info = await fetchGatewayBot(this.#options.token);
            count = await resolveShardCount(
                this.#options.token,
                info,
                this.#options,
            );
        } else if (fetchLimits || this.#auto)
            // A respawn of an "auto" deployment has a number by now, but it
            // still needs `max_concurrency` and the session budget.
            try {
                info = await fetchGatewayBot(this.#options.token);
            } catch (error) {
                this.#emit(
                    "error",
                    error instanceof Error ? error : new Error(String(error)),
                );
            }
        const limit = info?.sessionStartLimit;
        return {
            count: count ?? (shardCount as number),
            maxConcurrency: Math.min(
                maxConcurrency ?? limit?.maxConcurrency ?? 1,
                limit?.maxConcurrency ?? Number.POSITIVE_INFINITY,
            ),
            ...(limit
                ? {
                      budget: {
                          total: limit.total,
                          remaining: limit.remaining,
                          resetAfter: limit.resetAfter,
                      },
                  }
                : {}),
        };
    }

    async #start(): Promise<void> {
        const generation = this.#generation;
        const stale = (): boolean =>
            this.#stopping || generation !== this.#generation;
        if (this.#options.leader && !this.#leading) {
            await this.#lead();
            if (stale()) return;
        }
        const { count, maxConcurrency, budget } = await this.#resolveGateway();
        if (stale()) return;

        const ids =
            this.#options.shardIds ??
            Array.from({ length: count }, (_, i) => i);
        validateShardIds(ids, count);
        const plan = planClusters({
            shardIds: ids,
            clusterCount: this.#options.clusterCount,
            shardsPerCluster: this.#options.shardsPerCluster,
            defaultClusterCount: Math.max(1, cpus().length),
        });
        const chunks = plan.clusters;

        const placement = await this.#placeHosts().catch((error: unknown) => {
            // A shutdown that interrupts the wait is not a failure of the start.
            if (stale()) return undefined;
            throw error;
        });
        if (!placement || stale()) return;

        this.shardCount = count;
        this.#wasStarted = true;
        this.#owner.clear();
        this.#infos.clear();
        const identify = this.#options.identify;
        this.#coordinator =
            identify?.coordinate === false
                ? undefined
                : new IdentifyCoordinator({
                      // Sequential: every shard shares one key, so one starts at a time.
                      maxConcurrency:
                          this.#options.startup === "sequential"
                              ? 1
                              : maxConcurrency,
                      onEvent: (event) => this.#emit("identify", event),
                      interval: identify?.interval,
                      holdTimeout: identify?.holdTimeout,
                      budget,
                      onBudgetWait: (wait) => {
                          const key = `${wait.shardId}:${Math.round(wait.waitMs / 1000)}`;
                          if (key === this.#lastWait) return;
                          this.#lastWait = key;
                          this.#emit("identifyWait", wait);
                      },
                  });

        const active = chunks.map((shards, id) => ({ id, shards }));
        this.#clusterCount = active.length;
        this.#emit("plan", {
            totalShards: count,
            clusterCount: active.length,
            clusterCountSource: plan.source,
            requestedClusterCount: plan.requested,
            clusters: active.map((chunk) => ({
                id: chunk.id,
                shards: chunk.shards,
            })),
            maxConcurrency,
            startup: this.#options.startup ?? "safe",
            identifyCoordinated: this.#coordinator !== undefined,
        });
        this.#hostOf.clear();
        for (const chunk of active)
            this.#hostOf.set(chunk.id, placement[chunk.id % placement.length]!);
        for (const [index, chunk] of active.entries()) {
            if (stale()) return;
            for (const shard of chunk.shards) this.#owner.set(shard, chunk.id);
            this.#launchOrRecover(chunk.id, chunk.shards);
            // Spread the CPU cost of starting processes. IDENTIFY pacing is
            // the coordinator's job and does not depend on this.
            const gap = this.#options.spawnInterval ?? 500;
            if (index < active.length - 1 && gap > 0) await this.#pause(gap);
        }
        if (stale()) return;

        if (this.#options.waitForReady) await this.ready();
        if (
            this.#options.autoScaleInterval &&
            this.#options.autoScaleInterval > 0
        ) {
            this.#autoScaleTimer = setInterval(() => {
                void this.checkAutoScale();
            }, this.#options.autoScaleInterval);
        }
    }

    /** Whether this coordinator holds the `leader` lock; always true without `leader`. */
    public get isLeader(): boolean {
        return !this.#options.leader || this.#leading;
    }

    /**
     * Waits until this coordinator holds the leader lock, then for the
     * previous leader's hosts to fence themselves.
     */
    async #lead(): Promise<void> {
        const { lock, ttl = 10_000 } = this.#options.leader!;
        const generation = this.#generation;
        while (!this.#stopping && generation === this.#generation) {
            const started = Date.now();
            let held = false;
            try {
                // A lock that never answers must not hold up a shutdown.
                held = await withTimeout(lock.acquire(ttl), ttl / 2);
            } catch (error) {
                this.#emit("error", asError(error));
            }
            if (this.#stopping || generation !== this.#generation) {
                if (held) void lock.release().catch(() => undefined);
                return;
            }
            if (held) {
                this.#leading = true;
                this.#lastRenew = started;
                this.#startRenewing(ttl);
                this.#emit("leaderAcquired");
                const lease = this.#options.remote
                    ? (this.#options.remote.lease ?? 15_000)
                    : 0;
                if (lease > 0) await this.#pause(lease * 2);
                return;
            }
            await this.#pause(Math.floor(ttl / 2));
        }
    }

    #startRenewing(ttl: number): void {
        this.#stopRenewing();
        const lock = this.#options.leader!.lock;
        // Each term renews on its own: a renewal of an earlier term that
        // settles late (or never) must neither block nor end this one.
        const term = ++this.#term;
        this.#renewing = false;
        this.#renewTimer = setInterval(
            () => {
                // Stand down well before the lock can lapse and another
                // coordinator can take it: by 3/4 of ttl at the latest.
                if (Date.now() - this.#lastRenew > ttl / 2) {
                    this.#standDown("The leader lock could not be renewed.");
                    return;
                }
                if (this.#renewing) return;
                this.#renewing = true;
                const started = Date.now();
                withTimeout(lock.acquire(ttl), ttl / 4).then(
                    (held) => {
                        if (term !== this.#term) return;
                        this.#renewing = false;
                        if (!this.#leading) return;
                        if (held) this.#lastRenew = started;
                        else
                            this.#standDown(
                                "Another coordinator holds the leader lock.",
                            );
                    },
                    (error: unknown) => {
                        if (term !== this.#term) return;
                        this.#renewing = false;
                        this.#emit("error", asError(error));
                    },
                );
            },
            Math.max(10, Math.floor(ttl / 4)),
        );
        (this.#renewTimer as { unref?: () => void }).unref?.();
    }

    #stopRenewing(): void {
        if (this.#renewTimer) clearInterval(this.#renewTimer);
        this.#renewTimer = undefined;
    }

    /** Gives the lock back on a deliberate stop. */
    async #resign(): Promise<void> {
        this.#stopRenewing();
        if (!this.#leading) return;
        this.#leading = false;
        const { lock, ttl = 10_000 } = this.#options.leader!;
        try {
            await withTimeout(lock.release(), ttl / 2);
        } catch (error) {
            this.#emit("error", asError(error));
        }
    }

    /**
     * Lost the lock: kill every cluster now (no grace period, a successor may
     * already be counting down), close the host listener so hosts fence, and
     * wait to lead again.
     */
    #standDown(reason: string): void {
        if (!this.#leading) return;
        this.#stopRenewing();
        this.#leading = false;
        this.#stopping = true;
        this.#halt();
        for (const cluster of this.#infos.values()) {
            cluster.state = "stopped";
            try {
                cluster.process.kill("SIGKILL");
            } catch {
                // Already gone.
            }
        }
        this.clusters.clear();
        this.#startPromise = undefined;
        this.#remote?.stop();
        this.#stopping = false;
        this.#emit("leaderLost", reason);
        this.spawn().catch((error: unknown) =>
            this.#emit("error", asError(error)),
        );
    }

    /** Opens the listener for hosts and waits for them. @returns The places clusters run, in placement order. */
    async #placeHosts(): Promise<string[]> {
        const remote = this.#remote;
        const options = this.#options.remote;
        if (!remote || !options) return ["local"];
        remote.start();
        try {
            await remote.waitFor(
                options.hosts,
                options.minHosts ?? 1,
                options.joinTimeout ?? 60_000,
            );
        } catch (error) {
            remote.stop();
            throw error;
        }
        const ids = options.hosts ?? remote.connected();
        return options.local ? ["local", ...ids] : ids;
    }

    /** The port hosts connect to, once the listener is open (useful with `remote.port: 0`). */
    public get remotePort(): number | undefined {
        return this.#remote?.port;
    }

    /** The hosts of this deployment: connected or not, and the clusters on each. Empty without `remote`. */
    public hosts(): HostStatus[] {
        return this.#remote?.status(this.#options.remote?.hosts) ?? [];
    }

    /** Waits `ms`, or less when a shutdown starts. */
    #pause(ms: number): Promise<void> {
        return new Promise((resolve) => {
            const wake = (): void => {
                clearTimeout(timer);
                this.#pauses.delete(wake);
                resolve();
            };
            const timer = setTimeout(wake, ms);
            this.#pauses.add(wake);
        });
    }

    /**
     * Forks one cluster child and supervises its exit.
     *
     * A child that dies (crash, OOM kill, uncaught rejection) takes its shards
     * offline for good, so unless the exit came from a deliberate shutdown the
     * same shard assignment is re-forked after the supervisor's delay.
     */
    #launch(id: number, shards: number[]): ClusterInfo {
        // Only these cross to a remote host; the rest of a worker's environment is the host's own.
        const contract: Record<string, string> = {
            SHARD_LIST: shards.join(","),
            SHARD_COUNT: this.shardCount.toString(),
            CLUSTER_ID: id.toString(),
            CLUSTER_COUNT: this.#clusterCount.toString(),
            LUNIBEE_SHARD_BUS: "ipc",
            [WORKER_MARKER]: "1",
            LUNIBEE_IDENTIFY: this.#coordinator ? "coordinated" : "local",
            // Only when set: hosts older than this option reject unknown keys.
            ...(this.#options.startup === "sequential"
                ? { LUNIBEE_STARTUP: "sequential" }
                : {}),
        };
        const host = this.#hostOf.get(id) ?? "local";
        const env: Record<string, string | undefined> = {
            ...process.env,
            ...contract,
        };
        const child =
            host !== "local" && this.#remote
                ? this.#remote.createChild(host, id, contract)
                : this.#options.fork
                  ? this.#options.fork(this.#options.script, env)
                  : fork(this.#options.script, [], {
                        env: env as NodeJS.ProcessEnv,
                    });
        const known = this.#infos.get(id);
        const info: ClusterInfo = known ?? {
            id,
            host,
            process: child,
            shards,
            state: "starting",
            restarts: 0,
            startedAt: Date.now(),
        };
        info.process = child;
        info.state = "starting";
        info.startedAt = Date.now();
        info.readyAt = undefined;
        this.#infos.set(id, info);
        this.clusters.set(id, info);
        this.#allReady = false;

        // `send()` can fail after it returned: a worker that exits while a frame
        // is being written emits `error` (EPIPE, "Channel closed") later. With no
        // listener that is an uncaught exception, and it would end the manager.
        // The worker's `exit` event does the actual recovery.
        child.on("error", (error: Error) =>
            this.#emit(
                "error",
                new Error(`Cluster ${id} process error: ${error.message}`, {
                    cause: error,
                }),
            ),
        );
        child.on("message", (frame) => this.#onFrame(info, child, frame));
        child.once("exit", (code, signal) =>
            this.#onExit(info, child, code, signal),
        );
        const timeout = this.#options.startTimeout;
        if (timeout) {
            const timer = setTimeout(() => {
                this.#startTimers.delete(id);
                if (info.process !== child || info.state !== "starting") return;
                this.#emit("clusterStartTimeout", info);
                try {
                    child.kill("SIGKILL");
                } catch {
                    // Already gone; the exit handler takes over.
                }
            }, timeout);
            (timer as { unref?: () => void }).unref?.();
            this.#startTimers.set(id, timer);
        }
        this.#emit("clusterSpawn", info);
        return info;
    }

    #onExit(
        info: ClusterInfo,
        child: ChildProcess,
        code: number | null,
        signal: NodeJS.Signals | null,
    ): void {
        // Only act on the process still registered as this cluster: a
        // restart or respawn may already have replaced it, and after
        // `killAll()` + `spawn()` a new `ClusterInfo` holds the same id.
        if (!this.#current(info, child)) {
            child.removeAllListeners("message");
            return;
        }
        child.removeAllListeners("message");
        this.#clearStartTimer(info.id);
        this.#coordinator?.drop(info.id, `Cluster ${info.id} exited.`);
        this.#identifyWaiting.delete(info.id);
        this.#tracker.failOwner(info.id, `Cluster ${info.id} exited.`);
        this.clusters.delete(info.id);
        this.#allReady = false;
        try {
            this.#options.onClusterExit?.(info, code, signal);
        } catch {
            // A faulty consumer callback must not break supervision.
        }
        // A deliberate shutdown (graceful or `killAll()`) is never restarted.
        const expected =
            this.#stopping ||
            info.state === "stopping" ||
            info.state === "stopped";
        this.#emit("clusterExit", info, code, signal, expected);
        if (expected) {
            info.state = "stopped";
            return;
        }
        this.#announceDown(info.id, info.shards);
        this.#recover(info);
    }

    /**
     * Forks a cluster; a fork that throws (EAGAIN, EMFILE, a bad script path
     * for a custom `fork`) is a failed start of that cluster only. It goes
     * through the restart policy like a crash, and the clusters after it are
     * still started.
     */
    #launchOrRecover(id: number, shards: number[]): void {
        try {
            this.#launch(id, shards);
        } catch (error) {
            const known = this.#infos.get(id);
            if (known) known.process = notStarted();
            const info: ClusterInfo = this.#infos.get(id) ?? {
                id,
                host: this.#hostOf.get(id) ?? "local",
                process: notStarted(),
                shards,
                state: "starting",
                restarts: 0,
                startedAt: Date.now(),
            };
            this.#infos.set(id, info);
            this.clusters.delete(id);
            this.#allReady = false;
            this.#emit(
                "error",
                new Error(
                    `Cluster ${id} (shards ${shards.join(",")}) could not be spawned: ${error instanceof Error ? error.message : String(error)}`,
                    { cause: error },
                ),
            );
            this.#recover(info);
        }
    }

    /** Applies the restart policy to a cluster that exited or failed to start. */
    #recover(info: ClusterInfo): void {
        if (this.#options.restartOnExit === false) {
            info.state = "failed";
            this.#rejectReady(info, "restartOnExit is false");
            return;
        }
        const delay = this.#supervisor.next(info.id);
        if (delay === null) {
            info.state = "failed";
            try {
                this.#options.onGiveUp?.(info);
            } catch {
                // A faulty consumer callback must not break supervision.
            }
            this.#emit("clusterGiveUp", info);
            if (this.#options.reassignOnGiveUp) void this.#reassign(info);
            else this.#rejectReady(info, "restarts exhausted");
            return;
        }
        info.state = "restarting";
        info.restarts++;
        this.#emit("clusterRestart", info, { delay, attempt: info.restarts });
        // Unstable means recent: crashes forgiven after a stable run do not count.
        if (this.#supervisor.attempts(info.id) >= 3)
            this.#emit("clusterUnstable", info, {
                attempt: info.restarts,
                delay,
            });
        this.#restartLater(info, delay);
    }

    /** Re-forks a restarting cluster after `delay`, on another host if its own is lost. */
    #restartLater(
        info: ClusterInfo,
        delay: number,
    ): ReturnType<typeof setTimeout> {
        const timer = setTimeout(() => {
            this.#restartTimers.delete(timer);
            this.#fencing.delete(info.id);
            if (this.#stopping || info.state !== "restarting") return;
            const wait = this.#relocate(info);
            if (wait > 0)
                this.#fencing.set(info.id, this.#restartLater(info, wait));
            else this.#launchOrRecover(info.id, info.shards);
        }, delay);
        // Do not hold the event loop open purely for a pending restart.
        (timer as { unref?: () => void }).unref?.();
        this.#restartTimers.add(timer);
        return timer;
    }

    /** A host joined: clusters waiting for it to fence start there now. */
    #hostJoined(hostId: string): void {
        this.#emit("hostJoin", hostId);
        for (const [id, timer] of [...this.#fencing]) {
            const info = this.#infos.get(id);
            if (this.#hostOf.get(id) !== hostId || !info) continue;
            clearTimeout(timer);
            this.#restartTimers.delete(timer);
            this.#fencing.delete(id);
            if (!this.#stopping && info.state === "restarting")
                this.#launchOrRecover(info.id, info.shards);
        }
    }

    /**
     * Moves a cluster whose host is lost to the connected place running the
     * fewest clusters (`remote.moveClusters`). Its old workers must be gone
     * first, so a shard never runs on two hosts.
     * @returns Milliseconds to wait before the lost host is certainly fenced, or 0.
     */
    #relocate(info: ClusterInfo): number {
        const remote = this.#remote;
        const host = this.#hostOf.get(info.id) ?? "local";
        if (
            !remote ||
            this.#options.remote?.moveClusters === false ||
            host === "local" ||
            remote.isConnected(host)
        )
            return 0;
        const wait = remote.fencedAt(host) - Date.now();
        if (wait > 0) return wait;
        const places = this.#options.remote?.local
            ? ["local", ...remote.connected()]
            : remote.connected();
        // Nowhere to go: the launch fails and the supervisor keeps trying.
        if (places.length === 0) return 0;
        const load = new Map(places.map((place) => [place, 0]));
        for (const [cluster, place] of this.#hostOf) {
            const state = this.#infos.get(cluster)?.state;
            if (load.has(place) && state !== "failed" && state !== "stopped")
                load.set(place, load.get(place)! + 1);
        }
        const target = places.reduce((best, place) =>
            load.get(place)! < load.get(best)! ? place : best,
        );
        this.#hostOf.set(info.id, target);
        info.host = target;
        this.#emit("clusterMoved", info, { from: host, to: target });
        return 0;
    }

    /**
     * Moves a failed cluster's shards to the ready cluster that owns the
     * fewest. Ownership changes only after that worker confirmed it started
     * them, and the failed cluster's process is already dead, so no shard
     * ever has two owners.
     */
    async #reassign(failed: ClusterInfo): Promise<void> {
        const shardIds = [...failed.shards];
        const target = [...this.#infos.values()]
            .filter((cluster) => cluster.state === "ready")
            .sort((a, b) => a.shards.length - b.shards.length)[0];
        if (!target) {
            this.#emit(
                "error",
                new Error(
                    `No ready cluster can take over shards [${shardIds}] of cluster ${failed.id}.`,
                ),
            );
            this.#rejectReady(failed, "no ready cluster to take them");
            return;
        }
        try {
            await this.requestCluster(
                target.id,
                REQUEST_ASSIGN,
                { shardIds },
                { timeoutMs: this.#options.startTimeout ?? 120_000 },
            );
        } catch (error) {
            this.#emit(
                "error",
                new Error(
                    `Cluster ${target.id} could not take over shards [${shardIds}]: ${error instanceof Error ? error.message : String(error)}`,
                ),
            );
            this.#rejectReady(failed, "reassignment failed");
            return;
        }
        if (this.#stopping || failed.state !== "failed") return;
        for (const shard of shardIds) this.#owner.set(shard, target.id);
        target.shards.push(...shardIds);
        failed.shards = [];
        this.#emit("shardsReassigned", {
            shardIds,
            from: failed.id,
            to: target.id,
        });
        this.#checkReady();
    }

    #clearStartTimer(id: number): void {
        const timer = this.#startTimers.get(id);
        if (timer) clearTimeout(timer);
        this.#startTimers.delete(id);
    }

    #sendFrame(cluster: ClusterInfo, frame: unknown): boolean {
        const child = cluster.process;
        if (
            !isLive(cluster.state) ||
            typeof child.send !== "function" ||
            !child.connected
        )
            return false;
        try {
            child.send(frame as never);
            return true;
        } catch {
            // The child is exiting; its own exit handler takes over.
            return false;
        }
    }

    /** Tells the surviving clusters that these shards are gone, so requests to them fail now instead of timing out. */
    #announceDown(exited: number, shards: number[]): void {
        for (const [id, cluster] of this.clusters)
            if (id !== exited)
                this.#sendFrame(cluster, { [PEER_DOWN_FRAME]: shards });
    }

    /** Whether `child` is the process of the cluster as this deployment knows it now. */
    #current(info: ClusterInfo, child: ChildProcess): boolean {
        return info.process === child && this.#infos.get(info.id) === info;
    }

    #onFrame(info: ClusterInfo, child: ChildProcess, frame: unknown): void {
        if (!this.#current(info, child)) return;
        if (!frame || typeof frame !== "object") return;
        if (BUS_FRAME in frame) {
            this.#onBus(info, (frame as Record<string, unknown>)[BUS_FRAME]);
            return;
        }
        if (CLUSTER_FRAME in frame) {
            const body = parseChildFrame(
                (frame as Record<string, unknown>)[CLUSTER_FRAME],
            );
            if (body) this.#onControl(info, child, body);
            else
                this.#emit(
                    "error",
                    new Error(
                        `Cluster ${info.id} sent a malformed control frame.`,
                    ),
                );
        }
        // Anything else is the bot's own process.send() traffic.
    }

    #onControl(
        info: ClusterInfo,
        child: ChildProcess,
        frame: ChildFrame,
    ): void {
        switch (frame.kind) {
            case "ready": {
                if (!frame.shardIds.every((id) => info.shards.includes(id))) {
                    this.#emit(
                        "error",
                        new Error(
                            `Cluster ${info.id} reported shards it does not own: [${frame.shardIds}].`,
                        ),
                    );
                    return;
                }
                this.#clearStartTimer(info.id);
                info.state = "ready";
                info.readyAt = info.lastReadyAt = Date.now();
                this.#emit("clusterReady", info);
                this.#checkReady();
                return;
            }
            case "identify": {
                const reply = (body: Record<string, unknown>): void => {
                    if (this.#current(info, child))
                        this.#sendFrame(info, { [CLUSTER_FRAME]: body });
                };
                if (!this.#coordinator) {
                    reply({
                        kind: "identify-deny",
                        id: frame.id,
                        error: "IDENTIFY coordination is off.",
                    });
                    return;
                }
                if (!info.shards.includes(frame.shardId)) {
                    reply({
                        kind: "identify-deny",
                        id: frame.id,
                        error: `Shard ${frame.shardId} does not belong to cluster ${info.id}.`,
                    });
                    return;
                }
                // A shard asks for one slot at a time, so a worker cannot queue
                // more requests than it has shards.
                let waiting = this.#identifyWaiting.get(info.id);
                if (!waiting)
                    this.#identifyWaiting.set(info.id, (waiting = new Set()));
                if (waiting.has(frame.shardId)) {
                    reply({
                        kind: "identify-deny",
                        id: frame.id,
                        error: `Shard ${frame.shardId} is already waiting for a slot.`,
                    });
                    return;
                }
                waiting.add(frame.shardId);
                const settled = (): void => {
                    waiting.delete(frame.shardId);
                };
                this.#coordinator.acquire(info.id, frame.shardId).then(
                    () => {
                        settled();
                        reply({ kind: "identify-grant", id: frame.id });
                    },
                    (error: unknown) => {
                        settled();
                        reply({
                            kind: "identify-deny",
                            id: frame.id,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        });
                    },
                );
                return;
            }
            case "identify-done":
                this.#coordinator?.release(info.id, frame.shardId);
                return;
            case "reply": {
                // An oversized answer settles the request with an error now
                // instead of being held until its timeout.
                const tooBig =
                    frame.error === undefined && this.#tooBig(frame.result);
                this.#tracker.answer(frame.id, `c:${info.id}`, info.id, {
                    ...(frame.error !== undefined
                        ? { error: frame.error }
                        : tooBig
                          ? {
                                error: `Cluster ${info.id} answered with more than ${this.#maxBytes} bytes.`,
                            }
                          : { result: frame.result }),
                });
                return;
            }
            case "health":
                if (this.#tooBig(frame.report)) {
                    this.#emit(
                        "error",
                        new Error(
                            `Cluster ${info.id} sent a health report of more than ${this.#maxBytes} bytes.`,
                        ),
                    );
                    return;
                }
                info.report = frame.report;
                return;
        }
    }

    get #maxBytes(): number {
        return this.#options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    }

    #tooBig(value: unknown): boolean {
        return payloadSize(value) > this.#maxBytes;
    }

    /** @throws {RangeError} If a payload this process is about to send is over the limit. */
    #assertSize(data: unknown, what: string): void {
        if (this.#tooBig(data))
            throw new RangeError(
                `${what} is larger than maxMessageBytes (${this.#maxBytes}).`,
            );
    }

    /** Routes one shard-bus message: replies for the parent are consumed, shard-targeted messages go to the owning cluster only, broadcasts to every other cluster. */
    #onBus(from: ClusterInfo, raw: unknown): void {
        let message = raw as {
            source?: unknown;
            target?: unknown;
            type?: unknown;
            data?: unknown;
        } | null;
        if (
            !message ||
            typeof message !== "object" ||
            typeof message.type !== "string" ||
            message.type.length === 0 ||
            message.type.length > 256 ||
            (message as { id?: unknown }).id === undefined ||
            typeof (message as { id?: unknown }).id !== "string" ||
            (message as { id: string }).id.length > 256 ||
            !Number.isInteger(message.source) ||
            (message.target !== null && !Number.isInteger(message.target))
        )
            return;
        // A cluster speaks only for its own shards: a `source` it does not
        // own would let it answer requests meant for another cluster's shard.
        if (!from.shards.includes(message.source as number)) return;
        // Relay only the documented envelope, so undeclared fields cannot
        // ride along to every other cluster.
        const { type, id, source, target, data, expectsReply } =
            message as Record<string, unknown>;
        message = {
            type,
            id,
            source,
            target,
            data,
            ...(expectsReply === undefined ? {} : { expectsReply }),
        } as typeof message;
        if (this.#tooBig(message.data)) {
            this.#emit(
                "error",
                new Error(
                    `Cluster ${from.id} sent a shard-bus message of more than ${this.#maxBytes} bytes; it was not relayed.`,
                ),
            );
            return;
        }
        const frame = { [BUS_FRAME]: message };
        if (message.target === PARENT_ID) {
            const reply = message.data as ReplyPayload | undefined;
            if (
                message.type === REPLY_TYPE &&
                reply &&
                typeof reply.requestId === "string"
            )
                this.#tracker.answer(
                    reply.requestId,
                    `s:${message.source}`,
                    from.id,
                    reply.error !== undefined
                        ? { error: String(reply.error) }
                        : { result: reply.result },
                );
            return;
        }
        if (message.target === null) {
            for (const [id, cluster] of this.clusters)
                if (id !== from.id) this.#sendFrame(cluster, frame);
            return;
        }
        const owner = this.clusterForShard(message.target as number);
        if (!owner || owner.id === from.id) return;
        // Fail fast: a request to a shard whose cluster is down rejects now.
        if (!this.#sendFrame(owner, frame))
            this.#sendFrame(from, {
                [PEER_DOWN_FRAME]: [message.target as number],
            });
    }

    /**
     * Sends a request to one shard and resolves with its handler's result.
     * @throws {RangeError} If the shard is not part of this deployment.
     * @throws {Error} If its cluster is down, the handler failed, or no answer arrives in time.
     */
    public async request<R = unknown, T = unknown>(
        shardId: number,
        type: string,
        data: T,
        options: RequestOptions = {},
    ): Promise<R> {
        this.#assertSize(data, "The request data");
        const owner = this.clusterForShard(shardId);
        if (!owner)
            throw new RangeError(
                `Shard ${shardId} is not part of this deployment.`,
            );
        const { id, done } = this.#tracker.begin<R>({
            keys: new Map([[`s:${shardId}`, owner.id]]),
            timeoutMs:
                options.timeoutMs ?? this.#options.requestTimeout ?? 5000,
            signal: options.signal,
        });
        const sent = this.#sendFrame(owner, {
            [BUS_FRAME]: {
                source: PARENT_ID,
                target: shardId,
                type,
                data,
                id,
                expectsReply: true,
            },
        });
        if (!sent) {
            this.#tracker.failOwner(
                owner.id,
                `Shard ${shardId} is down: cluster ${owner.id} is ${owner.state}.`,
            );
        }
        const { replies } = await done;
        const reply = replies[0];
        if (!reply)
            throw new Error(
                `Shard ${shardId} did not reply to "${type}" in time.`,
            );
        if (reply.error !== undefined) throw new Error(reply.error);
        return reply.result as R;
    }

    /**
     * Asks every shard of every live cluster and collects the answers. Shards
     * whose cluster is down, or that do not answer in time, are listed in
     * `missing`; it does not reject for them.
     */
    public async broadcast<R = unknown, T = unknown>(
        type: string,
        data: T,
        options: RequestOptions = {},
    ): Promise<BroadcastResult<R>> {
        this.#assertSize(data, "The request data");
        const keys = new Map<string, number>();
        const down: number[] = [];
        for (const [shard, clusterId] of this.#owner) {
            const cluster = this.#infos.get(clusterId);
            if (cluster && isLive(cluster.state))
                keys.set(`s:${shard}`, clusterId);
            else down.push(shard);
        }
        const { id, done } = this.#tracker.begin<R>({
            keys,
            timeoutMs:
                options.timeoutMs ?? this.#options.requestTimeout ?? 5000,
            signal: options.signal,
        });
        const frame = {
            [BUS_FRAME]: {
                source: PARENT_ID,
                target: null,
                type,
                data,
                id,
                expectsReply: true,
            },
        };
        for (const cluster of this.clusters.values())
            if (!this.#sendFrame(cluster, frame))
                this.#tracker.failOwner(
                    cluster.id,
                    `Cluster ${cluster.id} is ${cluster.state}.`,
                );
        const { replies, missing } = await done;
        return {
            replies: replies.map((reply) => ({
                shardId: Number(reply.key.slice(2)),
                ...(reply.error !== undefined
                    ? { error: reply.error }
                    : { result: reply.result as R }),
            })),
            missing: [
                ...down,
                ...missing.map((key) => Number(key.slice(2))),
            ].sort((a, b) => a - b),
        };
    }

    /**
     * Sends a request to a cluster's worker (see `ClusterWorker.onRequest()`).
     * @throws {Error} If the cluster is unknown or down, the handler failed, or no answer arrives in time.
     */
    public async requestCluster<R = unknown, T = unknown>(
        clusterId: number,
        type: string,
        data: T,
        options: RequestOptions = {},
    ): Promise<R> {
        this.#assertSize(data, "The request data");
        const cluster = this.#infos.get(clusterId);
        if (!cluster)
            throw new RangeError(`Cluster ${clusterId} does not exist.`);
        const { id, done } = this.#tracker.begin<R>({
            keys: new Map([[`c:${clusterId}`, clusterId]]),
            timeoutMs:
                options.timeoutMs ?? this.#options.requestTimeout ?? 5000,
            signal: options.signal,
        });
        if (
            !this.#sendFrame(cluster, {
                [CLUSTER_FRAME]: { kind: "request", id, type, data },
            })
        )
            this.#tracker.failOwner(
                clusterId,
                `Cluster ${clusterId} is ${cluster.state}.`,
            );
        const { replies } = await done;
        const reply = replies[0];
        if (!reply)
            throw new Error(
                `Cluster ${clusterId} did not reply to "${type}" in time.`,
            );
        if (reply.error !== undefined) throw new Error(reply.error);
        return reply.result as R;
    }

    /** Resolves when every cluster is ready. @throws {Error} On timeout, or if the manager stops first. */
    public ready(timeoutMs?: number): Promise<void> {
        if (this.#isReady()) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            const waiter: {
                resolve: () => void;
                reject: (error: Error) => void;
                timer?: ReturnType<typeof setTimeout>;
            } = {
                resolve: () => {
                    if (waiter.timer) clearTimeout(waiter.timer);
                    this.#readyWaiters.delete(waiter);
                    resolve();
                },
                reject: (error) => {
                    if (waiter.timer) clearTimeout(waiter.timer);
                    this.#readyWaiters.delete(waiter);
                    reject(error);
                },
            };
            if (timeoutMs !== undefined)
                waiter.timer = setTimeout(
                    () =>
                        waiter.reject(
                            new Error(
                                `Clusters were not all ready within ${timeoutMs}ms.`,
                            ),
                        ),
                    timeoutMs,
                );
            this.#readyWaiters.add(waiter);
        });
    }

    /**
     * Every shard of the deployment is served by a ready cluster. A failed
     * cluster whose shards were reassigned no longer counts.
     */
    #isReady(): boolean {
        let ready = 0;
        for (const cluster of this.#infos.values()) {
            if (cluster.state === "ready") ready++;
            else if (!(
                cluster.state === "failed" && cluster.shards.length === 0
            ))
                return false;
        }
        return ready > 0;
    }

    /**
     * Rejects pending `ready()` calls: a failed cluster's shards have no owner
     * and nothing will give them one, so waiting longer would never end.
     */
    #rejectReady(failed: ClusterInfo, why: string): void {
        if (failed.shards.length === 0) return;
        const error = new Error(
            `Cluster ${failed.id} failed and shards [${failed.shards}] have no owner (${why}).`,
        );
        for (const waiter of [...this.#readyWaiters]) waiter.reject(error);
    }

    #checkReady(): void {
        if (!this.#isReady()) return;
        for (const waiter of [...this.#readyWaiters]) waiter.resolve();
        if (!this.#allReady) {
            this.#allReady = true;
            this.#emit("ready");
        }
    }

    /**
     * The last known health of every cluster and shard. Reads what the
     * workers last reported; nothing is sent. Use {@link refreshHealth} for fresh numbers.
     */
    public health(): ClusterManagerHealth {
        const now = Date.now();
        const clusters: ClusterHealth[] = [...this.#infos.values()]
            .sort((a, b) => a.id - b.id)
            .map((cluster) => ({
                id: cluster.id,
                state: cluster.state,
                ...(cluster.process.pid !== undefined && isLive(cluster.state)
                    ? { pid: cluster.process.pid }
                    : {}),
                host: cluster.host,
                shardIds: [...cluster.shards],
                uptimeMs: isLive(cluster.state) ? now - cluster.startedAt : 0,
                restarts: cluster.restarts,
                startedAt: cluster.startedAt,
                ...(cluster.readyAt !== undefined
                    ? { readyAt: cluster.readyAt }
                    : {}),
                ...(cluster.lastReadyAt !== undefined
                    ? { lastReadyAt: cluster.lastReadyAt }
                    : {}),
                shards: cluster.report?.shards ?? ([] as ShardHealth[]),
                ...(cluster.report?.metrics
                    ? { metrics: cluster.report.metrics as WorkerMetrics }
                    : {}),
                ...(cluster.report
                    ? { reportedAt: cluster.report.reportedAt }
                    : {}),
            }));
        const missingShards = [...this.#owner]
            .filter(([, id]) => this.#infos.get(id)?.state !== "ready")
            .map(([shard]) => shard)
            .sort((a, b) => a - b);
        const states = clusters.map((cluster) => cluster.state);
        const state: ClusterManagerHealth["state"] = this.#stopping
            ? "stopping"
            : clusters.length === 0
              ? this.#wasStarted
                  ? "stopped"
                  : "idle"
              : states.every((s) => s === "stopped")
                ? "stopped"
                : states.every((s) => s === "ready")
                  ? "ready"
                  : states.some((s) => s === "restarting" || s === "failed")
                    ? "degraded"
                    : "starting";
        return {
            state,
            totalShards: this.shardCount,
            clusters,
            readyClusters: states.filter((s) => s === "ready").length,
            missingShards,
        };
    }

    /**
     * Asks every live cluster for a fresh report, then returns {@link health}.
     * A cluster that does not answer in time keeps its last report; it is not
     * treated as failed (only its process exiting does that).
     */
    public async refreshHealth(
        options: { metrics?: boolean; timeoutMs?: number } = {},
    ): Promise<ClusterManagerHealth> {
        await Promise.all(
            [...this.clusters.values()].map(async (cluster) => {
                try {
                    cluster.report = await this.requestCluster<WorkerReport>(
                        cluster.id,
                        REQUEST_HEALTH,
                        { metrics: options.metrics === true },
                        { timeoutMs: options.timeoutMs ?? 2000 },
                    );
                } catch {
                    // Keep the previous report.
                }
            }),
        );
        return this.health();
    }

    /** Checks if the recommended shard count has changed and respawns if so. */
    public async checkAutoScale(): Promise<void> {
        if (!this.#auto) return; // Only auto-scale in auto mode
        try {
            const recommended = await this.fetchRecommendedShardCount();
            if (recommended !== this.shardCount) {
                await this.respawn(recommended);
            }
        } catch (error) {
            // Surface the failure instead of silently swallowing it; the next
            // interval tick retries.
            const normalized =
                error instanceof Error ? error : new Error(String(error));
            this.#options.onAutoScaleError?.(normalized);
        }
    }

    /** Gracefully shuts the existing clusters down and respawns them with the new shard count. @param newShardCount The new total shard count. */
    public async respawn(newShardCount: number): Promise<void> {
        this.#options.shardCount = newShardCount;
        // Hosts stay connected across a respawn, so they need not rejoin.
        await this.#stop(this.#options.shutdownTimeout ?? 5000, true);
        this.#supervisor.reset();
        await this.spawn();
    }

    /**
     * Gracefully stops all active clusters: sends SIGTERM, awaits each child's
     * clean exit, and force-kills (SIGKILL) only children that outlast the
     * shutdown timeout. Safe to call twice or concurrently; cancels restarts,
     * timers and pending requests.
     * @param timeoutMs Grace period per child before force-kill. Defaults to the configured `shutdownTimeout` (5000 ms).
     */
    public shutdownAll(
        timeoutMs = this.#options.shutdownTimeout ?? 5000,
    ): Promise<void> {
        return this.#stop(timeoutMs, false);
    }

    #stop(timeoutMs: number, keepRemote: boolean): Promise<void> {
        this.#stopPromise ??= this.#shutdown(timeoutMs, keepRemote).finally(
            () => {
                this.#stopPromise = undefined;
            },
        );
        return this.#stopPromise;
    }

    async #shutdown(timeoutMs: number, keepRemote: boolean): Promise<void> {
        this.#stopping = true;
        this.#halt();
        // A spawn that is still forking sees `#stopping` and stops on its own.
        await this.#startPromise?.catch(() => undefined);
        const started = Date.now();
        const live = [...this.clusters.values()];
        await Promise.all(
            live.map((cluster) => this.#shutdownCluster(cluster, timeoutMs)),
        );
        this.#emit("shutdown", {
            clusters: live.length,
            durationMs: Date.now() - started,
        });
        for (const cluster of this.#infos.values()) cluster.state = "stopped";
        this.clusters.clear();
        this.#startPromise = undefined;
        if (!keepRemote) {
            this.#remote?.stop();
            await this.#resign();
        }
        this.#stopping = false;
    }

    /** Cancels everything that could start work or keep the loop alive. */
    #halt(): void {
        this.#generation++;
        for (const timer of this.#restartTimers) clearTimeout(timer);
        this.#restartTimers.clear();
        this.#fencing.clear();
        for (const id of [...this.#startTimers.keys()])
            this.#clearStartTimer(id);
        for (const wake of [...this.#pauses]) wake();
        if (this.#autoScaleTimer) {
            clearInterval(this.#autoScaleTimer);
            this.#autoScaleTimer = undefined;
        }
        this.#coordinator?.close();
        this.#coordinator = undefined;
        this.#remote?.abortWaits();
        this.#tracker.close();
        for (const waiter of [...this.#readyWaiters])
            waiter.reject(new Error("The cluster manager is stopping."));
    }

    /** Gracefully terminates a single cluster child, escalating to SIGKILL after the timeout. */
    async #shutdownCluster(
        cluster: ClusterInfo,
        timeoutMs: number,
    ): Promise<void> {
        const child = cluster.process;
        cluster.state = "stopping";
        if (child.exitCode !== null || child.signalCode !== null) return;
        await new Promise<void>((resolve) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const finish = (): void => {
                if (timer) clearTimeout(timer);
                resolve();
            };
            child.once("exit", finish);
            try {
                child.kill("SIGTERM");
            } catch {
                child.off("exit", finish);
                finish();
                return;
            }
            timer = setTimeout(() => {
                try {
                    child.kill("SIGKILL");
                } catch {
                    // Ignore force-kill errors.
                }
                // A process whose exit is never reported (a remote host that
                // lost the kill frame) must not hang the shutdown.
                timer = setTimeout(finish, Math.max(timeoutMs, 1000));
            }, timeoutMs);
        });
    }

    /** Immediately sends SIGTERM to every cluster process (no grace period, no SIGKILL escalation) and clears the cluster map. Prefer {@link shutdownAll} for a graceful stop. */
    public killAll(): void {
        this.#stopping = true;
        this.#halt();
        for (const cluster of this.#infos.values()) {
            cluster.state = "stopped";
            try {
                cluster.process.kill();
            } catch {
                // Ignore kill errors
            }
        }
        this.clusters.clear();
        this.#startPromise = undefined;
        this.#remote?.stop();
        void this.#resign();
        this.#stopping = false;
    }
}

/** Rejects when `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () =>
                reject(
                    new Error(
                        `The leader lock did not answer within ${ms} ms.`,
                    ),
                ),
            ms,
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
