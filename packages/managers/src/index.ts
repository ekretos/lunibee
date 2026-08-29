import { Collection } from "@lunibee/collection";

/** A cache manager for Lunibee resources. */
export class Manager<K, V> {
    /** Cached resources. */
    public readonly cache = new Collection<K, V>();

    /** Returns a cached resource. */
    public get(id: K): V | undefined {
        return this.cache.get(id);
    }

    /** Returns whether a resource is cached. */
    public has(id: K): boolean {
        return this.cache.has(id);
    }

    /** Adds or replaces a resource in the cache. */
    public set(id: K, value: V): this {
        this.cache.set(id, value);
        return this;
    }

    /** Removes a resource from the cache. */
    public delete(id: K): boolean {
        return this.cache.delete(id);
    }

    /** Removes all cached resources. */
    public clear(): void {
        this.cache.clear();
    }

    /** Number of cached resources. */
    public get size(): number {
        return this.cache.size;
    }

    /** Returns the first cached resource. */
    public first(): V | undefined {
        return this.cache.first();
    }

    /** Returns all cached resources. */
    public values(): V[] {
        return this.cache.array();
    }

    /** Finds the first cached resource matching a predicate. */
    public find(predicate: (value: V, key: K) => boolean): V | undefined {
        return this.cache.find(predicate);
    }
}
