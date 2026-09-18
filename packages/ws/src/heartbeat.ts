/**
 * Heartbeat and liveness for one Gateway connection.
 *
 * Owns every timer that decides whether a connection is alive: the heartbeat
 * interval, the acknowledgement deadline, and the staleness (zombie) watch.
 * It owns no socket, no session, no reconnect policy and no event emission —
 * it reports through callbacks and lets its owner decide what to close.
 */

/** Why the connection was declared dead. */
export type HeartbeatTimeout =
    | {
          /** A heartbeat went unacknowledged within `ackTimeout`. */
          type: "ack";
          /** Time since the unacknowledged heartbeat was sent. */
          elapsedMs: number;
      }
    | {
          /** No traffic at all arrived within the staleness deadline. */
          type: "zombie";
          /** Time since the last inbound message. */
          silentFor: number;
          /** Deadline that was exceeded. */
          deadline: number;
      };

/** Collaborators the heartbeat needs from its owner. */
export interface HeartbeatOptions {
    /** Milliseconds to wait for an ACK before declaring the connection dead. */
    ackTimeout: number;
    /** Minimum silence before the connection is treated as a zombie. */
    zombieTimeout: number;
    /**
     * Writes a heartbeat payload.
     * @returns Whether it reached the wire; `false` is reported as an error.
     */
    send: (sequence: number | null) => boolean;
    /** Current session sequence, sent as the heartbeat's `d`. */
    sequence: () => number | null;
    /** Whether the underlying connection is open. */
    isConnected: () => boolean;
    /** Called when the connection fails a liveness check. */
    onTimeout: (timeout: HeartbeatTimeout) => void;
    /** Called for non-fatal problems, such as a heartbeat that could not be sent. */
    onError: (error: Error) => void;
    /** Clock injection point for tests. */
    now?: () => number;
}

/** Longest gap between staleness checks. */
const MAX_MONITOR_INTERVAL = 1000;

/** Heartbeat lifecycle for one Gateway connection. */
export class GatewayHeartbeat {
    readonly #options: HeartbeatOptions;
    readonly #now: () => number;
    #interval = 0;
    #acknowledged = true;
    #sentAt = 0;
    #latency = -1;
    #lastMessageAt = 0;
    #zombieReported = false;
    #timer?: ReturnType<typeof setInterval>;
    #initialTimer?: ReturnType<typeof setTimeout>;
    #ackTimer?: ReturnType<typeof setTimeout>;
    #monitorTimer?: ReturnType<typeof setInterval>;

    public constructor(options: HeartbeatOptions) {
        if (options.zombieTimeout <= options.ackTimeout)
            throw new RangeError(
                "Gateway zombieTimeout must be greater than heartbeatAckTimeout",
            );
        this.#options = options;
        this.#now = options.now ?? (() => Date.now());
    }

    /** Round-trip time of the last acknowledged heartbeat, or -1 before the first. */
    public get latency(): number {
        return this.#latency;
    }

    /** Heartbeat interval Discord asked for, or 0 before HELLO. */
    public get interval(): number {
        return this.#interval;
    }

    /** Whether the most recent heartbeat has been acknowledged. */
    public get acknowledged(): boolean {
        return this.#acknowledged;
    }

    /** Milliseconds since the last inbound message, or 0 when none has arrived. */
    public get silentFor(): number {
        return this.#lastMessageAt === 0
            ? 0
            : this.#now() - this.#lastMessageAt;
    }

    /**
     * Deadline beyond which silence means the connection is dead.
     *
     * At least one heartbeat interval plus its ACK budget, so a quiet Gateway
     * is never mistaken for a dead one.
     */
    public get stalenessDeadline(): number {
        return Math.max(
            this.#options.zombieTimeout,
            this.#interval + this.#options.ackTimeout,
        );
    }

    /** Whether the connection looks alive: last beat acknowledged and traffic recent. */
    public isHealthy(): boolean {
        if (!this.#acknowledged) return false;
        if (this.#lastMessageAt === 0) return true;
        return this.silentFor < this.stalenessDeadline;
    }

    /**
     * Begins watching for silence. Call when the connection opens, before HELLO:
     * a connection that never reaches HELLO must still be detected as dead.
     */
    public watch(): void {
        this.#lastMessageAt = this.#now();
        this.#zombieReported = false;
        this.#startMonitor();
    }

    /** Records inbound traffic of any kind. */
    public receivedMessage(): void {
        this.#lastMessageAt = this.#now();
        this.#zombieReported = false;
    }

    /**
     * Starts heartbeating at Discord's interval.
     *
     * The first beat is jittered across the interval, as Discord's
     * documentation requires, so a fleet reconnecting together does not
     * heartbeat in lockstep.
     */
    public start(interval: number): void {
        this.#clearBeatTimers();
        this.#interval = interval;
        this.#acknowledged = true;
        this.#initialTimer = setTimeout(
            () => this.sendHeartbeat(),
            Math.random() * interval,
        );
        this.#timer = setInterval(() => this.sendHeartbeat(), interval);
    }

    /** Stops every timer. Safe to call more than once. */
    public stop(): void {
        this.#clearBeatTimers();
        if (this.#monitorTimer) clearInterval(this.#monitorTimer);
        this.#monitorTimer = undefined;
    }

    /** Sends a heartbeat now, and arms the acknowledgement deadline. */
    public sendHeartbeat(): void {
        this.#acknowledged = false;
        this.#sentAt = this.#now();
        if (!this.#options.send(this.#options.sequence())) {
            this.#options.onError(
                new Error(
                    "Unable to send Gateway heartbeat because the WebSocket is not open.",
                ),
            );
            return;
        }
        this.#clearAckTimer();
        this.#ackTimer = setTimeout(() => {
            if (this.#acknowledged) return;
            this.#options.onTimeout({
                type: "ack",
                elapsedMs: this.#now() - this.#sentAt,
            });
        }, this.#options.ackTimeout);
    }

    /** Records a heartbeat ACK and updates {@link latency}. */
    public acknowledge(): void {
        this.#acknowledged = true;
        this.#latency = this.#now() - this.#sentAt;
        this.#clearAckTimer();
    }

    #startMonitor(): void {
        if (this.#monitorTimer) clearInterval(this.#monitorTimer);
        // Poll granularity only needs to be a fraction of the staleness
        // deadline. A 1s ceiling keeps detection latency negligible while
        // costing one wakeup per second per shard instead of four.
        const interval = Math.max(
            1,
            Math.min(
                MAX_MONITOR_INTERVAL,
                this.#options.ackTimeout,
                this.#options.zombieTimeout / 2,
            ),
        );
        this.#monitorTimer = setInterval(
            () => this.#checkStaleness(),
            interval,
        );
    }

    #checkStaleness(): void {
        if (!this.#options.isConnected() || this.#lastMessageAt === 0) return;
        const silentFor = this.silentFor;
        const deadline = this.stalenessDeadline;
        if (silentFor < deadline || this.#zombieReported) return;
        // Report once per silence: the owner closes the connection, and the
        // close path stops these timers.
        this.#zombieReported = true;
        this.#options.onTimeout({ type: "zombie", silentFor, deadline });
    }

    #clearAckTimer(): void {
        if (this.#ackTimer) clearTimeout(this.#ackTimer);
        this.#ackTimer = undefined;
    }

    #clearBeatTimers(): void {
        if (this.#timer) clearInterval(this.#timer);
        if (this.#initialTimer) clearTimeout(this.#initialTimer);
        this.#clearAckTimer();
        this.#timer = undefined;
        this.#initialTimer = undefined;
    }
}
