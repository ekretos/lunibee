/**
 * A rate-limit bucket as stored: units `remaining` in the window and when it
 * resets (`resetAt`, ms since the epoch, in the store's clock).
 */
export interface BucketState {
    remaining: number;
    resetAt: number;
    /** The bucket's limit per window, once a response has told us. */
    limit?: number;
    /** `X-RateLimit-Reset` of the window this state describes, in epoch ms. */
    window?: number;
    /**
     * `resetAt` is an estimate, not a server value: the window was opened by a
     * reservation after the last one elapsed. A server reset replaces it.
     */
    provisional?: boolean;
    /**
     * Placeholder for a bucket nobody knows yet: one request (the probe) is
     * on its way to discover the limit, and everyone else waits for it.
     */
    probe?: boolean;
}

/**
 * Outcome of an atomic reservation.
 *
 * `granted` means one unit of the bucket's allowance now belongs to the caller
 * and to nobody else — the distinction that a read-then-write cannot make when
 * several workers share a store. `known` says whether the bucket's limit is
 * known (so more requests may follow concurrently) or this request is the
 * probe that discovers it; `resetAt` identifies the window the unit came from.
 * A refusal says how long to wait and why.
 */
export type Reservation =
    | { granted: true; known?: boolean; resetAt?: number }
    | {
          granted: false;
          retryAfterMs: number;
          reason?: "bucket" | "global" | "probe";
      };

/** Options for {@link RateLimitStore.reserve}. */
export interface ReserveOptions {
    /** Global-limit scope to check in the same atomic step, if any. */
    global?: string;
    /** How long a probe may hold an unknown bucket before others may try (ms). */
    probeMs?: number;
}

/** What a response said about a bucket, for {@link RateLimitStore.reconcile}. */
export interface BucketUpdate {
    /** `X-RateLimit-Remaining`. */
    remaining?: number;
    /** `X-RateLimit-Reset-After`, in ms from now. */
    resetAfterMs?: number;
    /** `X-RateLimit-Limit`. */
    limit?: number;
    /** `X-RateLimit-Reset`, epoch ms: identifies the window. */
    window?: number;
    /** A bucket 429's wait, in ms: the bucket is spent until then. */
    retryAfterMs?: number;
}

/** Interface for distributed or local rate limit synchronization. */
export interface RateLimitStore {
    /** Gets the server bucket hash for a normalized route. */
    getBucketHash(
        route: string,
    ): Promise<string | undefined> | string | undefined;
    /** Associates a route with a server bucket hash. */
    setBucketHash(route: string, hash: string): Promise<void> | void;

    /** Gets the current state for a bucket key. */
    getBucket(
        key: string,
    ): Promise<BucketState | undefined> | BucketState | undefined;
    /** Replaces the state for a bucket key. */
    updateBucket(key: string, state: BucketState): Promise<void> | void;

    /** Gets the global reset timestamp (of `scope`, when the store keeps several). */
    getGlobalReset(scope?: string): Promise<number> | number;
    /** Sets the global reset timestamp (of `scope`, when the store keeps several). */
    setGlobalReset(resetAt: number, scope?: string): Promise<void> | void;

    /**
     * Atomically consumes one unit of a bucket's allowance.
     *
     * Optional: a store that cannot do this atomically must omit it, and the
     * limiter falls back to waiting on observed state. Implementations must
     * never refuse forever: an unknown bucket is discovered by sending, so
     * one caller (the probe) must be granted.
     */
    reserve?(
        key: string,
        options?: ReserveOptions,
    ): Promise<Reservation> | Reservation;

    /**
     * Whether {@link reserve} also checks `options.global` atomically. When
     * it does not, the limiter reads the global reset itself first.
     */
    readonly reservesGlobal?: boolean;

    /**
     * Atomically merges what a response said into a bucket, so a late or
     * out-of-order response cannot hand back allowance already reserved.
     * Optional: without it the limiter reads, merges and writes.
     */
    reconcile?(key: string, update: BucketUpdate): Promise<void> | void;

    /**
     * Atomically extends a global limit to at least `waitMs` from now, never
     * shortening a longer one. Optional: without it the limiter reads and
     * writes, which a concurrent writer can shorten.
     */
    extendGlobalReset?(scope: string, waitMs: number): Promise<void> | void;

    /**
     * Gives back what a granted reservation held, when that is certain to be
     * safe: a probe placeholder is cleared (so the next request may probe),
     * and with `refund` — the request was never sent — the unit is returned
     * to the window it came from, if that window is still current.
     */
    release?(
        key: string,
        grant: { resetAt?: number },
        refund: boolean,
    ): Promise<void> | void;

