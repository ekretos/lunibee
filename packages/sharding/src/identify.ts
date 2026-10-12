/** Discord allows one IDENTIFY per rate-limit key every five seconds. */
export const IDENTIFY_INTERVAL = 5000;

/** What `/gateway/bot` says about the session budget. */
export interface IdentifyBudget {
    total: number;
    remaining: number;
    /** Milliseconds until `remaining` resets, counted from construction. */
    resetAfter: number;
}

/** Options for an {@link IdentifyCoordinator}. */
export interface IdentifyCoordinatorOptions {
    /** Discord's `max_concurrency`: shards with the same `id % maxConcurrency` share a key. Default 1. */
    maxConcurrency?: number;
    /** Milliseconds between two IDENTIFYs on one key. Default 5000. */
    interval?: number;
    /** The session-start budget, when known. Without it the coordinator paces but never blocks. */
    budget?: IdentifyBudget;
    /** A granted slot that is not released within this many ms is released for the holder. Default 60,000. */
    holdTimeout?: number;
    /** Clock, injectable for tests. */
    now?: () => number;
    /** Timer, injectable for tests. Must return a handle `cancel` understands. */
    schedule?: (callback: () => void, ms: number) => unknown;
    cancel?: (handle: unknown) => void;
    /** Called when a request has to wait for the budget to reset. */
    onBudgetWait?: (info: { shardId: number; waitMs: number }) => void;
}

interface Waiter {
    owner: number;
    shardId: number;
    grant: () => void;
    fail: (error: Error) => void;
}

interface Key {
    queue: Waiter[];
    /** The grant that has not been released yet. */
    holder?: { owner: number; shardId: number; timer: unknown };
    /** Earliest time the next IDENTIFY may start. */
    nextAt: number;
}

/**
 * Hands out IDENTIFY slots for a whole deployment. Every cluster asks the
 * parent, so the limit holds across processes: one IDENTIFY per rate-limit key
 * per interval, and no more IDENTIFYs than `session_start_limit.remaining`.
 * It only does arithmetic on timestamps and holds one timer, so it can be
 * tested with a fake clock.
 */
export class IdentifyCoordinator {
    readonly maxConcurrency: number;
    readonly #interval: number;
    readonly #holdTimeout: number;
    readonly #now: () => number;
    readonly #schedule: (callback: () => void, ms: number) => unknown;
    readonly #cancel: (handle: unknown) => void;
    readonly #onBudgetWait?: IdentifyCoordinatorOptions["onBudgetWait"];
    readonly #keys = new Map<number, Key>();
    #remaining: number | undefined;
    #total: number | undefined;
    #resetAt = Number.POSITIVE_INFINITY;
    #timer: unknown;
    #timerAt = Number.POSITIVE_INFINITY;
    #closed = false;

    public constructor(options: IdentifyCoordinatorOptions = {}) {
        const concurrency = options.maxConcurrency ?? 1;
        if (!Number.isInteger(concurrency) || concurrency < 1)
            throw new RangeError("maxConcurrency must be a positive integer.");
        const interval = options.interval ?? IDENTIFY_INTERVAL;
        const hold = options.holdTimeout ?? 60_000;
        if (!(interval >= 0) || !(hold > 0))
            throw new RangeError(
                "interval cannot be negative and holdTimeout must be positive.",
            );
        this.maxConcurrency = concurrency;
        this.#interval = interval;
        this.#holdTimeout = hold;
        this.#now = options.now ?? Date.now;
        this.#schedule =
            options.schedule ??
            ((callback, ms) => {
                const timer = setTimeout(callback, ms);
                (timer as { unref?: () => void }).unref?.();
                return timer;
            });
        this.#cancel =
            options.cancel ??
            ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
        this.#onBudgetWait = options.onBudgetWait;
        if (options.budget) {
            this.#total = options.budget.total;
            this.#remaining = options.budget.remaining;
            this.#resetAt = this.#now() + options.budget.resetAfter;
        }
    }

    /** Slots left in the session budget, or `undefined` when it is unknown. */
    public get remaining(): number | undefined {
        return this.#remaining;
    }

