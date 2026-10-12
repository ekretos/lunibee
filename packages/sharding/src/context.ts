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
 * Splits shard IDs across clusters round-robin: the i-th ID goes to cluster
 * `i % clusterCount`. The same input always gives the same output.
 * @returns One list per cluster (some may be empty when there are more clusters than shards).
 * @throws {RangeError} If `clusterCount` is not a positive integer.
 */
export function allocateShards(
    shardIds: readonly number[],
    clusterCount: number,
): number[][] {
    if (!Number.isInteger(clusterCount) || clusterCount < 1)
        throw new RangeError("clusterCount must be a positive integer.");
    const chunks = Array.from({ length: clusterCount }, () => [] as number[]);
    shardIds.forEach((id, index) => chunks[index % clusterCount]!.push(id));
    return chunks;
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
    return {
        clusterId: parseInteger("CLUSTER_ID", env.CLUSTER_ID),
        clusterCount: parseInteger("CLUSTER_COUNT", env.CLUSTER_COUNT),
        shardCount,
        shardIds,
        coordinatedIdentify: env.LUNIBEE_IDENTIFY === "coordinated",
    };
}
