/**
 * Reconnect policy and scheduling for one Gateway connection.
 *
 * Owns how a close code is classified, whether another attempt is allowed, how
 * long to wait, and the coordination that keeps at most one logical connection
 * attempt in flight. It owns no socket, no session state, no heartbeat and no
 * event emission: it is told a close code and whether a resume is possible, and
 * answers with a decision.
 */
import { GatewayCloseCodes } from "./close-codes.js";

/** What a closed connection should do next. */
export type CloseAction =
    /** Reconnect and RESUME the existing session. */
    | "resume"
    /** Reconnect, but IDENTIFY afresh: the session cannot be resumed. */
    | "identify"
    /** Do not reconnect; the condition will not fix itself. */
    | "stop";

/**
 * Close codes that no reconnect can recover from: bad token, bad shard
 * configuration, bad API version, or intents the application is not approved
 * for. Retrying these hammers Discord with a request that cannot succeed.
 */
export const FATAL_CLOSE_CODES: readonly number[] = [
    GatewayCloseCodes.AuthenticationFailed,
    GatewayCloseCodes.InvalidShard,
    GatewayCloseCodes.ShardingRequired,
    GatewayCloseCodes.InvalidAPIVersion,
    GatewayCloseCodes.InvalidIntents,
    GatewayCloseCodes.DisallowedIntents,
];

/**
 * Close codes that keep the connection recoverable but destroy the session, so
 * the next connection must IDENTIFY rather than RESUME.
 */
export const IDENTIFY_CLOSE_CODES: readonly number[] = [
    GatewayCloseCodes.InvalidSeq,
    GatewayCloseCodes.SessionTimedOut,
];

/**
 * Classifies a close code.
 *
 * Any code outside the two tables above is **reconnectable**: transport-level
 * closes (`1006`), server restarts (`1001`), Discord's own `4000`, and the
 * `1000` the Gateway itself sends after a non-resumable `op 9` all belong here.
 * Whether that reconnect resumes or identifies is not a property of the code —
 * it is whether a session survives, which is why `canResume` is a parameter
 * rather than something this module works out for itself.
 *
 * @param code WebSocket close code.
 * @param canResume Whether the session can still be resumed.
 */
export function classifyCloseCode(
    code: number,
    canResume: boolean,
): CloseAction {
    if (FATAL_CLOSE_CODES.includes(code)) return "stop";
    if (IDENTIFY_CLOSE_CODES.includes(code)) return "identify";
    return canResume ? "resume" : "identify";
}

/** Why a reconnect was not scheduled. */
export type ScheduleRefusal =
    /** Automatic reconnect is disabled for this Gateway. */
    | "disabled"
    /** A reconnect is already armed; a second would open a second socket. */
    | "pending"
    /** The attempt budget is spent. */
    | "exhausted";

/** Outcome of asking for a reconnect. */
export type ScheduleResult =
    | { scheduled: true; delayMs: number; attempt: number }
    | { scheduled: false; reason: ScheduleRefusal };

/** Configuration for {@link GatewayReconnect}. */
export interface ReconnectOptions {
    /** Whether automatic reconnect is permitted at all. */
    enabled: boolean;
    /** Maximum consecutive attempts before giving up. */
    maxAttempts: number;
    /** Delay for the first attempt, doubled per attempt. */
    baseDelay: number;
    /** Ceiling for the backoff. */
    maxDelay: number;
    /** Randomness source for jitter; injected in tests. */
    random?: () => number;
}

/** Reconnect scheduling, backoff and attempt coordination. */
export class GatewayReconnect {
    readonly #options: ReconnectOptions;
    readonly #random: () => number;
    #attempt = 0;
    #timer?: ReturnType<typeof setTimeout>;
    #promise?: Promise<void>;
    #resolve?: () => void;
    #reject?: (error: Error) => void;

    public constructor(options: ReconnectOptions) {
        this.#options = options;
        this.#random = options.random ?? Math.random;
    }

    /** Whether automatic reconnect is permitted. */
    public get enabled(): boolean {
        return this.#options.enabled;
    }

    /** Consecutive attempts made since the last {@link reset}. */
    public get attempts(): number {
        return this.#attempt;
    }

    /** Whether a reconnect timer is currently armed. */
    public get pending(): boolean {
        return this.#timer !== undefined;
    }

    /** Whether the attempt budget is spent. */
    public get exhausted(): boolean {
        return this.#attempt >= this.#options.maxAttempts;
    }

    /** Whether a connection attempt is currently in flight. */
    public get connecting(): boolean {
        return this.#promise !== undefined;
    }

    /** The in-flight attempt, or undefined when none is active. */
    public get attemptPromise(): Promise<void> | undefined {
        return this.#promise;
    }

    /** Classifies a close code against this Gateway's policy. */
    public classifyClose(code: number, canResume: boolean): CloseAction {
        return classifyCloseCode(code, canResume);
    }

    /** Whether another reconnect is currently allowed. */
    public canReconnect(): boolean {
        return this.#options.enabled && !this.exhausted;
    }

    /**
     * Arms a reconnect, unless one is already armed or no attempt is allowed.
     *
     * Refusing while `pending` is what keeps repeated closes from stacking
     * timers: several closes in a row produce one reconnect, not several
     * competing sockets.
     */
    public schedule(run: () => void): ScheduleResult {
        if (!this.#options.enabled)
            return { scheduled: false, reason: "disabled" };
        if (this.#timer) return { scheduled: false, reason: "pending" };
        if (this.exhausted) return { scheduled: false, reason: "exhausted" };

        const attempt = this.#attempt;
        const delay = Math.min(
            this.#options.maxDelay,
            this.#options.baseDelay * 2 ** this.#attempt++,
        );
        // Jitter must scale with the delay: a fixed ceiling would reconnect
        // every shard inside the same narrow window after a gateway-wide
        // restart, which is exactly when decorrelation matters.
        const jitter = this.#random() * Math.max(1, delay * 0.25);
        const delayMs = delay + jitter;
        this.#timer = setTimeout(() => {
            this.#timer = undefined;
            run();
        }, delayMs);
        return { scheduled: true, delayMs, attempt };
    }

    /** Cancels an armed reconnect. Safe to call when none is armed. */
    public cancel(): void {
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = undefined;
    }

    /** Clears the attempt counter after a connection succeeds. */
    public reset(): void {
        this.#attempt = 0;
    }

    /**
     * Coordinates one logical connection attempt.
     *
     * Callers that ask while an attempt is in flight join it instead of
     * starting a second: three `connect()` calls produce one socket attempt and
     * one shared promise.
     *
     * @param start Invoked exactly once, when this call begins a new attempt.
     */
    public attempt(start: () => void): Promise<void> {
        if (this.#promise) return this.#promise;
        this.#promise = new Promise<void>((resolve, reject) => {
            this.#resolve = resolve;
            this.#reject = reject;
            start();
        });
        return this.#promise;
    }

    /** Settles the in-flight attempt, resolving it or rejecting with `error`. */
    public settle(error?: Error): void {
        const resolve = this.#resolve;
        const reject = this.#reject;
        this.#resolve = undefined;
        this.#reject = undefined;
        this.#promise = undefined;
        if (error) reject?.(error);
        else resolve?.();
    }
}
