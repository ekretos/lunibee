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
    readonly #queues = new Map<string, Promise<void>>();

    /** Number of bucket keys currently holding a queue slot. */
    public get size(): number {
        return this.#queues.size;
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