    /**
     * Evicts expired bucket entries. Optional: stores with native key
     * expiry (e.g. Redis) can omit it. `maxAge` (ms) additionally drops
     * buckets whose reset is older than that window; defaults to 0 (only
     * already-reset buckets are removed).
     */
    prune?(maxAge?: number): Promise<void> | void;
}

/** Longest a refused waiter sleeps on a placeholder before asking again (ms). */
export const PROBE_POLL_MS = 50;
/** Default time a probe may hold an unknown bucket (ms). */
export const DEFAULT_PROBE_MS = 16_000;
/** How long a bucket's limit is remembered after its window resets (ms). */
export const BUCKET_LINGER_MS = 60_000;
/** Reset values within this many ms of each other name the same window. */
const WINDOW_TOLERANCE_MS = 50;

/**
 * The reservation decision, shared by every built-in store (the Redis store
 * runs a Lua port of it). Returns the new state to write, if any.
 */
export function reserveState(
    state: BucketState | undefined,
    now: number,
    probeMs: number,
): { reservation: Reservation; next?: BucketState } {
    if (state && state.resetAt > now) {
        if (state.remaining > 0)
            return {
                reservation: {
                    granted: true,
                    known: true,
                    resetAt: state.resetAt,
                },
                next: { ...state, remaining: state.remaining - 1 },
            };
        const wait = state.resetAt - now;
        return {
            reservation: {
                granted: false,
                // An estimate is replaced as soon as a response lands, so ask
                // again soon rather than sleeping to the estimate.
                retryAfterMs: state.provisional
                    ? Math.min(wait, PROBE_POLL_MS)
                    : wait,
                reason: state.probe ? "probe" : "bucket",
            },
        };
    }
    const resetAt = now + probeMs;
    // The window elapsed and its limit is known: open the next one here, so
    // a fleet waking at the reset cannot send more than the limit at once.
    if (state?.limit !== undefined && state.limit > 0)
        return {
            reservation: { granted: true, known: true, resetAt },
            next: {
                remaining: state.limit - 1,
                resetAt,
                limit: state.limit,
                provisional: true,
            },
        };
    // Unknown: this caller probes, everyone else waits for its response.
    return {
        reservation: { granted: true, known: false, resetAt },
        next: { remaining: 0, resetAt, provisional: true, probe: true },
    };
}

/**
 * The merge of a response into a bucket, shared by every built-in store.
 *
 * Within a window `remaining` only ever goes down: the stored value already
 * counts reservations still in flight, the header counts what the server
 * has seen, and the lower of the two is the one that cannot over-send. A
 * response from an older window than the one stored is ignored. An estimated
 * reset is replaced by the server's.
 *
 * Returns the state to write, `null` to delete, or `undefined` for no change.
 */
export function reconcileState(
    state: BucketState | undefined,
    update: BucketUpdate,
    now: number,
): BucketState | null | undefined {
    const incoming =
        update.resetAfterMs === undefined
            ? undefined
            : Math.ceil(now + update.resetAfterMs);
    const active = !!state && state.resetAt > now && !state.probe;
    let next: BucketState;
    if (active) {
        next = { ...state! };
        const stale =
            update.window !== undefined &&
            next.window !== undefined &&
            update.window < next.window - WINDOW_TOLERANCE_MS;
        if (!stale) {
            if (update.remaining !== undefined)
                next.remaining = Math.min(next.remaining, update.remaining);
            if (incoming !== undefined) {
                const newer =
                    update.window !== undefined &&
                    next.window !== undefined &&
                    update.window > next.window + WINDOW_TOLERANCE_MS;
                next.resetAt =
                    next.provisional || newer
                        ? incoming
                        : Math.max(next.resetAt, incoming);
                delete next.provisional;
            }
            if (update.window !== undefined)
                next.window = Math.max(next.window ?? 0, update.window);
        }
    } else {
        if (
            update.remaining === undefined &&
            update.retryAfterMs === undefined
        ) {
            // Nothing learned. A probe placeholder must not outlive its
            // request, or everyone else waits out its whole lifetime.
            return state?.probe ? null : undefined;
        }
        next = {
            remaining: update.remaining ?? 0,
            resetAt: incoming ?? now,
        };
        if (state?.limit !== undefined) next.limit = state.limit;
        if (update.window !== undefined) next.window = update.window;
    }
    if (update.limit !== undefined && update.limit > 0)
        next.limit = update.limit;
    if (update.retryAfterMs !== undefined) {
        next.remaining = 0;
        next.resetAt = Math.max(
            next.resetAt,
            Math.ceil(now + update.retryAfterMs),
        );
        delete next.provisional;
    }
    return next;
}

