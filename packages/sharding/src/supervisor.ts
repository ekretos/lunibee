/** How a crashed cluster is restarted. The defaults restart every crash after a fixed delay. */
export interface SupervisorOptions {
    /** Delay before the first restart, in milliseconds (default 5000). */
    restartDelay?: number;
    /** Each further crash in the window multiplies the delay by this (default 1: a fixed delay). */
    backoff?: number;
    /** The longest delay, jitter included (default 5 minutes). */
    maxDelay?: number;
    /** Random spread added to each delay, as a fraction of it (0-1, default 0). */
    jitter?: number;
    /** Give up after this many restarts without a stable `window` between them (default unlimited). */
    maxRestarts?: number;
    /** How long a restarted cluster must run before its earlier crashes are forgiven (default 60,000). */
    window?: number;
}

/**
 * Decides when, and whether, a crashed cluster comes back. It only does
 * arithmetic on timestamps (pass `now` in tests), so `ClusterManager` stays in
 * charge of forking.
 */
export class ShardSupervisor {
    readonly #options: Required<SupervisorOptions>;
    /** Restarts since the cluster last ran for a whole window, and when the last one starts. */
    readonly #restarts = new Map<
        number,
        { count: number; restartAt: number }
    >();
    readonly #random: () => number;

    public constructor(
        options: SupervisorOptions = {},
        random: () => number = Math.random,
    ) {
        this.#options = {
            restartDelay: options.restartDelay ?? 5000,
            backoff: options.backoff ?? 1,
            maxDelay: options.maxDelay ?? 300_000,
            jitter: options.jitter ?? 0,
            maxRestarts: options.maxRestarts ?? Number.POSITIVE_INFINITY,
            window: options.window ?? 60_000,
        };
        const { restartDelay, backoff, jitter, maxDelay, window, maxRestarts } =
            this.#options;
        if (!(restartDelay >= 0) || !(maxDelay >= 0) || !(window > 0))
            throw new RangeError(
                "restartDelay and maxDelay cannot be negative, and window must be positive.",
            );
        if (!(backoff >= 1))
            throw new RangeError("backoff must be at least 1.");
        if (!(jitter >= 0 && jitter <= 1))
            throw new RangeError("jitter must be between 0 and 1.");
        if (!(maxRestarts >= 0))
            throw new RangeError("maxRestarts cannot be negative.");
        this.#random = random;
    }

    /**
     * A cluster exited. @returns How many milliseconds to wait before
     * restarting it, or `null` to give up because it crashed more than
     * `maxRestarts` times inside `window`.
     */
    public next(id: number, now = Date.now()): number | null {
        const { window, maxRestarts, restartDelay, backoff, maxDelay, jitter } =
            this.#options;
        // A cluster is forgiven only after it ran for a whole `window` since
        // its last restart. Counting from the crash instead would let the
        // backoff delay itself age crashes out, so a crash-on-boot loop
        // would never reach `maxRestarts` or `maxDelay`.
        let history = this.#restarts.get(id);
        if (history && now - history.restartAt >= window) history = undefined;
        const count = history?.count ?? 0;
        if (count >= maxRestarts) {
            this.#restarts.delete(id);
            return null;
        }
        const base = Math.min(maxDelay, restartDelay * backoff ** count);
        // The cap applies after jitter: `maxDelay` is the longest wait, always.
        const delay = Math.min(
            maxDelay,
            Math.round(base * (1 + jitter * this.#random())),
        );
        this.#restarts.set(id, { count: count + 1, restartAt: now + delay });
        return delay;
    }

    /** Restarts of a cluster since it last ran stably for a whole `window`. */
    public attempts(id: number): number {
        return this.#restarts.get(id)?.count ?? 0;
    }

    /** Forgets a cluster's crashes, e.g. after a deliberate respawn. */
    public reset(id?: number): void {
        if (id === undefined) this.#restarts.clear();
        else this.#restarts.delete(id);
    }
}
