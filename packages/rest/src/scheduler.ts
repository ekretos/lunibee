import { abortable } from "./errors.js";

/**
 * Serialises work per rate-limit bucket.
 *
 * One request per bucket key is in flight at a time, so each request sees the
 * limit state its predecessor's response wrote. The queue slot is released on
 * every exit path — including an abort raised while still waiting — because a
 * slot that is never released wedges its bucket for the process lifetime.
 */
export class RequestScheduler {
    /** Maximum times a request may be moved to a different bucket queue. */
    public static readonly MAX_REMAPS = 2;
    readonly #queues = new Map<string, Promise<void>>();

    /** Number of bucket keys currently holding a queue slot. */
    public get size(): number {
        return this.#queues.size;
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
     * @param task Work to run while holding the slot, given the final key.
     */
    public async runResolved<T>(
        resolveKey: () => Promise<string>,
        signal: AbortSignal | undefined,
        path: string,
        task: (key: string) => Promise<T>,
    ): Promise<T> {
        let key = await resolveKey();
        // A remap can only chain as far as route key -> shared hash, so a small
        // bound is enough; the final hop runs whatever key it holds.
        for (let hop = 0; hop < RequestScheduler.MAX_REMAPS; hop++) {
            const outcome = await this.run<
                { done: true; value: T } | { done: false; key: string }
            >(key, signal, path, async () => {
                const current = await resolveKey();
                if (current !== key) return { done: false, key: current };
                return { done: true, value: await task(key) };
            });
            if (outcome.done) return outcome.value;
            key = outcome.key;
        }
        return this.run(key, signal, path, () => task(key));
    }

    /**
     * Runs `task` once every earlier task for `key` has settled.
     * @param key Bucket key to serialise on.
     * @param signal Cancellation signal honoured while queued.
     * @param path Request path, used for cancellation error context.
     * @param task Work to run while holding the slot.
     */
    public async run<T>(
        key: string,
        signal: AbortSignal | undefined,
        path: string,
        task: () => Promise<T>,
    ): Promise<T> {
        const previous = this.#queues.get(key) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.#queues.set(key, gate);
        try {
            await abortable(previous, signal, path);
            return await task();
        } finally {
            release();
            // Drop our entry so idle buckets do not accumulate, but only if it
            // is still ours: a later request may already have replaced it.
            if (this.#queues.get(key) === gate) this.#queues.delete(key);
        }
    }
}