    /** Requests waiting for a slot. */
    public get waiting(): number {
        let count = 0;
        for (const key of this.#keys.values()) count += key.queue.length;
        return count;
    }

    /** Slots granted and not yet released. */
    public get holding(): number {
        let count = 0;
        for (const key of this.#keys.values()) if (key.holder) count++;
        return count;
    }

    /**
     * Waits for the shard's turn. Resolves when the shard may IDENTIFY now;
     * call {@link release} once it has. Rejects if `owner` is dropped or the
     * coordinator closes first.
     */
    public acquire(owner: number, shardId: number): Promise<void> {
        if (this.#closed)
            return Promise.reject(new Error("IDENTIFY coordinator is closed."));
        const index = shardId % this.maxConcurrency;
        let key = this.#keys.get(index);
        if (!key) this.#keys.set(index, (key = { queue: [], nextAt: 0 }));
        return new Promise<void>((grant, fail) => {
            key.queue.push({ owner, shardId, grant, fail });
            this.pump();
        });
    }

    /** The shard has sent its IDENTIFY: its key rests for one interval. Ignored unless `owner` holds the slot. */
    public release(owner: number, shardId: number): void {
        const key = this.#keys.get(shardId % this.maxConcurrency);
        const holder = key?.holder;
        if (
            !key ||
            !holder ||
            holder.owner !== owner ||
            holder.shardId !== shardId
        )
            return;
        this.#free(key);
        this.pump();
    }

    /** A cluster is gone: forget its waiting requests and free the slots it held. */
    public drop(owner: number, reason = "The cluster went away."): void {
        for (const key of this.#keys.values()) {
            const keep: Waiter[] = [];
            for (const waiter of key.queue)
                if (waiter.owner === owner) waiter.fail(new Error(reason));
                else keep.push(waiter);
            key.queue = keep;
            if (key.holder?.owner === owner) this.#free(key);
        }
        this.pump();
    }

    /** Rejects every waiter and stops the timer. */
    public close(): void {
        this.#closed = true;
        if (this.#timer !== undefined) this.#cancel(this.#timer);
        this.#timer = undefined;
        this.#timerAt = Number.POSITIVE_INFINITY;
        for (const key of this.#keys.values()) {
            if (key.holder) this.#cancel(key.holder.timer);
            key.holder = undefined;
            for (const waiter of key.queue)
                waiter.fail(new Error("IDENTIFY coordinator is closed."));
            key.queue = [];
        }
    }

    /** Grants every slot that is due and arms one timer for the next. Called internally and by tests after moving the clock. */
    public pump(): void {
        if (this.#closed) return;
        const now = this.#now();
        if (this.#total !== undefined && now >= this.#resetAt) {
            this.#remaining = this.#total;
            this.#resetAt = Number.POSITIVE_INFINITY;
        }
        let next = Number.POSITIVE_INFINITY;
        for (const key of this.#keys.values()) {
            if (key.holder || key.queue.length === 0) continue;
            if (key.nextAt > now) {
                next = Math.min(next, key.nextAt);
                continue;
            }
            if (this.#remaining !== undefined && this.#remaining <= 0) {
                const waiter = key.queue[0]!;
                if (this.#resetAt === Number.POSITIVE_INFINITY) {
                    // No reset time is known: nothing can be granted, fail loudly.
                    key.queue.shift();
                    waiter.fail(
                        new Error("The session start limit is exhausted."),
                    );
                    continue;
                }
                this.#onBudgetWait?.({
                    shardId: waiter.shardId,
                    waitMs: this.#resetAt - now,
                });
                next = Math.min(next, this.#resetAt);
                continue;
            }
            const waiter = key.queue.shift()!;
            if (this.#remaining !== undefined) this.#remaining--;
            const timer = this.#schedule(() => {
                if (key.holder?.timer === timer) {
                    this.#free(key);
                    this.pump();
                }
            }, this.#holdTimeout);
            key.holder = {
                owner: waiter.owner,
                shardId: waiter.shardId,
                timer,
            };
            waiter.grant();
        }
        this.#arm(next);
    }

    #free(key: Key): void {
        if (key.holder) this.#cancel(key.holder.timer);
        key.holder = undefined;
        key.nextAt = this.#now() + this.#interval;
    }

    #arm(at: number): void {
        if (at === this.#timerAt && this.#timer !== undefined) return;
        if (this.#timer !== undefined) this.#cancel(this.#timer);
        this.#timer = undefined;
        this.#timerAt = Number.POSITIVE_INFINITY;
        if (at === Number.POSITIVE_INFINITY) return;
        this.#timerAt = at;
        this.#timer = this.#schedule(
            () => {
                this.#timer = undefined;
                this.#timerAt = Number.POSITIVE_INFINITY;
                this.pump();
            },
            Math.max(0, at - this.#now()),
        );
    }
}
