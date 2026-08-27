import { Collection } from "@lunibee/collection";

/** A base manager for Discord resources. */
export abstract class Manager<K, V> {
    /** Cached resources. */
    public readonly cache = new Collection<K, V>();

    /** Gets a cached resource by ID. */
    public get(id: K): V | undefined { return this.cache.get(id); }
    /** Checks whether a resource is cached. */
    public has(id: K): boolean { return this.cache.has(id); }
    /** Removes a cached resource. */
    public delete(id: K): boolean { return this.cache.delete(id); }
    /** Returns the number of cached resources. */
    public get size(): number { return this.cache.size; }
}
