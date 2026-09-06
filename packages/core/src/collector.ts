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
}

/** General-purpose event collector for interactions and messages. */
export class Collector<K, V> extends EventEmitter {
    public readonly collected = new Map<K, V>();
    public readonly options: CollectorOptions<V>;
    public ended = false;
    public endReason?: string;
    public totalProcessed = 0;
    readonly #timeoutTimer?: ReturnType<typeof setTimeout>;

    public constructor(options: CollectorOptions<V> = {}) {
        super();
        this.options = options;

        if (options.time && options.time > 0) {
            this.#timeoutTimer = setTimeout(() => {
                this.stop("time");
            }, options.time);
        }
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
        this.emit("end", this.collected, reason);
        this.removeAllListeners();
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

            this.once("collect", (item: V) => {
                resolve(item);
            });

            this.once("end", (_collected, reason) => {
                reject(
                    new Error(
                        `Collector ended before item was collected: ${reason}`,
                    ),
                );
            });
        });
    }
}
