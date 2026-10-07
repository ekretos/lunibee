import { fetchGatewayBot } from "./gateway-bot.js";
import { fork, type ChildProcess } from "node:child_process";
import { cpus } from "node:os";
import { ShardSupervisor, type SupervisorOptions } from "./supervisor.js";
import { BUS_FRAME, PEER_DOWN_FRAME } from "./transport.js";

/** Runtime-agnostic delay used to stagger cluster spawns (works under Node and Bun). @param ms Milliseconds to wait. */
const sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Configuration for managing multiple shard clusters. */
export interface ClusterManagerOptions {
    /** Discord bot token. */
    token: string;
    /** Path to the worker script to execute for each cluster. */
    script: string;
    /** Number of shards. Use "auto" to request Discord's recommended count. */
    shardCount?: number | "auto";
    /** Number of clusters to spawn. Defaults to the number of logical CPUs. */
    clusterCount?: number;
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

/** Information about a running cluster. */
export interface ClusterInfo {
    /** Cluster identifier. */
    id: number;
    /** The child process running the cluster. */
    process: ChildProcess;
    /** The shard IDs managed by this cluster. */
    shards: number[];
}

/**
 * Manages multiple clusters of shards, distributing shards across child processes.
 *
 * **Runtime requirement:** clustering relies on Node.js `child_process.fork()`
 * and IPC. `fork()` is not fully supported under Bun, so run the cluster
 * manager under the Node.js runtime; `spawn()` will fail on a runtime whose
 * `fork()` is unavailable.
 */
export class ClusterManager {
    /** Active clusters indexed by cluster ID. */
    public readonly clusters = new Map<number, ClusterInfo>();
    /** Total number of shards across all clusters. */
    public shardCount = 0;

    readonly #options: ClusterManagerOptions;
    /** Whether the manager was created in auto shard-count mode. Preserved across respawns so auto-scaling keeps running. */
    readonly #auto: boolean;
    #autoScaleTimer?: ReturnType<typeof setInterval>;
    #spawned = false;
    /** Set while a deliberate shutdown is in progress so exits are not restarted. */
    #stopping = false;
    /** Pending restart timers, kept so shutdown can cancel them. */
    readonly #restartTimers = new Set<ReturnType<typeof setTimeout>>();
    readonly #supervisor: ShardSupervisor;

    /** Creates a cluster manager. @param options Clustering configuration. @throws {TypeError} If token or script is missing. */
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

