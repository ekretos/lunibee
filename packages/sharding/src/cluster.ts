import { fork, type ChildProcess } from "node:child_process";
import { cpus } from "node:os";

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

/** Manages multiple clusters of shards, distributing shards across child processes. */
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

    /** Creates a cluster manager. @param options Clustering configuration. @throws {TypeError} If token or script is missing. */
    public constructor(options: ClusterManagerOptions) {
        if (!options.token?.trim()) throw new TypeError("A Discord bot token is required.");
        if (!options.script?.trim()) throw new TypeError("A script path is required for clustering.");

        this.#auto = options.shardCount === "auto";
        this.#options = { ...options };
    }

    /** Retrieves Discord's recommended shard count. @returns Recommended shard count. @throws {Error} If discovery fails or returns invalid data. */
    public async fetchRecommendedShardCount(): Promise<number> {
        const response = await fetch("https://discord.com/api/v10/gateway/bot", {
            headers: {
                Authorization: `Bot ${this.#options.token}`,
                "User-Agent": "Lunibee/0.1.0",
            },
        });
        if (!response.ok) {
            throw new Error(`Gateway discovery failed with status ${response.status}`);
        }
        const data = (await response.json()) as { shards?: unknown };
        if (typeof data.shards !== "number" || !Number.isInteger(data.shards) || data.shards < 1) {
            throw new Error("Gateway discovery returned an invalid shard count.");
        }
        return data.shards;
    }

    /** Spawns all clusters. @returns A promise fulfilled after clusters have launched. */
    public async spawn(): Promise<void> {
        if (this.#spawned) return;
        this.#spawned = true;

        const count =
            this.#options.shardCount === "auto" || this.#options.shardCount === undefined
                ? await this.fetchRecommendedShardCount()
                : this.#options.shardCount;

        this.shardCount = count;
        const clusterCount = this.#options.clusterCount ?? cpus().length;

        // Chunk shards across clusters evenly
        const chunks = Array.from({ length: clusterCount }, () => [] as number[]);
        for (let i = 0; i < count; i++) {
            chunks[i % clusterCount].push(i);
        }

        for (let i = 0; i < clusterCount; i++) {
            if (chunks[i].length === 0) continue;

            const child = fork(this.#options.script, [], {
                env: {
                    ...process.env,
                    SHARD_LIST: chunks[i].join(","),
                    SHARD_COUNT: count.toString(),
                    CLUSTER_ID: i.toString(),
                },
            });

            this.clusters.set(i, {
                id: i,
                process: child,
                shards: chunks[i],
            });

            // Stagger cluster creation
            await sleep(500);
        }

        if (this.#options.autoScaleInterval && this.#options.autoScaleInterval > 0) {
            this.#autoScaleTimer = setInterval(() => {
                void this.checkAutoScale();
            }, this.#options.autoScaleInterval);
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
        } catch {
            // Suppress errors during auto-scale check
        }
    }

    /** Kills all existing clusters and respawns them with the new shard count. @param newShardCount The new total shard count. */
    public async respawn(newShardCount: number): Promise<void> {
        this.#options.shardCount = newShardCount;
        this.killAll();
        this.#spawned = false;
        await this.spawn();
    }

    /** Kills all active cluster processes and clears the cluster map. */
    public killAll(): void {
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
    }
}
