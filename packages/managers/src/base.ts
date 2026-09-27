import { Collection } from "@lunibee/collection";

/** Generic cache manager. @typeParam K Cache key type. @typeParam V Cached value type. */
export class Manager<K, V> {
    /** Authoritative resource state. Entries never expire: see {@link Manager.set}. */ public readonly cache =
        new Collection<K, V>();
    /** Gets a cached value. @param id Cache key. @returns Cached value. */ public get(
        id: K,
    ): V | undefined {
        return this.cache.get(id);
    }
    /** Checks whether a value is cached. @param id Cache key. @returns True when cached. */ public has(
        id: K,
    ): boolean {
        return this.cache.has(id);
    }
    /** Stores a resource with `setWithoutTTL()`, so it leaves only on an explicit delete (e.g. a Gateway `*_DELETE`), never through TTL. @param id Cache key. @param value Value. @returns This manager. */ public set(
        id: K,
        value: V,
    ): this {
        this.cache.setWithoutTTL(id, value);
        return this;
    }
    /** Deletes a cached value. @param id Cache key. @returns True when deleted. */ public delete(
        id: K,
    ): boolean {
        return this.cache.delete(id);
    }
    /** Clears the cache. @returns Nothing. */ public clear(): void {
        this.cache.clear();
    }
    /** Gets cache size. @returns Number of cached values. */ public get size(): number {
        return this.cache.size;
    }
    /** Gets the first cached value. @returns First value. */ public first():
        V | undefined {
        return this.cache.first();
    }
    /** Returns cached values. @returns Array of values. */ public values(): V[] {
        return this.cache.array();
    }
    /** Finds a cached value. @param predicate Predicate. @returns Matching value. */ public find(
        predicate: (value: V, key: K) => boolean,
    ): V | undefined {
        return this.cache.find(predicate);
    }
    /** Iterates cached entries. @returns Cache iterator. */ public [Symbol.iterator](): IterableIterator<
        [K, V]
    > {
        return this.cache[Symbol.iterator]();
    }
}

/** Generic REST-backed resource manager. @typeParam K Resource key type. @typeParam V Resource type. */
export class ResourceManager<K, V> extends Manager<K, V> {
    readonly #fetcher: (id: K) => Promise<V>;
    readonly #key: (value: V) => K;

    public constructor(fetcher: (id: K) => Promise<V>, key: (value: V) => K) {
        super();
        if (typeof fetcher !== "function" || typeof key !== "function")
            throw new TypeError(
                "ResourceManager requires fetcher and key functions.",
            );
        this.#fetcher = fetcher;
        this.#key = key;
    }

    public async resolve(id: K): Promise<V> {
        return this.get(id) ?? this.fetch(id);
    }

    /** In-flight fetches; `dirty` is set when the key is written or deleted meanwhile. */
    readonly #inflight = new Map<K, { promise: Promise<V>; dirty: boolean }>();

    /**
     * Fetches a resource over REST. Concurrent fetches of one key share a
     * single request. If the key is written (e.g. by a Gateway update) or
     * deleted while the request is in flight, the response is returned but
     * not cached, so it cannot overwrite fresher state or resurrect a
     * deleted resource.
     */
    public fetch(id: K): Promise<V> {
        const pending = this.#inflight.get(id);
        if (pending) return pending.promise;
        const entry = {
            promise: new Promise<V>((resolve) => resolve(this.#fetcher(id))),
            dirty: false,
        };
        this.#inflight.set(id, entry);
        entry.promise = entry.promise.then(
            (resource) => {
                this.#inflight.delete(id);
                if (!entry.dirty) super.set(id, resource);
                return entry.dirty ? (this.get(id) ?? resource) : resource;
            },
            (error: unknown) => {
                this.#inflight.delete(id);
                throw error;
            },
        );
        return entry.promise;
    }

    public override set(id: K, value: V): this {
        const pending = this.#inflight.get(id);
        if (pending) pending.dirty = true;
        return super.set(id, value);
    }

    public override delete(id: K): boolean {
        const pending = this.#inflight.get(id);
        if (pending) pending.dirty = true;
        return super.delete(id);
    }

    public async fetchMany(ids: Iterable<K>): Promise<V[]> {
        return Promise.all([...ids].map((id) => this.resolve(id)));
    }

    public upsert(resource: V): V {
        const key = this.#key(resource);
        this.set(key, resource);
        return resource;
    }

    public update(resource: V): V {
        return this.upsert(resource);
    }
}