/** Local memory implementation of RateLimitStore. */
export class MemoryRateLimitStore implements RateLimitStore {
    readonly #buckets = new Map<string, BucketState>();
    readonly #routeBuckets = new Map<string, string>();
    readonly #globals = new Map<string, number>();
    /** Minimum interval between automatic prunes, in ms. */
    static readonly #PRUNE_INTERVAL = 60_000;
    #lastPruneAt = 0;
    /** Most entries either map keeps; the oldest are dropped first. */
    static readonly #MAX_ENTRIES = 10_000;
    public readonly reservesGlobal = true;

    /** Creates an empty instance. */
    public constructor() {}

    static #evict(map: Map<string, unknown>): void {
        while (map.size > MemoryRateLimitStore.#MAX_ENTRIES)
            map.delete(map.keys().next().value as string);
    }

    public getBucketHash(route: string): string | undefined {
        return this.#routeBuckets.get(route);
    }
    public setBucketHash(route: string, hash: string): void {
        this.#routeBuckets.delete(route);
        this.#routeBuckets.set(route, hash);
        MemoryRateLimitStore.#evict(this.#routeBuckets);
    }
    public getBucket(key: string): BucketState | undefined {
        return this.#buckets.get(key);
    }
    /**
     * Consumes one unit of the bucket's allowance.
     *
     * Single-process reservation is trivially atomic: JavaScript will not
     * interleave this method with another caller's copy of it.
     */
    public reserve(key: string, options: ReserveOptions = {}): Reservation {
        const now = Date.now();
        if (options.global !== undefined) {
            const globalWait = this.getGlobalReset(options.global) - now;
            if (globalWait > 0)
                return {
                    granted: false,
                    retryAfterMs: globalWait,
                    reason: "global",
                };
        }
        const { reservation, next } = reserveState(
            this.#buckets.get(key),
            now,
            options.probeMs ?? DEFAULT_PROBE_MS,
        );
        if (next) this.#write(key, next);
        return reservation;
    }
    public reconcile(key: string, update: BucketUpdate): void {
        const next = reconcileState(this.#buckets.get(key), update, Date.now());
        if (next === null) this.#buckets.delete(key);
        else if (next) this.#write(key, next);
    }
    public release(
        key: string,
        grant: { resetAt?: number },
        refund: boolean,
    ): void {
        const state = this.#buckets.get(key);
        if (!state || state.resetAt !== grant.resetAt) return;
        if (state.probe) this.#buckets.delete(key);
        else if (refund)
            state.remaining = Math.min(
                state.remaining + 1,
                state.limit ?? Number.POSITIVE_INFINITY,
            );
    }
    public updateBucket(key: string, state: BucketState): void {
        this.#write(key, state);
    }
    #write(key: string, state: BucketState): void {
        this.#buckets.delete(key);
        this.#buckets.set(key, state);
        MemoryRateLimitStore.#evict(this.#buckets);
        // Amortised eviction: sweep expired buckets at most once per interval
        // so the map cannot grow unbounded across long-lived processes. A
        // bucket's limit is kept a while past its reset, so the next window
        // opens at the known limit instead of probing again.
        const now = Date.now();
        if (now - this.#lastPruneAt >= MemoryRateLimitStore.#PRUNE_INTERVAL) {
            this.#lastPruneAt = now;
            this.prune(BUCKET_LINGER_MS);
        }
    }
    /** Removes buckets whose reset is in the past (or older than `maxAge` ms). */
    public prune(maxAge = 0): void {
        const cutoff = Date.now() - Math.max(0, maxAge);
        for (const [key, state] of this.#buckets) {
            if (state.resetAt <= cutoff) this.#buckets.delete(key);
        }
        for (const [scope, resetAt] of this.#globals)
            if (resetAt <= Date.now()) this.#globals.delete(scope);
    }
    public getGlobalReset(scope = ""): number {
        return this.#globals.get(scope) ?? 0;
    }
    public setGlobalReset(resetAt: number, scope = ""): void {
        this.#globals.set(scope, resetAt);
        MemoryRateLimitStore.#evict(this.#globals);
    }
    public extendGlobalReset(scope: string, waitMs: number): void {
        const resetAt = Date.now() + Math.max(0, waitMs);
        if (resetAt > this.getGlobalReset(scope))
            this.setGlobalReset(resetAt, scope);
    }
    /** Number of buckets held (for diagnostics and leak checks). */
    public get size(): number {
        return this.#buckets.size;
    }
}
