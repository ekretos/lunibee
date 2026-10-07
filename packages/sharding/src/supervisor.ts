/** How a crashed cluster is restarted. The defaults restart every crash after a fixed delay. */
export interface SupervisorOptions {
    /** Delay before the first restart, in milliseconds (default 5000). */
    restartDelay?: number;
    /** Each further crash in the window multiplies the delay by this (default 1: a fixed delay). */
    backoff?: number;
    /** The longest delay (default 5 minutes). */
    maxDelay?: number;
    /** Random spread added to each delay, as a fraction of it (0-1, default 0). */
    jitter?: number;
    /** Give up after this many restarts inside `window` (default unlimited). */
    maxRestarts?: number;
    /** The time over which restarts are counted, and after which a stable cluster is forgiven (default 60,000). */
    window?: number;
}

/**
 * Decides when, and whether, a crashed cluster comes back. It only does
 * arithmetic on timestamps (pass `now` in tests), so `ClusterManager` stays in
 * charge of forking.
 */
export class ShardSupervisor {
    readonly #options: Required<SupervisorOptions>;
    readonly #restarts = new Map<number, number[]>();
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
        const recent = (this.#restarts.get(id) ?? []).filter(
            (at) => now - at < window,
        );
        if (recent.length >= maxRestarts) {
            this.#restarts.delete(id);
            return null;
        }
        recent.push(now);
        this.#restarts.set(id, recent);
        const base = Math.min(
            maxDelay,
            restartDelay * backoff ** (recent.length - 1),
        );
        return Math.round(base * (1 + jitter * this.#random()));
    }

    /** Forgets a cluster's crashes, e.g. after a deliberate respawn. */
    public reset(id?: number): void {
        if (id === undefined) this.#restarts.clear();
        else this.#restarts.delete(id);
    }
}
