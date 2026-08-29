import { Collection } from "@lunibee/collection";

/** A cache manager for Lunibee resources. */
export class Manager<K, V> {
    /** Cached resources. */
    public readonly cache = new Collection<K, V>();
    /** Returns a cached resource. */
    public get(id: K): V | undefined { return this.cache.get(id); }
    /** Returns whether a resource is cached. */
    public has(id: K): boolean { return this.cache.has(id); }
    /** Adds or replaces a resource in the cache. */
    public set(id: K, value: V): this { this.cache.set(id, value); return this; }
    /** Removes a resource from the cache. */
    public delete(id: K): boolean { return this.cache.delete(id); }
    /** Removes all cached resources. */
    public clear(): void { this.cache.clear(); }
    /** Number of cached resources. */
    public get size(): number { return this.cache.size; }
    /** Returns the first cached resource. */
    public first(): V | undefined { return this.cache.first(); }
    /** Returns all cached resources. */
    public values(): V[] { return this.cache.array(); }
    /** Finds the first cached resource matching a predicate. */
    public find(predicate: (value: V, key: K) => boolean): V | undefined { return this.cache.find(predicate); }
    /** Iterates cached resources. */
    public [Symbol.iterator](): IterableIterator<[K, V]> { return this.cache[Symbol.iterator](); }
}

/** REST-backed manager that keeps fetched resources synchronized with its local cache. */
export class ResourceManager<K, V> extends Manager<K, V> {
    readonly #fetch: (id: K) => Promise<V>;
    readonly #key: (value: V) => K;

    /** Creates a resource manager with a REST fetcher and key extractor. */
    public constructor(fetch: (id: K) => Promise<V>, key: (value: V) => K) {
        super();
        this.#fetch = fetch;
        this.#key = key;
    }

    /** Resolves a resource from cache, fetching it only when absent. */
    public async resolve(id: K): Promise<V> {
        const cached = this.get(id);
        if (cached !== undefined) return cached;
        return this.fetch(id);
    }

    /** Fetches a resource and stores the result in cache. */
    public async fetch(id: K): Promise<V> {
        const value = await this.#fetch(id);
        this.set(this.#key(value), value);
        return value;
    }

    /** Fetches multiple resources while preserving request order. */
    public async fetchMany(ids: Iterable<K>): Promise<V[]> {
        return Promise.all([...ids].map(id => this.fetch(id)));
    }
}
