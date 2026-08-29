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
    /** Returns the last cached resource. */
    public last(): V | undefined { return this.cache.last(); }
    /** Returns all cached resources. */
    public values(): V[] { return this.cache.array(); }
    /** Returns all cached keys. */
    public keys(): K[] { return this.cache.keyArray(); }
    /** Finds the first cached resource matching a predicate. */
    public find(predicate: (value: V, key: K) => boolean): V | undefined { return this.cache.find(predicate); }
    /** Finds the key of the first matching resource. */
    public findKey(predicate: (value: V, key: K) => boolean): K | undefined { return this.cache.findKey(predicate); }
    /** Returns all resources matching a predicate. */
    public filter(predicate: (value: V, key: K) => boolean): Collection<K, V> { return this.cache.filter(predicate); }
    /** Iterates over cached resources. */
    public forEach(callback: (value: V, key: K) => unknown): this { this.cache.each(callback); return this; }
    /** Removes every cached resource matching a predicate. */
    public sweep(predicate: (value: V, key: K) => boolean): number { return this.cache.sweep(predicate); }
    /** Returns a snapshot of the manager cache. */
    public clone(): Collection<K, V> { return this.cache.clone(); }
}
