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
    allocateShards,
    assertCompleteAllocation,
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
import { IdentifyCoordinator, type IdentifyBudget } from "./identify.js";
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

/** Configuration for managing multiple shard clusters. */
export interface ClusterManagerOptions {
    /** Discord bot token. */
    token: string;
    /** Path to the worker script to execute for each cluster. */
    script: string;
    /** Total number of shards. Use "auto" to request Discord's recommended count. */
    shardCount?: number | "auto";
    /**
     * With `shardCount: "auto"`, size the deployment by guilds instead of
     * Discord's recommendation: `ceil(guilds / guildsPerShard)` shards, at
     * least one. 1 to 2500 (Discord's limit); Discord recommends about 1000.
     * Guilds are assigned to shards by their ID, so this sets the average,
     * not an exact split.
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
    /** An IDENTIFY is waiting for the session-start budget to reset. */
    identifyWait: [info: { shardId: number; waitMs: number }];
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
    /** Pending restart timers, kept so shutdown can cancel them. */
    readonly #restartTimers = new Set<ReturnType<typeof setTimeout>>();
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
                join: (id) => this.#emit("hostJoin", id),
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
        } else if (fetchLimits)
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
        const { count, maxConcurrency, budget } = await this.#resolveGateway();
        if (this.#stopping) return;

        const ids =
            this.#options.shardIds ??
            Array.from({ length: count }, (_, i) => i);
        validateShardIds(ids, count);
        const clusterCount =
            this.#options.clusterCount ??
            (this.#options.shardsPerCluster
                ? Math.ceil(ids.length / this.#options.shardsPerCluster)
                : cpus().length);
        const chunks = allocateShards(ids, clusterCount);
        assertCompleteAllocation(chunks, ids);

        const placement = await this.#placeHosts().catch((error: unknown) => {
            // A shutdown that interrupts the wait is not a failure of the start.
            if (this.#stopping) return undefined;
            throw error;
        });
        if (!placement || this.#stopping) return;

        this.shardCount = count;
        this.#wasStarted = true;
        this.#owner.clear();
        this.#infos.clear();
        const identify = this.#options.identify;
        this.#coordinator =
            identify?.coordinate === false
                ? undefined
                : new IdentifyCoordinator({
                      maxConcurrency,
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

        const active = chunks
            .map((shards, id) => ({ id, shards }))
            .filter((chunk) => chunk.shards.length > 0);
        this.#clusterCount = active.length;
        this.#hostOf.clear();
        for (const chunk of active)
            this.#hostOf.set(chunk.id, placement[chunk.id % placement.length]!);
        for (const [index, chunk] of active.entries()) {
            if (this.#stopping) return;
            for (const shard of chunk.shards) this.#owner.set(shard, chunk.id);
            this.#launch(chunk.id, chunk.shards);
            // Spread the CPU cost of starting processes. IDENTIFY pacing is
            // the coordinator's job and does not depend on this.
            const gap = this.#options.spawnInterval ?? 500;
            if (index < active.length - 1 && gap > 0) await this.#pause(gap);
        }
        if (this.#stopping) return;

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
        // restart or respawn may already have replaced it.
        if (info.process !== child) return;
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
        if (this.#options.restartOnExit === false) {
            info.state = "failed";
            this.#checkReady();
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
            this.#checkReady();
            if (this.#options.reassignOnGiveUp) void this.#reassign(info);
            return;
        }
        info.state = "restarting";
        info.restarts++;
        this.#emit("clusterRestart", info, { delay, attempt: info.restarts });
        if (info.restarts >= 3)
            this.#emit("clusterUnstable", info, {
                attempt: info.restarts,
                delay,
            });
        const timer = setTimeout(() => {
            this.#restartTimers.delete(timer);
            if (this.#stopping || info.state !== "restarting") return;
            this.#launch(info.id, info.shards);
        }, delay);
        // Do not hold the event loop open purely for a pending restart.
        (timer as { unref?: () => void }).unref?.();
        this.#restartTimers.add(timer);
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

    #onFrame(info: ClusterInfo, child: ChildProcess, frame: unknown): void {
        if (info.process !== child) return;
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
                    if (info.process === child)
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

    #isReady(): boolean {
        if (this.#infos.size === 0) return false;
        for (const cluster of this.#infos.values())
            if (cluster.state !== "ready") return false;
        return true;
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
        await Promise.all(
            [...this.clusters.values()].map((cluster) =>
                this.#shutdownCluster(cluster, timeoutMs),
            ),
        );
        for (const cluster of this.#infos.values()) cluster.state = "stopped";
        this.clusters.clear();
        this.#startPromise = undefined;
        if (!keepRemote) this.#remote?.stop();
        this.#stopping = false;
    }

    /** Cancels everything that could start work or keep the loop alive. */
    #halt(): void {
        for (const timer of this.#restartTimers) clearTimeout(timer);
        this.#restartTimers.clear();
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
        this.#stopping = false;
    }
}