        this.#auto = options.shardCount === "auto";
        this.#options = { ...options };
        this.#supervisor = new ShardSupervisor({
            restartDelay: options.restartDelay,
            ...options.supervisor,
        });
    }

    /** Retrieves Discord's recommended shard count. @returns Recommended shard count. @throws {Error} If discovery fails or returns invalid data. */
    public async fetchRecommendedShardCount(): Promise<number> {
        return (await fetchGatewayBot(this.#options.token)).shards;
    }

    /** Spawns all clusters. @returns A promise fulfilled after clusters have launched. */
    public async spawn(): Promise<void> {
        if (this.#spawned) return;
        if (typeof process?.versions?.bun === "string") {
            throw new Error(
                "ClusterManager requires the Node.js runtime; Bun does not support child_process.fork() for this clustering mode.",
            );
        }
        this.#spawned = true;

        const count =
            this.#options.shardCount === "auto" ||
            this.#options.shardCount === undefined
                ? await this.fetchRecommendedShardCount()
                : this.#options.shardCount;

        this.shardCount = count;
        const clusterCount = this.#options.clusterCount ?? cpus().length;

        // Chunk shards across clusters evenly
        const chunks = Array.from(
            { length: clusterCount },
            () => [] as number[],
        );
        for (let i = 0; i < count; i++) {
            chunks[i % clusterCount]?.push(i);
        }

        for (const [i, chunk] of chunks.entries()) {
            if (chunk.length === 0) continue;
            this.#launch(i, chunk, count);
            // Stagger cluster creation
            await sleep(500);
        }

        if (
            this.#options.autoScaleInterval &&
            this.#options.autoScaleInterval > 0
        ) {
            this.#autoScaleTimer = setInterval(() => {
                void this.checkAutoScale();
            }, this.#options.autoScaleInterval);
        }
    }

    /**
     * Forks one cluster child and supervises its exit.
     *
     * A child that dies (crash, OOM kill, uncaught rejection) takes its shards
     * offline for good, so unless the exit came from a deliberate shutdown the
     * same shard assignment is re-forked after `restartDelay`.
     */
    #launch(id: number, shards: number[], shardCount: number): ClusterInfo {
        const child = fork(this.#options.script, [], {
            env: {
                ...process.env,
                SHARD_LIST: shards.join(","),
                SHARD_COUNT: shardCount.toString(),
                CLUSTER_ID: id.toString(),
                LUNIBEE_SHARD_BUS: "ipc",
            },
        });
        const info: ClusterInfo = { id, process: child, shards };
        this.clusters.set(id, info);
        child.on("message", (frame) => this.#relay(id, frame));
        child.once("exit", (code, signal) => {
            // Only act on the process still registered as this cluster: a
            // restart or respawn may already have replaced it.
            if (this.clusters.get(id)?.process !== child) return;
            try {
                this.#options.onClusterExit?.(info, code, signal);
            } catch {
                // A faulty consumer callback must not break supervision.
            }
            if (!this.#stopping) this.#announceDown(id, shards);
            if (this.#stopping || this.#options.restartOnExit === false) return;
            this.clusters.delete(id);
            const delay = this.#supervisor.next(id);
            if (delay === null) {
                try {
                    this.#options.onGiveUp?.(info);
                } catch {
                    // A faulty consumer callback must not break supervision.
                }
                return;
            }
            const timer = setTimeout(() => {
                this.#restartTimers.delete(timer);
                if (this.#stopping || !this.#spawned) return;
                this.#launch(id, shards, shardCount);
            }, delay);
            // Do not hold the event loop open purely for a pending restart.
            (timer as { unref?: () => void }).unref?.();
            this.#restartTimers.add(timer);
        });
        return info;
    }

    /** Passes a shard-bus frame from one cluster to every other cluster. */
    #relay(from: number, frame: unknown): void {
        if (!frame || typeof frame !== "object" || !(BUS_FRAME in frame))
            return;
        for (const [id, cluster] of this.clusters)
            if (id !== from) this.#sendFrame(cluster, frame);
    }

    /** Tells the surviving clusters that these shards are gone, so requests to them fail now instead of timing out. */
    #announceDown(exited: number, shards: number[]): void {
        for (const [id, cluster] of this.clusters)
            if (id !== exited)
                this.#sendFrame(cluster, { [PEER_DOWN_FRAME]: shards });
    }

    #sendFrame(cluster: ClusterInfo, frame: unknown): void {
        const child = cluster.process;
        if (typeof child.send !== "function" || !child.connected) return;
        try {
            child.send(frame as never);
        } catch {
            // The child is exiting; its own exit handler takes over.
        }
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
        await this.shutdownAll();
        this.#spawned = false;
        this.#supervisor.reset();
        await this.spawn();
    }

    /**
     * Gracefully stops all active clusters: sends SIGTERM, awaits each child's
     * clean exit, and force-kills (SIGKILL) only children that outlast the
     * shutdown timeout. Clears the auto-scale timer and cluster map.
     * @param timeoutMs Grace period per child before force-kill. Defaults to the configured `shutdownTimeout` (5000 ms).
     */
    public async shutdownAll(
        timeoutMs = this.#options.shutdownTimeout ?? 5000,
    ): Promise<void> {
        this.#stopping = true;
        this.#clearRestartTimers();
        if (this.#autoScaleTimer) {
            clearInterval(this.#autoScaleTimer);
            this.#autoScaleTimer = undefined;
        }
        await Promise.all(
            [...this.clusters.values()].map((cluster) =>
                this.#shutdownCluster(cluster, timeoutMs),
            ),
        );
        this.clusters.clear();
        this.#spawned = false;
        this.#stopping = false;
    }

    /** Cancels any pending crash-restart timers. */
    #clearRestartTimers(): void {
        for (const timer of this.#restartTimers) clearTimeout(timer);
        this.#restartTimers.clear();
    }

    /** Gracefully terminates a single cluster child, escalating to SIGKILL after the timeout. */
    async #shutdownCluster(
        cluster: ClusterInfo,
        timeoutMs: number,
    ): Promise<void> {
        const child = cluster.process;
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

    /** Immediately force-kills all active cluster processes and clears the cluster map. Prefer {@link shutdownAll} for a graceful stop. */
    public killAll(): void {
        this.#stopping = true;
        this.#clearRestartTimers();
        if (this.#autoScaleTimer) {
            clearInterval(this.#autoScaleTimer);
            this.#autoScaleTimer = undefined;
        }
        for (const cluster of this.clusters.values()) {
            try {
                cluster.process.kill();
            } catch {
                // Ignore kill errors
            }
        }
        this.clusters.clear();
        this.#spawned = false;
        this.#stopping = false;
    }
}
