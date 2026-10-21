/**
 * What a cluster worker knows about itself. `ClusterManager` sets it through
 * environment variables; {@link readClusterContext} reads it back.
 */
export interface ClusterContext {
    /** This cluster's ID. */
    clusterId: number;
    /** How many clusters the deployment started. */
    clusterCount: number;
    /** Total shards in the deployment (what Discord calls `num_shards`). */
    shardCount: number;
    /** Shards this cluster owns. */
    shardIds: number[];
    /** Whether the parent hands out IDENTIFY slots for this cluster. */
    coordinatedIdentify: boolean;
    /**
     * `"sequential"`: hold each IDENTIFY slot until the shard is READY, so the
     * deployment starts one shard at a time. `"safe"` (default): release it once
     * the IDENTIFY is sent.
     */
    startup?: "safe" | "sequential";
}

/** Set to `1` in every process `ClusterManager` forks, so a worker can tell it is one. */
export const WORKER_MARKER = "LUNIBEE_CLUSTER_WORKER";

/** Whether this process was forked by a `ClusterManager`. */
export function isClusterWorker(
    env: Record<string, string | undefined> = process.env,
): boolean {
    return env[WORKER_MARKER] === "1";
}

/** Checks that shard IDs are unique integers in `[0, total)`. @throws {RangeError} Otherwise. */
export function validateShardIds(
    shardIds: readonly number[],
    total: number,
): void {
    if (!Number.isInteger(total) || total < 1)
        throw new RangeError("Shard count must be a positive integer.");
    const seen = new Set<number>();
    for (const id of shardIds) {
        if (!Number.isInteger(id) || id < 0 || id >= total)
            throw new RangeError(
                `Shard ID ${String(id)} is outside 0-${total - 1}.`,
            );
        if (seen.has(id))
            throw new RangeError(`Shard ID ${id} is listed twice.`);
        seen.add(id);
    }
}

/**
 * Splits shard IDs across clusters in contiguous blocks, in order. When they do
 * not divide evenly the first clusters get one more: 10 shards over 3 clusters
 * are `[0-3] [4-6] [7-9]`. The same input always gives the same output.
 * @returns One list per cluster (empty ones at the end when there are more clusters than shards).
 * @throws {RangeError} If `clusterCount` is not a positive integer.
 */
export function allocateShards(
    shardIds: readonly number[],
    clusterCount: number,
): number[][] {
    if (!Number.isInteger(clusterCount) || clusterCount < 1)
        throw new RangeError("clusterCount must be a positive integer.");
    const base = Math.floor(shardIds.length / clusterCount);
    const extra = shardIds.length % clusterCount;
    const chunks: number[][] = [];
    let offset = 0;
    for (let cluster = 0; cluster < clusterCount; cluster++) {
        const size = base + (cluster < extra ? 1 : 0);
        chunks.push(shardIds.slice(offset, offset + size));
        offset += size;
    }
    return chunks;
}

/** How {@link planClusters} chose the cluster count. */
export type ClusterCountSource =
    "clusterCount" | "shardsPerCluster" | "default";

/** Options for {@link planClusters}; set `clusterCount` or `shardsPerCluster`, not both. */
export interface ClusterPlanOptions {
    /** The deployment's shards, in order. */
    shardIds: readonly number[];
    /** Split the shards over this many clusters (Mode A). */
    clusterCount?: number;
    /** Fill clusters with this many shards each; the last may have fewer (Mode B). */
    shardsPerCluster?: number;
    /** Cluster count when neither is set (Mode C), e.g. the number of CPUs. */
    defaultClusterCount: number;
}

/** The result of {@link planClusters}. */
export interface ClusterPlan {
    /** Shards of each cluster, by cluster ID. Never empty: there are at most as many clusters as shards. */
    clusters: number[][];
    /** Where the cluster count came from. */
    source: ClusterCountSource;
    /** The count asked for, before capping at the number of shards. */
    requested: number;
}

function positiveInteger(name: string, value: number): void {
    if (!Number.isInteger(value) || value < 1)
        throw new RangeError(
            `${name} must be a positive integer, got ${String(value)}.`,
        );
}

