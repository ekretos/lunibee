import { RESTError, abortable } from "./errors.js";

/** Limits for {@link RequestScheduler}. */
export interface SchedulerOptions {
    /** Most requests waiting for a slot across all buckets. Default unlimited. */
    maxQueued?: number;
    /** Most requests waiting for a slot on one bucket. Default unlimited. */
    maxQueuedPerBucket?: number;
}

/**
 * Serialises work per rate-limit bucket.
 *
 * One request per bucket key is in flight at a time, so each request sees the
 * limit state its predecessor's response wrote. The queue slot is released on
 * every exit path — including an abort raised while still waiting — because a
 * slot that is never released wedges its bucket for the process lifetime.
 * Buckets queue independently: a slow bucket never holds up another.
 */
export class RequestScheduler {
    /** Maximum times a request may be moved to a different bucket queue. */
    public static readonly MAX_REMAPS = 2;
    readonly #queues = new Map<string, Promise<void>>();
    readonly #waiting = new Map<string, number>();
    #queued = 0;
    readonly #maxQueued: number;
    readonly #maxQueuedPerBucket: number;

    /** Creates an empty scheduler. @param options Queue limits. */
    public constructor(options: SchedulerOptions = {}) {
        this.#maxQueued = options.maxQueued ?? Number.POSITIVE_INFINITY;
        this.#maxQueuedPerBucket =
            options.maxQueuedPerBucket ?? Number.POSITIVE_INFINITY;
        if (!(this.#maxQueued >= 0) || !(this.#maxQueuedPerBucket >= 0))
            throw new RangeError("Queue limits must be non-negative numbers.");
    }

    /** Number of bucket keys currently holding a queue slot. */
    public get size(): number {
        return this.#queues.size;
    }

    /** Number of requests waiting for a slot. */
    public get queued(): number {
        return this.#queued;
    }

    /**
     * Runs `task` under the bucket key that `resolveKey` reports *at the moment
     * the slot is acquired*, not at enqueue time.
     *
     * Discord can map several routes onto one bucket hash, and a route only
     * learns its hash from a response. A request that queued under its
     * route-derived key while another request discovered the shared hash would
     * otherwise run concurrently with that bucket's other traffic. Re-resolving
     * after the wait moves it onto the right queue instead.
     *
     * @param resolveKey Returns the current bucket key for this request.
     * @param signal Cancellation signal honoured while queued.
     * @param path Request path, used for cancellation error context.
     * @param task Work to run while holding the slot, given the final key and
     *   a callback that frees the slot early.
     */
    public async runResolved<T>(
        resolveKey: () => Promise<string>,
        signal: AbortSignal | undefined,
        path: string,
        task: (key: string, release: () => void) => Promise<T>,
    ): Promise<T> {
        let key = await resolveKey();
        // A remap can only chain as far as route key -> shared hash, so a small
        // bound is enough; the final hop runs whatever key it holds.
        for (let hop = 0; hop < RequestScheduler.MAX_REMAPS; hop++) {
            const outcome = await this.run<
                { done: true; value: T } | { done: false; key: string }
            >(key, signal, path, async (release) => {
                const current = await resolveKey();
                if (current !== key) return { done: false, key: current };
                return { done: true, value: await task(key, release) };
            });
            if (outcome.done) return outcome.value;
            key = outcome.key;
        }
        return this.run(key, signal, path, (release) => task(key, release));
    }

    /**
     * Runs `task` once every earlier task for `key` has settled, or has freed
     * its slot early through the `release` callback it was given.
     * @param key Bucket key to serialise on.
     * @param signal Cancellation signal honoured while queued.
     * @param path Request path, used for cancellation error context.
     * @param task Work to run while holding the slot, given an idempotent
     *   callback that frees the slot before the task settles.
     * @throws {RESTError} Of kind `"overloaded"` when a queue limit is reached.
     */
    public async run<T>(
        key: string,
        signal: AbortSignal | undefined,
        path: string,
        task: (release: () => void) => Promise<T>,
    ): Promise<T> {
        const previous = this.#queues.get(key);
        const waiting = this.#waiting.get(key) ?? 0;
        if (
            previous &&
            (this.#queued >= this.#maxQueued ||
                waiting >= this.#maxQueuedPerBucket)
        )
            throw new RESTError(
                "The REST request queue is full; request not sent.",
                0,
                undefined,
                undefined,
                { path, kind: "overloaded" },
            );
        let open!: () => void;
        const gate = new Promise<void>((resolve) => {
            open = resolve;
        });
        this.#queues.set(key, gate);
        let released = false;
        let started = false;
        const release = (): void => {
            if (released) return;
            released = true;
            // Aborted while waiting: the request ahead may still be running, so
            // the next one waits for it too instead of starting alongside it.
            if (!started && previous) previous.then(open, open);
            else open();
            // Drop our entry so idle buckets do not accumulate, but only if it
            // is still ours: a later request may already have replaced it.
            if (this.#queues.get(key) === gate) this.#queues.delete(key);
        };
        try {
            if (previous) {
                this.#queued++;
                this.#waiting.set(key, waiting + 1);
                try {
                    await abortable(previous, signal, path);
                } finally {
                    this.#queued--;
                    const left = (this.#waiting.get(key) ?? 1) - 1;
                    if (left > 0) this.#waiting.set(key, left);
                    else this.#waiting.delete(key);
                }
            } else await abortable(Promise.resolve(), signal, path);
            started = true;
            return await task(release);
        } finally {
            release();
        }
    }
}
