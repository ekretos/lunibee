import { EventEmitter } from "node:events";

export interface CollectorOptions<T> {
    /** Filter predicate to accept or reject items. */
    filter?: (item: T) => boolean | Promise<boolean>;
    /** Lifetime of the collector in milliseconds. */
    time?: number;
    /** Maximum number of elements to collect. */
    max?: number;
    /** Maximum number of processed elements. */
    maxProcessed?: number;
    /** Stop after this many milliseconds without a collected item. */
    idle?: number;
    /** Stop (reason `"abort"`) when this signal aborts. */
    signal?: AbortSignal;
}

/** General-purpose event collector for interactions and messages. */
export class Collector<K, V> extends EventEmitter {
    public readonly collected = new Map<K, V>();
    public readonly options: CollectorOptions<V>;
    public ended = false;
    public endReason?: string;
    public totalProcessed = 0;
    readonly #timeoutTimer?: ReturnType<typeof setTimeout>;
    #idleTimer?: ReturnType<typeof setTimeout>;
    readonly #onAbort = (): void => this.stop("abort");
    /** Cleanup hooks run once when the collector ends (e.g. event unsubscription). */
    readonly #cleanup: (() => void)[] = [];

    public constructor(options: CollectorOptions<V> = {}) {
        super();
        this.options = options;

        if (options.time && options.time > 0) {
            this.#timeoutTimer = setTimeout(() => {
                this.stop("time");
            }, options.time);
        }
        this.#resetIdle();
        if (options.signal?.aborted) this.stop("abort");
        else
            options.signal?.addEventListener("abort", this.#onAbort, {
                once: true,
            });
    }

    /** Registers a function to run once when the collector ends. Runs immediately if it already has. */
    public onDispose(cleanup: () => void): this {
        if (this.ended) cleanup();
        else this.#cleanup.push(cleanup);
        return this;
    }

    #resetIdle(): void {
        if (!this.options.idle || this.options.idle <= 0) return;
        if (this.#idleTimer) clearTimeout(this.#idleTimer);
        this.#idleTimer = setTimeout(
            () => this.stop("idle"),
            this.options.idle,
        );
    }

    /** Handles a candidate item for collection. */
    public async handle(key: K, item: V): Promise<boolean> {
        if (this.ended) return false;
        this.totalProcessed++;

        // `maxProcessed` counts every item the collector *sees*, so it has to be
        // evaluated whether or not the filter accepts this one — checking it only
        // on the accepted path means a collector whose filter rejects everything
        // never reaches its processed limit and runs until `time`/`stop()`.
        const reachedProcessed =
            !!this.options.maxProcessed &&
            this.totalProcessed >= this.options.maxProcessed;

        let passed = true;
        if (this.options.filter) passed = !!(await this.options.filter(item));

        // The filter may be async, so the collector can have been stopped while
        // it was pending. Anything decided before that stop is discarded rather
        // than collected (and emitted) after "end".
        if (this.ended) return false;

        if (!passed) {
            if (reachedProcessed) this.stop("processedLimit");
            return false;
        }

        this.collected.set(key, item);
        this.#resetIdle();
        this.emit("collect", item);

        if (this.options.max && this.collected.size >= this.options.max) {
            this.stop("limit");
            return true;
        }

        if (reachedProcessed) {
            this.stop("processedLimit");
            return true;
        }

        return true;
    }

    /** Stops the collector and emits the "end" event. */
    public stop(reason = "user"): void {
        if (this.ended) return;
        this.ended = true;
        this.endReason = reason;
        if (this.#timeoutTimer) clearTimeout(this.#timeoutTimer);
        if (this.#idleTimer) clearTimeout(this.#idleTimer);
        this.options.signal?.removeEventListener("abort", this.#onAbort);
        for (const cleanup of this.#cleanup.splice(0)) {
            try {
                cleanup();
            } catch {
                // A failing cleanup must not stop the others or the "end" event.
            }
        }
        this.emit("end", this.collected, reason);
        this.removeAllListeners();
    }

    /** Resolves with everything collected once the collector ends. */
    public wait(): Promise<Map<K, V>> {
        if (this.ended) return Promise.resolve(this.collected);
        return new Promise((resolve) =>
            this.once("end", (collected: Map<K, V>) => resolve(collected)),
        );
    }

    /** Yields items as they are collected until the collector ends. Items
     * collected between iterations are buffered, not dropped. */
    public async *[Symbol.asyncIterator](): AsyncGenerator<V, void, undefined> {
        const queue: V[] = [];
        let wake: (() => void) | undefined;
        const onCollect = (item: V): void => {
            queue.push(item);
            wake?.();
        };
        const onEnd = (): void => wake?.();
        if (!this.ended) {
            this.on("collect", onCollect);
            this.on("end", onEnd);
        }
        try {
            for (;;) {
                if (queue.length > 0) {
                    yield queue.shift()!;
                    continue;
                }
                if (this.ended) return;
                await new Promise<void>((resolve) => (wake = resolve));
                wake = undefined;
            }
        } finally {
            this.off("collect", onCollect);
            this.off("end", onEnd);
        }
    }

    /** Stops the collector (reason `"disposed"`); enables `using collector = ...`. */
    public [Symbol.dispose](): void {
        this.stop("disposed");
    }

    /** Returns a Promise that resolves with the next collected item or rejects on end/timeout. */
    public next(): Promise<V> {
        return new Promise<V>((resolve, reject) => {
            if (this.ended) {
                return reject(
                    new Error(
                        `Collector already ended: ${this.endReason ?? "unknown"}`,
                    ),
                );
            }

            // Each settled next() must drop its counterpart listener. Polling
            // a long-lived collector in a loop otherwise leaves one dangling
            // "end" listener per call, which grows without bound and trips the
            // EventEmitter max-listener warning.
            const onCollect = (item: V): void => {
                this.off("end", onEnd);
                resolve(item);
            };
            const onEnd = (_collected: Map<K, V>, reason: string): void => {
                this.off("collect", onCollect);
                reject(
                    new Error(
                        `Collector ended before item was collected: ${reason}`,
                    ),
                );
            };

            this.once("collect", onCollect);
            this.once("end", onEnd);
        });
    }
}
