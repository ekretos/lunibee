/** One answer collected for a request. */
export interface Settled<R = unknown> {
    key: string;
    result?: R;
    error?: string;
}

/** What a finished request collected. */
export interface Collected<R = unknown> {
    /** Answers by key, in arrival order. */
    replies: Settled<R>[];
    /** Keys that never answered (timeout, abort or shutdown). */
    missing: string[];
}

interface Entry {
    keys: Map<string, number>;
    replies: Settled[];
    /** Keys that already have an answer, for constant-time checks on large broadcasts. */
    answered: Set<string>;
    finish: () => void;
    timer: ReturnType<typeof setTimeout>;
    cleanup?: () => void;
}

/**
 * Pending requests of the parent process. Each request waits for answers from
 * a set of keys (a shard, a cluster, or every shard of the live clusters) and
 * settles when all arrived, the timeout passed, or the caller aborted.
 *
 * Answers are accepted only from the owner of the key, once per key; late,
 * duplicate and unknown answers are ignored. The number of waiting requests is
 * bounded, and a timer per request guarantees the entry is removed.
 */
export class RequestTracker {
    readonly #pending = new Map<string, Entry>();
    readonly #maxPending: number;
    readonly #prefix: string;
    #counter = 0;

    public constructor(prefix = "parent", maxPending = 10_000) {
        if (!Number.isInteger(maxPending) || maxPending < 1)
            throw new RangeError("maxPending must be a positive integer.");
        this.#prefix = prefix;
        this.#maxPending = maxPending;
    }

    /** Requests waiting for answers. */
    public get size(): number {
        return this.#pending.size;
    }

    /**
     * Starts waiting for answers.
     * @param keys Each key that should answer, with the cluster that owns it.
     * @throws {Error} If `maxPending` requests are already waiting.
     */
    public begin<R>(options: {
        keys: ReadonlyMap<string, number>;
        timeoutMs: number;
        signal?: AbortSignal;
    }): { id: string; done: Promise<Collected<R>> } {
        if (this.#pending.size >= this.#maxPending)
            throw new Error(
                `Too many requests waiting for a reply (${this.#maxPending}).`,
            );
        const id = `${this.#prefix}:${++this.#counter}`;
        const done = new Promise<Collected<R>>((resolve) => {
            const finish = (): void => {
                const entry = this.#pending.get(id);
                if (!entry) return;
                this.#pending.delete(id);
                clearTimeout(entry.timer);
                entry.cleanup?.();
                resolve({
                    replies: entry.replies as Settled<R>[],
                    missing: [...entry.keys.keys()].filter(
                        (key) => !entry.answered.has(key),
                    ),
                });
            };
            const entry: Entry = {
                keys: new Map(options.keys),
                replies: [],
                answered: new Set(),
                finish,
                timer: setTimeout(finish, options.timeoutMs),
            };
            if (options.signal) {
                const signal = options.signal;
                if (signal.aborted) queueMicrotask(finish);
                else {
                    signal.addEventListener("abort", finish, { once: true });
                    entry.cleanup = () =>
                        signal.removeEventListener("abort", finish);
                }
            }
            this.#pending.set(id, entry);
            if (entry.keys.size === 0) queueMicrotask(finish);
        });
        return { id, done };
    }

    /**
     * Records one answer.
     * @param from The cluster the answer came from; it must own `key`.
     * @returns Whether the answer was accepted.
     */
    public answer(
        id: string,
        key: string,
        from: number,
        value: { result?: unknown; error?: string },
    ): boolean {
        const entry = this.#pending.get(id);
        if (!entry || entry.keys.get(key) !== from) return false;
        if (entry.answered.has(key)) return false;
        entry.answered.add(key);
        entry.replies.push({ key, ...value });
        if (entry.replies.length >= entry.keys.size) entry.finish();
        return true;
    }

    /** A cluster went away: every key it owns that has not answered settles with `error`. */
    public failOwner(owner: number, error: string): void {
        for (const entry of [...this.#pending.values()]) {
            for (const [key, keyOwner] of entry.keys)
                if (keyOwner === owner && !entry.answered.has(key)) {
                    entry.answered.add(key);
                    entry.replies.push({ key, error });
                }
            if (entry.replies.length >= entry.keys.size) entry.finish();
        }
    }

    /** Settles every waiting request with what it has (shutdown). */
    public close(): void {
        for (const entry of [...this.#pending.values()]) entry.finish();
    }
}
