import type { WorkerReport } from "./health.js";

/** Marks a cluster control frame on the IPC channel, next to the shard-bus frames. */
export const CLUSTER_FRAME = "__lunibeeCluster";
/** The `source` and reply `target` of the parent process on the shard bus. */
export const PARENT_ID = -1;
/** Built-in cluster request: the worker answers with a {@link WorkerReport}. */
export const REQUEST_HEALTH = "__lunibee:health";
/** Built-in cluster request: the worker starts the given shards (recovery). */
export const REQUEST_ASSIGN = "__lunibee:assign";

/** Frames a worker sends to the parent. */
export type ChildFrame =
    | { kind: "ready"; shardIds: number[] }
    | { kind: "identify"; id: number; shardId: number }
    | { kind: "identify-done"; shardId: number }
    | { kind: "reply"; id: string; result?: unknown; error?: string }
    | { kind: "health"; report: WorkerReport };

/** Frames the parent sends to a worker. */
export type ParentFrame =
    | { kind: "identify-grant"; id: number }
    | { kind: "identify-deny"; id: number; error: string }
    | { kind: "request"; id: string; type: string; data: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;
const isShardId = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Validates the body of a control frame from a worker; `null` when it is malformed. */
export function parseChildFrame(value: unknown): ChildFrame | null {
    if (!isRecord(value)) return null;
    switch (value.kind) {
        case "ready":
            return Array.isArray(value.shardIds) &&
                value.shardIds.every(isShardId)
                ? { kind: "ready", shardIds: value.shardIds }
                : null;
        case "identify":
            return typeof value.id === "number" && isShardId(value.shardId)
                ? { kind: "identify", id: value.id, shardId: value.shardId }
                : null;
        case "identify-done":
            return isShardId(value.shardId)
                ? { kind: "identify-done", shardId: value.shardId }
                : null;
        case "reply":
            return typeof value.id === "string" &&
                (value.error === undefined || typeof value.error === "string")
                ? {
                      kind: "reply",
                      id: value.id,
                      ...(value.error !== undefined
                          ? { error: value.error }
                          : { result: value.result }),
                  }
                : null;
        case "health":
            return isRecord(value.report) &&
                Array.isArray(value.report.shards) &&
                typeof value.report.reportedAt === "number"
                ? { kind: "health", report: value.report as never }
                : null;
        default:
            return null;
    }
}

/** Validates the body of a control frame from the parent; `null` when it is malformed. */
export function parseParentFrame(value: unknown): ParentFrame | null {
    if (!isRecord(value)) return null;
    switch (value.kind) {
        case "identify-grant":
            return typeof value.id === "number"
                ? { kind: "identify-grant", id: value.id }
                : null;
        case "identify-deny":
            return typeof value.id === "number" &&
                typeof value.error === "string"
                ? { kind: "identify-deny", id: value.id, error: value.error }
                : null;
        case "request":
            return typeof value.id === "string" &&
                typeof value.type === "string"
                ? {
                      kind: "request",
                      id: value.id,
                      type: value.type,
                      data: value.data,
                  }
                : null;
        default:
            return null;
    }
}
