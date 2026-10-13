import { createHmac, timingSafeEqual } from "node:crypto";

/** Version of the coordinator ↔ host wire protocol. Both sides must agree. */
export const REMOTE_PROTOCOL_VERSION = 1;
/** Largest text frame either side accepts, in bytes. */
export const MAX_REMOTE_FRAME_BYTES = 8 * 1024 * 1024;

/** WebSocket close codes used between a coordinator and a host. */
export const RemoteClose = {
    BadRequest: 4400,
    AuthFailed: 4401,
    HelloTimeout: 4408,
    DuplicateHost: 4409,
    TooManyConnections: 4429,
    UnknownHost: 4410,
    VersionMismatch: 4426,
    HostLost: 4504,
    Shutdown: 4500,
} as const;

/**
 * The only environment variables a coordinator may set in a remote worker.
 * Everything else comes from the host's own environment, so a coordinator
 * cannot inject `NODE_OPTIONS`, `LD_PRELOAD` or a token.
 */
export const SPAWN_ENV_KEYS: ReadonlySet<string> = new Set([
    "SHARD_LIST",
    "SHARD_COUNT",
    "CLUSTER_ID",
    "CLUSTER_COUNT",
    "LUNIBEE_SHARD_BUS",
    "LUNIBEE_CLUSTER_WORKER",
    "LUNIBEE_IDENTIFY",
]);

/** Signals a coordinator may send to a remote worker. */
export const KILL_SIGNALS: ReadonlySet<string> = new Set([
    "SIGTERM",
    "SIGKILL",
    "SIGINT",
]);

/** A host ID: letters, digits, `.`, `_` and `-`, up to 64 characters. */
export const HOST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Frames the coordinator sends to a host. */
export type ToHost =
    | { t: "challenge"; nonce: string; version: number }
    | { t: "welcome"; leaseMs: number; pingMs: number }
    | { t: "ping"; n: number }
    | {
          t: "spawn";
          cluster: number;
          epoch: number;
          env: Record<string, string>;
      }
    | { t: "frame"; cluster: number; epoch: number; frame: unknown }
    | { t: "kill"; cluster: number; epoch: number; signal: string }
    | { t: "bye"; reason: string };

/** Frames a host sends to the coordinator. */
export type ToCoordinator =
    | { t: "hello"; id: string; mac: string; version: number }
    | { t: "pong"; n: number }
    | { t: "spawned"; cluster: number; epoch: number; pid?: number }
    | { t: "frame"; cluster: number; epoch: number; frame: unknown }
    | {
          t: "exit";
          cluster: number;
          epoch: number;
          code: number | null;
          signal: string | null;
      }
    | { t: "error"; cluster: number; epoch: number; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0;

function parseJson(text: unknown): Record<string, unknown> | null {
    if (typeof text !== "string" || text.length > MAX_REMOTE_FRAME_BYTES)
        return null;
    try {
        const value: unknown = JSON.parse(text);
        return isRecord(value) ? value : null;
    } catch {
        return null;
    }
}

/** The proof a host sends: an HMAC of the coordinator's nonce and the host ID, keyed by the shared secret. The secret itself never travels. */
export function signChallenge(
    secret: string,
    nonce: string,
    hostId: string,
): string {
    return createHmac("sha256", secret)
        .update(`${nonce}:${hostId}`)
        .digest("hex");
}

/** Checks a host's proof in constant time. */
export function verifyChallenge(
    secret: string,
    nonce: string,
    hostId: string,
    mac: unknown,
): boolean {
    if (typeof mac !== "string") return false;
    const expected = Buffer.from(signChallenge(secret, nonce, hostId), "hex");
    const given = Buffer.from(mac, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Validates a text frame from the coordinator; `null` when malformed. */
export function parseToHost(text: unknown): ToHost | null {
    const v = parseJson(text);
    if (!v) return null;
    switch (v.t) {
        case "challenge":
            return typeof v.nonce === "string" && isInt(v.version)
                ? { t: "challenge", nonce: v.nonce, version: v.version }
                : null;
        case "welcome":
            return isInt(v.leaseMs) && isInt(v.pingMs)
                ? { t: "welcome", leaseMs: v.leaseMs, pingMs: v.pingMs }
                : null;
        case "ping":
            return isInt(v.n) ? { t: "ping", n: v.n } : null;
        case "spawn": {
            if (!isInt(v.cluster) || !isInt(v.epoch) || !isRecord(v.env))
                return null;
            const env: Record<string, string> = {};
            for (const [key, value] of Object.entries(v.env)) {
                if (!SPAWN_ENV_KEYS.has(key) || typeof value !== "string")
                    return null;
                env[key] = value;
            }
            return { t: "spawn", cluster: v.cluster, epoch: v.epoch, env };
        }
        case "frame":
            return isInt(v.cluster) && isInt(v.epoch)
                ? {
                      t: "frame",
                      cluster: v.cluster,
                      epoch: v.epoch,
                      frame: v.frame,
                  }
                : null;
        case "kill":
            return isInt(v.cluster) &&
                isInt(v.epoch) &&
                typeof v.signal === "string" &&
                KILL_SIGNALS.has(v.signal)
                ? {
                      t: "kill",
                      cluster: v.cluster,
                      epoch: v.epoch,
                      signal: v.signal,
                  }
                : null;
        case "bye":
            return typeof v.reason === "string"
                ? { t: "bye", reason: v.reason }
                : null;
        default:
            return null;
    }
}

/** Validates a text frame from a host; `null` when malformed. */
export function parseToCoordinator(text: unknown): ToCoordinator | null {
    const v = parseJson(text);
    if (!v) return null;
    switch (v.t) {
        case "hello":
            return typeof v.id === "string" &&
                typeof v.mac === "string" &&
                isInt(v.version)
                ? { t: "hello", id: v.id, mac: v.mac, version: v.version }
                : null;
        case "pong":
            return isInt(v.n) ? { t: "pong", n: v.n } : null;
        case "spawned":
            return isInt(v.cluster) &&
                isInt(v.epoch) &&
                (v.pid === undefined || isInt(v.pid))
                ? {
                      t: "spawned",
                      cluster: v.cluster,
                      epoch: v.epoch,
                      ...(v.pid !== undefined ? { pid: v.pid as number } : {}),
                  }
                : null;
        case "frame":
            return isInt(v.cluster) && isInt(v.epoch)
                ? {
                      t: "frame",
                      cluster: v.cluster,
                      epoch: v.epoch,
                      frame: v.frame,
                  }
                : null;
        case "exit":
            return isInt(v.cluster) &&
                isInt(v.epoch) &&
                (v.code === null || typeof v.code === "number") &&
                (v.signal === null || typeof v.signal === "string")
                ? {
                      t: "exit",
                      cluster: v.cluster,
                      epoch: v.epoch,
                      code: v.code,
                      signal: v.signal,
                  }
                : null;
        case "error":
            return isInt(v.cluster) &&
                isInt(v.epoch) &&
                typeof v.message === "string"
                ? {
                      t: "error",
                      cluster: v.cluster,
                      epoch: v.epoch,
                      message: v.message,
                  }
                : null;
        default:
            return null;
    }
}
