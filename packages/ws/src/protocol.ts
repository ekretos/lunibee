/**
 * Discord Gateway protocol: what a payload *means*.
 *
 * Pure translation from a received frame to an action, plus construction of
 * the payloads Lunibee sends. It performs nothing: no socket, no timers, no
 * session mutation, no event emission, no sending. The caller decides what to
 * do with an action, which is what lets the whole protocol be tested without a
 * connection.
 */
import type { GatewayPayload, GatewayPresence } from "@lunibee/types";
import { GatewayOpcodes } from "./opcodes.js";
import type { ResumeInfo } from "./session.js";

/** Why a frame could not be understood. */
export type ProtocolViolation =
    /** The frame was not valid JSON. */
    | "invalid-json"
    /** The frame decoded to something other than a payload object. */
    | "invalid-payload"
    /** `HELLO` carried no usable heartbeat interval. */
    | "invalid-hello";

/** What a received frame means. */
export type GatewayAction =
    /** `op 10`: begin heartbeating and hand shake. */
    | { type: "hello"; heartbeatInterval: number }
    /** `op 0`: an event. `event` is null only if Discord omitted `t`. */
    | { type: "dispatch"; event: string | null; data: unknown }
    /** `op 1`: Discord asks for a heartbeat now. */
    | { type: "heartbeat" }
    /** `op 11`: the last heartbeat was acknowledged. */
    | { type: "heartbeat-ack"; data: unknown }
    /** `op 7`: Discord asks the client to reconnect. */
    | { type: "reconnect" }
    /** `op 9`: the session is gone. `resumable` decides RESUME vs IDENTIFY. */
    | { type: "invalid-session"; resumable: boolean }
    /**
     * An opcode this version does not handle.
     *
     * Ignored rather than treated as an error: Discord adds opcodes, and a
     * client that fails on an unfamiliar one breaks itself on every addition.
     */
    | { type: "unknown"; opcode: number }
    /** The frame was malformed. Never silently swallowed. */
    | {
          type: "invalid";
          violation: ProtocolViolation;
          message: string;
          cause?: unknown;
      };

/** A classified frame: its sequence, if any, and what it means. */
export interface ProtocolResult {
    /**
     * Sequence carried by the frame, or null when it carried none.
     *
     * Reported for every payload type, not just dispatches: recording it is
     * the caller's decision, and the caller records before acting so a RESUME
     * cannot be built from a sequence that was never seen.
     */
    sequence: number | null;
    /** What the frame means. */
    action: GatewayAction;
}

/**
 * Classifies one received frame.
 *
 * @param raw The frame text, already decompressed by the transport.
 */
export function classifyFrame(raw: string): ProtocolResult {
    let payload: GatewayPayload;
    try {
        payload = JSON.parse(raw) as GatewayPayload;
    } catch (error) {
        return {
            sequence: null,
            action: {
                type: "invalid",
                violation: "invalid-json",
                message: "Gateway returned invalid JSON",
                cause: error,
            },
        };
    }
    return classifyPayload(payload);
}

/** Classifies an already-parsed payload. */
export function classifyPayload(payload: unknown): ProtocolResult {
    if (
        payload === null ||
        typeof payload !== "object" ||
        typeof (payload as GatewayPayload).op !== "number"
    )
        return {
            sequence: null,
            action: {
                type: "invalid",
                violation: "invalid-payload",
                message: "Gateway returned an invalid payload",
            },
        };

    const frame = payload as GatewayPayload;
    const sequence = typeof frame.s === "number" ? frame.s : null;

    switch (frame.op) {
        case GatewayOpcodes.Dispatch:
            return {
                sequence,
                action: {
                    type: "dispatch",
                    event: typeof frame.t === "string" ? frame.t : null,
                    data: frame.d,
                },
            };
        case GatewayOpcodes.Hello: {
            const interval = (frame.d as { heartbeat_interval?: unknown })
                ?.heartbeat_interval;
            if (
                typeof interval !== "number" ||
                !Number.isFinite(interval) ||
                interval <= 0
            )
                return {
                    sequence,
                    action: {
                        type: "invalid",
                        violation: "invalid-hello",
                        message:
                            "Gateway HELLO payload contains an invalid heartbeat interval",
                    },
                };
            return {
                sequence,
                action: { type: "hello", heartbeatInterval: interval },
            };
        }
        case GatewayOpcodes.Heartbeat:
            return { sequence, action: { type: "heartbeat" } };
        case GatewayOpcodes.HeartbeatAck:
            return {
                sequence,
                action: { type: "heartbeat-ack", data: frame.d },
            };
        case GatewayOpcodes.Reconnect:
            return { sequence, action: { type: "reconnect" } };
        case GatewayOpcodes.InvalidSession:
            // `d` is a boolean: true means the session may still be resumed.
            // Anything else is treated as non-resumable, which is the safe
            // reading — a wrongly-attempted RESUME costs another round trip.
            return {
                sequence,
                action: {
                    type: "invalid-session",
                    resumable: frame.d === true,
                },
            };
        default:
            return { sequence, action: { type: "unknown", opcode: frame.op } };
    }
}

/** Identification properties sent with IDENTIFY. */
export interface IdentifyProperties {
    os?: string;
    browser?: string;
    device?: string;
    [key: string]: unknown;
}

/** Everything IDENTIFY needs. */
export interface IdentifyOptions {
    token: string;
    intents: number;
    shardId: number;
    shardCount: number;
    properties?: IdentifyProperties;
    presence?: GatewayPresence;
}

/** Builds an IDENTIFY payload. */
export function identifyPayload(options: IdentifyOptions): GatewayPayload {
    const props = options.properties ?? {};
    const os = props.os ?? "Android";
    const browser = props.browser ?? "Discord Android";
    const device = props.device ?? "Discord Android";
    return {
        op: GatewayOpcodes.Identify,
        d: {
            token: options.token,
            intents: options.intents,
            properties: {
                os,
                browser,
                device,
                // Discord accepted `$`-prefixed property names historically and
                // still does; both spellings are sent so the payload works
                // against either expectation.
                $os: os,
                $browser: browser,
                $device: device,
                ...props,
            },
            presence: {
                since: options.presence?.since ?? null,
                activities: options.presence?.activities ?? [],
                status: options.presence?.status ?? "online",
                afk: Boolean(options.presence?.afk),
            },
            shard: [options.shardId, options.shardCount],
        },
        s: null,
        t: null,
    };
}

/** Builds a RESUME payload from the session's resume material. */
export function resumePayload(
    token: string,
    resume: ResumeInfo,
): GatewayPayload {
    return {
        op: GatewayOpcodes.Resume,
        d: {
            token,
            session_id: resume.sessionId,
            seq: resume.sequence,
        },
        s: null,
        t: null,
    };
}

/** Builds a heartbeat payload carrying the last sequence seen. */
export function heartbeatPayload(sequence: number | null): GatewayPayload {
    return { op: GatewayOpcodes.Heartbeat, d: sequence, s: null, t: null };
}
