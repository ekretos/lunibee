import type { Gateway } from "@lunibee/ws";

/** Where a shard is in its life, apart from the state of its Gateway socket. */
export type ShardStatus =
    /** Created, never connected. */
    | "idle"
    /** Connecting or waiting for its IDENTIFY slot. */
    | "connecting"
    /** Handshake finished; events are flowing. */
    | "ready"
    /** The socket closed; the Gateway may be reconnecting by itself. */
    | "disconnected"
    /** The Gateway reported repeated reconnects and is backing off. */
    | "unstable"
    /** Closed with `destroy()`. */
    | "destroyed";

/** Health snapshot for one shard. */
export interface ShardHealth {
    id: number;
    /** Gateway connection state. */
    state: Gateway["state"];
    /** Last heartbeat round-trip in ms, or -1 before the first ACK. */
    ping: number;
    /** Shard lifecycle, separate from the Gateway `state`. */
    status: ShardStatus;
    /** When the shard last became ready (epoch ms), if it ever did. */
    readyAt?: number;
    /** When the socket last closed (epoch ms), if it ever did. */
    disconnectedAt?: number;
}

/** Process numbers a worker adds to a health report. Opt-in: they cost a syscall each. */
export interface WorkerMetrics {
    /** Resident set size in bytes. */
    rssBytes: number;
    /** V8 heap in use in bytes. */
    heapUsedBytes: number;
    /** CPU time used by this process, in microseconds. */
    cpuUserMicros: number;
    cpuSystemMicros: number;
}

/** What a cluster worker reports about itself. */
export interface WorkerReport {
    shards: ShardHealth[];
    metrics?: WorkerMetrics;
    /** When the worker built the report (epoch ms). */
    reportedAt: number;
}

/** Lifecycle of a cluster process. */
export type ClusterState =
    /** Forked; has not said it is ready. */
    | "starting"
    /** Every shard in the cluster finished its handshake. */
    | "ready"
    /** Exited unexpectedly; a restart is scheduled. */
    | "restarting"
    /** A deliberate shutdown is in progress. */
    | "stopping"
    /** Stopped on purpose. */
    | "stopped"
    /** Crashed too often and will not be restarted. */
    | "failed";

/** Health of one cluster. */
export interface ClusterHealth {
    id: number;
    state: ClusterState;
    pid?: number;
    /** Where it runs: `"local"` or the ID of a host. */
    host: string;
    /** Shards this cluster owns right now. */
    shardIds: number[];
    /** Milliseconds since this process was forked; 0 when it is not running. */
    uptimeMs: number;
    /** How many times it has been restarted after a crash. */
    restarts: number;
    startedAt?: number;
    /** When the current process reported ready. */
    readyAt?: number;
    /** When any process of this cluster last reported ready. */
    lastReadyAt?: number;
    /** Per-shard health from the worker's last report. Empty until it reports. */
    shards: ShardHealth[];
    /** Present when requested with `refreshHealth({ metrics: true })` and the worker answered. */
    metrics?: WorkerMetrics;
    /** When `shards` and `metrics` were reported (epoch ms). */
    reportedAt?: number;
}

/** Health of the whole deployment. */
export interface ClusterManagerHealth {
    state: "idle" | "starting" | "ready" | "degraded" | "stopping" | "stopped";
    totalShards: number;
    clusters: ClusterHealth[];
    readyClusters: number;
    /** Shards with no ready owner right now. */
    missingShards: number[];
}
