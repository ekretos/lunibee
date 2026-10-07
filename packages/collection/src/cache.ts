import { Collection } from "./index.js";

/** Cache policy for bounded resource storage. */
export interface CacheOptions {
    /** Maximum number of entries retained. */
    maxSize?: number;
    /** Time-to-live in milliseconds. Omit to disable expiration. */
    ttl?: number;
    /**
     * Accepted for compatibility and still validated. Expired entries are now
     * dropped at their deadline, so no periodic sweep is needed.
     */
    sweepInterval?: number;
}

/**
 * Bounded cache with a fixed TTL, least-recently-used eviction and explicit
 * invalidation. A thin policy layer over {@link Collection}: reads promote an
 * entry but do not extend its TTL.
 */
export class Cache<K, V> {
    readonly #entries: Collection<K, V>;

    /** Creates a cache using the supplied retention policy. */
    public constructor(options: CacheOptions = {}) {
        const maxSize = options.maxSize ?? Infinity;
        const ttl = options.ttl ?? 0;
        if ((!Number.isInteger(maxSize) && maxSize !== Infinity) || maxSize < 1)
            throw new RangeError("Cache maxSize must be a positive integer.");
        if (!Number.isFinite(ttl) || ttl < 0)
            throw new RangeError(
                "Cache ttl must be a non-negative finite number.",
            );
        if (ttl > 0) {
            const interval = options.sweepInterval ?? Math.min(ttl, 60_000);
            if (!Number.isFinite(interval) || interval < 1)
                throw new RangeError("Cache sweepInterval must be positive.");
        }
        this.#entries = new Collection<K, V>(null, {
            ttl: ttl > 0 ? ttl : undefined,
            maxSize: maxSize === Infinity ? undefined : maxSize,
            slide: false,
        });
    }

    /** Number of currently live entries. */
    public get size(): number {
        return this.#entries.size;
    }
    /** Reads a live entry and marks it most recently used. */
    public get(key: K): V | undefined {
        return this.#entries.get(key);
    }
    /** Returns whether a live entry exists. */
    public has(key: K): boolean {
        return this.#entries.has(key);
    }
    /** Stores an entry and evicts the least recently used ones when the bound is exceeded. */
    public set(key: K, value: V): this {
        this.#entries.set(key, value);
        return this;
    }
    /** Invalidates one key. */
    public delete(key: K): boolean {
        return this.#entries.delete(key);
    }
    /** Invalidates every cached resource. */
    public clear(): void {
        this.#entries.clear();
    }
    /** Invalidates every entry matching a predicate. */
    public invalidate(predicate: (value: V, key: K) => boolean): number {
        return this.#entries.sweep(predicate);
    }
    /** Removes expired entries now and returns the number removed. */
    public sweep(): number {
        return this.#entries.purge();
    }
    /** Kept for compatibility: there is no background sweeper to stop. */
    public dispose(): void {}
    /** Returns live cached values. */
    public values(): V[] {
        return [...this.#entries.values()];
    }
    /** Returns live cached entries. */
    public entries(): [K, V][] {
        return [...this.#entries.entries()];
    }
}