/**
 * Decides which cluster runs which shard, without starting anything:
 * - `clusterCount`: every shard, split in contiguous blocks over that many clusters;
 * - `shardsPerCluster`: `ceil(shards / shardsPerCluster)` clusters of that size, the last one partial;
 * - neither: `defaultClusterCount` clusters.
 *
 * There are never more clusters than shards: a larger count is capped (an
 * empty cluster would hold a process for nothing). Every shard is in exactly one cluster.
 * @throws {RangeError} For both options at once, or a count that is not a positive integer.
 */
export function planClusters(options: ClusterPlanOptions): ClusterPlan {
    const { shardIds, clusterCount, shardsPerCluster } = options;
    if (clusterCount !== undefined && shardsPerCluster !== undefined)
        throw new RangeError(
            "Set either clusterCount or shardsPerCluster, not both: the cluster count follows from shardsPerCluster.",
        );
    if (shardIds.length === 0)
        throw new RangeError("There are no shards to allocate.");
    let requested: number;
    let source: ClusterCountSource;
    let clusters: number[][];
    if (shardsPerCluster !== undefined) {
        positiveInteger("shardsPerCluster", shardsPerCluster);
        source = "shardsPerCluster";
        requested = Math.ceil(shardIds.length / shardsPerCluster);
        clusters = [];
        for (let i = 0; i < shardIds.length; i += shardsPerCluster)
            clusters.push(shardIds.slice(i, i + shardsPerCluster));
    } else {
        requested = clusterCount ?? options.defaultClusterCount;
        positiveInteger(
            clusterCount === undefined ? "defaultClusterCount" : "clusterCount",
            requested,
        );
        source = clusterCount === undefined ? "default" : "clusterCount";
        clusters = allocateShards(
            shardIds,
            Math.min(requested, shardIds.length),
        );
    }
    assertCompleteAllocation(clusters, shardIds);
    return { clusters, source, requested };
}

/**
 * Proves an allocation covers `expected` exactly once.
 * @throws {Error} Naming the missing, duplicate or unexpected shard IDs.
 */
export function assertCompleteAllocation(
    chunks: readonly (readonly number[])[],
    expected: readonly number[],
): void {
    const owners = new Map<number, number>();
    const duplicate: number[] = [];
    chunks.forEach((chunk, cluster) => {
        for (const id of chunk) {
            if (owners.has(id)) duplicate.push(id);
            owners.set(id, cluster);
        }
    });
    const want = new Set(expected);
    const missing = expected.filter((id) => !owners.has(id));
    const extra = [...owners.keys()].filter((id) => !want.has(id));
    if (duplicate.length || missing.length || extra.length)
        throw new Error(
            `Shard allocation is not exact: duplicate [${duplicate}], missing [${missing}], unexpected [${extra}].`,
        );
}

function parseInteger(name: string, value: string | undefined): number {
    if (value === undefined || !/^\d+$/.test(value))
        throw new RangeError(`${name} must be a non-negative integer.`);
    return Number(value);
}

/**
 * Reads the worker contract from the environment: `CLUSTER_ID`, `CLUSTER_COUNT`,
 * `SHARD_COUNT`, `SHARD_LIST` (comma separated) and `LUNIBEE_IDENTIFY`.
 * @returns The context, or `null` when this process is not a cluster worker.
 * @throws {RangeError} If the variables are present but malformed.
 */
export function readClusterContext(
    env: Record<string, string | undefined> = process.env,
): ClusterContext | null {
    if (!isClusterWorker(env)) return null;
    const shardCount = parseInteger("SHARD_COUNT", env.SHARD_COUNT);
    const shardIds = (env.SHARD_LIST ?? "")
        .split(",")
        .filter((part) => part !== "")
        .map((part) => parseInteger("SHARD_LIST", part));
    validateShardIds(shardIds, shardCount);
    if (shardIds.length === 0)
        throw new RangeError("SHARD_LIST names no shards for this cluster.");
    const clusterId = parseInteger("CLUSTER_ID", env.CLUSTER_ID);
    const clusterCount = parseInteger("CLUSTER_COUNT", env.CLUSTER_COUNT);
    if (clusterCount < 1 || clusterId >= clusterCount)
        throw new RangeError(
            `CLUSTER_ID ${clusterId} is outside the ${clusterCount} cluster(s).`,
        );
    return {
        clusterId,
        clusterCount,
        shardCount,
        shardIds,
        coordinatedIdentify: env.LUNIBEE_IDENTIFY === "coordinated",
        startup: env.LUNIBEE_STARTUP === "sequential" ? "sequential" : "safe",
    };
}
