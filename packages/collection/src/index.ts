type RecencyNode<K> = {
    key: K;
    older?: RecencyNode<K>;
    newer?: RecencyNode<K>;
};

/**
 * Keys in recency order with O(1) touch, promote, delete and oldest. A Set
 * cannot do this: repeatedly removing its first key leaves tombstones that
 * every new iterator scans past.
 */
class RecencyList<K> {
    readonly #nodes = new Map<K, RecencyNode<K>>();
    #oldest?: RecencyNode<K>;
    #newest?: RecencyNode<K>;

    public get size(): number {
        return this.#nodes.size;
    }

    public oldest(): K | undefined {
        return this.#oldest?.key;
    }

    /** Adds the key as newest, or moves it there. */
    public touch(key: K): void {
        const node = this.#nodes.get(key);
        if (node) return this.#moveNewest(node);
        const created: RecencyNode<K> = { key, older: this.#newest };
        if (this.#newest) this.#newest.newer = created;
        else this.#oldest = created;
        this.#newest = created;
        this.#nodes.set(key, created);
    }

    /** Moves an existing key to newest; ignores unknown keys. */
    public promote(key: K): void {
        const node = this.#nodes.get(key);
        if (node) this.#moveNewest(node);
    }

    public delete(key: K): boolean {
        const node = this.#nodes.get(key);
        if (!node) return false;
        this.#unlink(node);
        this.#nodes.delete(key);
        return true;
    }

    public clear(): void {
        this.#nodes.clear();
        this.#oldest = this.#newest = undefined;
    }

    #unlink(node: RecencyNode<K>): void {
        if (node.older) node.older.newer = node.newer;
        else this.#oldest = node.newer;
        if (node.newer) node.newer.older = node.older;
        else this.#newest = node.older;
        node.older = node.newer = undefined;
    }

    #moveNewest(node: RecencyNode<K>): void {
        if (node === this.#newest) return;
        this.#unlink(node);
        node.older = this.#newest;
        if (this.#newest) this.#newest.newer = node;
        else this.#oldest = node;
        this.#newest = node;
    }
}

/** Retention policy for a {@link Collection}. */
export interface CollectionOptions<K = unknown, V = unknown> {
    /** Default sliding TTL in ms for `set()`. Omit for no expiry. */
    ttl?: number;
    /** Maximum entries stored with `set()`; least-recently-used are evicted past it. `setWithoutTTL()` entries are never counted or evicted. */
    maxSize?: number;
    /** Called after an entry is removed automatically, with why. Exceptions are swallowed. */
    onEvict?: (key: K, value: V, reason: EvictionReason) => void;
}

/** Why an entry was removed automatically. */
export type EvictionReason = "expired" | "evicted";

/** Cumulative counters from {@link Collection.stats}. */
export interface CollectionStats {
    /** `get`/`peek` calls that found a value. */
    hits: number;
    /** `get`/`peek` calls that found nothing. */
    misses: number;
    /** Entries removed because their TTL lapsed. */
    expired: number;
    /** Entries removed to stay within `maxSize`. */
    evicted: number;
}

type Expiry = { deadline: number; window: number; filed: number };

function assertTTL(ttl: number | undefined): void {
    if (ttl !== undefined && (!Number.isFinite(ttl) || ttl <= 0))
        throw new RangeError("TTL must be a positive number, or omitted.");
}

/**
 * A keyed collection for Lunibee resource and application state.
 *
 * - `set(key, value, ttl?)` is TTL/LRU-aware: with a TTL (the default from
 *   options, or per call) the entry expires after that window of inactivity,
 *   and with `maxSize` it counts toward the cap.
 * - `setWithoutTTL(key, value)` never expires: no deadline, no heap record,
 *   no timer, and exempt from `maxSize` eviction. Resource managers store
 *   Discord state this way, so it leaves only through an explicit delete.
 *
 * Without options, a Collection behaves like a plain Map.
 */
export class Collection<K, V> extends Map<K, V> {
    readonly #ttl?: number;
    readonly #maxSize?: number;
    /** Stored loosely typed so the callback does not make Collection invariant in K and V. */
    readonly #onEvict?: (
        key: unknown,
        value: unknown,
        reason: EvictionReason,
    ) => void;
    /** Deadlines of TTL entries only. */
    readonly #expiry = new Map<K, Expiry>();
    /** `set()` keys in recency order (oldest first), tracked only when `maxSize` is set; `setWithoutTTL()` keys are never here. */
    readonly #lru = new RecencyList<K>();
    readonly #stats: CollectionStats = {
        hits: 0,
        misses: 0,
        expired: 0,
        evicted: 0,
    };
    /** Min-heap of filed deadlines; stale records are dropped lazily. */
    readonly #heap: { key: K; deadline: number }[] = [];
    #timer?: ReturnType<typeof setTimeout>;
    #armedFor = Infinity;

    /**
     * @param entries Initial entries, stored with `set()`.
     * @param options TTL and size policy.
     * @throws {RangeError} On a non-positive TTL or non-integer `maxSize`.
     */
    public constructor(
        entries?: Iterable<readonly [K, V]> | null,
        options: CollectionOptions<K, V> = {},
    ) {
        super();
        assertTTL(options.ttl);
        if (
            options.maxSize !== undefined &&
            (!Number.isInteger(options.maxSize) || options.maxSize <= 0)
        )
            throw new RangeError("maxSize must be a positive integer.");
        this.#ttl = options.ttl;
        this.#maxSize = options.maxSize;
        this.#onEvict = options.onEvict as
            | ((key: unknown, value: unknown, reason: EvictionReason) => void)
            | undefined;
        if (entries) for (const [key, value] of entries) this.set(key, value);
    }

    /**
     * Stores an entry with the default TTL (or `ttl`), marks it most recently
     * used, and enforces `maxSize`. Turns a `setWithoutTTL()` entry back into
     * a TTL/LRU entry.
     */
    public override set(key: K, value: V, ttl?: number): this {
        assertTTL(ttl);
        const window = ttl ?? this.#ttl;
        if (this.#maxSize !== undefined) {
            this.#lru.touch(key);
        }
        super.set(key, value);
        if (window !== undefined) this.#schedule(key, window);
        else if (this.#expiry.size > 0) this.#expiry.delete(key);
        this.#enforceCap();
        return this;
    }

    /**
     * Stores an entry that never expires: no deadline, heap record, timer or
     * LRU eviction. It leaves only through `delete`, `sweep`, `clear`, or a
     * later `set()`.
     */
    public setWithoutTTL(key: K, value: V): this {
        if (this.#expiry.size > 0) this.#expiry.delete(key);
        if (this.#lru.size > 0) this.#lru.delete(key);
        super.set(key, value);
        return this;
    }

    /** Reads a value; restarts a TTL entry's window and promotes it. */
    public override get(key: K): V | undefined {
        if (this.#expireIfDue(key)) {
            this.#stats.misses++;
            return undefined;
        }
        const value = super.get(key);
        if (value === undefined && !super.has(key)) {
            this.#stats.misses++;
            return undefined;
        }
        this.#stats.hits++;
        const expiry = this.#expiry.get(key);
        if (expiry) expiry.deadline = Date.now() + expiry.window;
        this.#lru.promote(key);
        return value;
    }

    /** Reads a value without restarting its TTL or promoting it. */
    public peek(key: K): V | undefined {
        if (!this.#expireIfDue(key) && super.has(key)) {
            this.#stats.hits++;
            return super.get(key);
        }
        this.#stats.misses++;
        return undefined;
    }

    /** Cumulative hit, miss, expiry and eviction counters (a copy). */
    public get stats(): CollectionStats {
        return { ...this.#stats };
    }

    public override has(key: K): boolean {
        return !this.#expireIfDue(key) && super.has(key);
    }

    public override delete(key: K): boolean {
        if (this.#expireIfDue(key)) return false;
        this.#expiry.delete(key);
        this.#lru.delete(key);
        return super.delete(key);
    }

    public override clear(): void {
        super.clear();
        this.#expiry.clear();
        this.#lru.clear();
        this.#heap.length = 0;
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#armedFor = Infinity;
    }

    public override get size(): number {
        this.purge();
        return super.size;
    }

    public override entries(): MapIterator<[K, V]> {
        this.purge();
        return super.entries();
    }

    public override keys(): MapIterator<K> {
        this.purge();
        return super.keys();
    }

    public override values(): MapIterator<V> {
        this.purge();
        return super.values();
    }

    public override [Symbol.iterator](): MapIterator<[K, V]> {
        return this.entries();
    }

    public override forEach(
        callback: (value: V, key: K, map: Map<K, V>) => void,
        thisArg?: unknown,
    ): void {
        this.purge();
        super.forEach(callback, thisArg);
    }

    /** Milliseconds until a key lapses, or undefined if absent or never expiring. */
    public ttlRemaining(key: K): number | undefined {
        if (this.#expireIfDue(key)) return undefined;
        const expiry = this.#expiry.get(key);
        return expiry && Math.max(0, expiry.deadline - Date.now());
    }

    /** Drops every lapsed TTL entry now. @returns How many were dropped. */
    public purge(): number {
        if (this.#expiry.size === 0) return 0;
        const now = Date.now();
        let removed = 0;
        const dropped: [K, V][] = [];
        while (this.#nextDeadline() <= now) {
            const due = this.#heapPop()!;
            dropped.push([due.key, super.get(due.key)!]);
            this.#remove(due.key);
            removed++;
        }
        this.#stats.expired += removed;
        this.#rearm();
        for (const [key, value] of dropped) this.#notify(key, value, "expired");
        return removed;
    }

    #expireIfDue(key: K): boolean {
        const expiry = this.#expiry.get(key);
        if (!expiry || expiry.deadline > Date.now()) return false;
        const value = super.get(key)!;
        this.#remove(key);
        this.#stats.expired++;
        this.#notify(key, value, "expired");
        return true;
    }

    #remove(key: K): void {
        this.#expiry.delete(key);
        this.#lru.delete(key);
        super.delete(key);
    }

    #notify(key: K, value: V, reason: EvictionReason): void {
        if (!this.#onEvict) return;
        try {
            this.#onEvict(key, value, reason);
        } catch {
            // A throwing callback must not leave the collection inconsistent.
        }
    }

    /** Evicts least-recently-used `set()` entries past `maxSize`; O(1) per eviction. */
    #enforceCap(): void {
        if (this.#maxSize === undefined) return;
        while (this.#lru.size > this.#maxSize) {
            const oldest = this.#lru.oldest()!;
            const value = super.get(oldest)!;
            this.#remove(oldest);
            this.#stats.evicted++;
            this.#notify(oldest, value, "evicted");
        }
    }

    /**
     * Gives an entry a deadline. Extending one writes a number; the stale
     * heap record re-files itself when it surfaces. Only a deadline that
     * moves earlier (or a new one) is pushed.
     */
    #schedule(key: K, window: number): void {
        const deadline = Date.now() + window;
        const expiry = this.#expiry.get(key);
        if (expiry) {
            expiry.deadline = deadline;
            expiry.window = window;
            if (deadline >= expiry.filed) return;
            expiry.filed = deadline;
        } else this.#expiry.set(key, { deadline, window, filed: deadline });
        this.#heapPush({ key, deadline });
        if (this.#heap.length > 2 * this.#expiry.size + 8) this.#compact();
        this.#rearm();
    }

    #nextDeadline(): number {
        for (;;) {
            const top = this.#heap[0];
            if (top === undefined) return Infinity;
            const expiry = this.#expiry.get(top.key);
            if (!expiry || expiry.filed !== top.deadline) {
                this.#heapPop();
                continue;
            }
            if (expiry.deadline === top.deadline) return top.deadline;
            // Extended since it was filed: re-file for its current deadline.
            this.#heapPop();
            expiry.filed = expiry.deadline;
            this.#heapPush({ key: top.key, deadline: expiry.deadline });
        }
    }

    #compact(): void {
        const live = this.#heap.filter(
            (record) => this.#expiry.get(record.key)?.filed === record.deadline,
        );
        this.#heap.length = 0;
        for (const record of live) this.#heapPush(record);
    }

    #rearm(): void {
        const deadline = this.#nextDeadline();
        if (this.#timer !== undefined && deadline >= this.#armedFor) return;
        if (this.#timer) clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#armedFor = deadline;
        if (deadline === Infinity) return;
        this.#timer = setTimeout(
            () => {
                this.#timer = undefined;
                this.#armedFor = Infinity;
                this.purge();
            },
            Math.max(0, deadline - Date.now()),
        );
        // Pending expiry is housekeeping, not a reason to keep the process alive.
        (this.#timer as { unref?: () => void }).unref?.();
    }

    #heapPush(record: { key: K; deadline: number }): void {
        const heap = this.#heap;
        heap.push(record);
        let i = heap.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heap[parent]!.deadline <= heap[i]!.deadline) break;
            [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
            i = parent;
        }
    }

    #heapPop(): { key: K; deadline: number } | undefined {
        const heap = this.#heap;
        const top = heap[0];
        const last = heap.pop();
        if (top === undefined || heap.length === 0) return top;
        heap[0] = last!;
        for (let i = 0; ;) {
            const left = 2 * i + 1;
            const right = left + 1;
            let smallest = i;
            if (
                left < heap.length &&
                heap[left]!.deadline < heap[smallest]!.deadline
            )
                smallest = left;
            if (
                right < heap.length &&
                heap[right]!.deadline < heap[smallest]!.deadline
            )
                smallest = right;
            if (smallest === i) break;
            [heap[smallest], heap[i]] = [heap[i]!, heap[smallest]!];
            i = smallest;
        }
        return top;
    }

    /** Returns the first stored value. */
    public first(): V | undefined {
        for (const value of this.values()) return value;
        return undefined;
    }
    /** Returns the first stored key. */
    public firstKey(): K | undefined {
        for (const key of this.keys()) return key;
        return undefined;
    }
    /** Returns the last stored value. */
    public last(): V | undefined {
        let value: V | undefined;
        for (const item of this.values()) value = item;
        return value;
    }
    /** Returns the last stored key. */
    public lastKey(): K | undefined {
        let key: K | undefined;
        for (const item of this.keys()) key = item;
        return key;
    }
    /** Finds the first value matching a predicate. */
    public find(
        predicate: (value: V, key: K, collection: this) => boolean,
    ): V | undefined {
        for (const [key, value] of this) {
            if (predicate(value, key, this)) return value;
        }
        return undefined;
    }
    /** Returns all values matching a predicate. */
    public filter(
        predicate: (value: V, key: K, collection: this) => boolean,
    ): Collection<K, V> {
        const result = new Collection<K, V>();
        for (const [key, value] of this) {
            if (predicate(value, key, this)) result.set(key, value);
        }
        return result;
    }
    /** Transforms every stored value into an array. */
    public map<T>(transform: (value: V, key: K, collection: this) => T): T[] {
        const result: T[] = [];
        for (const [key, value] of this) {
            result.push(transform(value, key, this));
        }
        return result;
    }
    /** Returns whether at least one stored value satisfies a predicate. */
    public some(
        predicate: (value: V, key: K, collection: this) => boolean,
    ): boolean {
        for (const [key, value] of this) {
            if (predicate(value, key, this)) return true;
        }
        return false;
    }
    /** Returns whether every stored value satisfies a predicate. */
    public every(
        predicate: (value: V, key: K, collection: this) => boolean,
    ): boolean {
        for (const [key, value] of this) {
            if (!predicate(value, key, this)) return false;
        }
        return true;
    }
    /** Runs a callback for each stored value. */
    public each(
        callback: (value: V, key: K, collection: this) => unknown,
    ): this {
        for (const [key, value] of this) {
            callback(value, key, this);
        }
        return this;
    }
    /** Returns an array containing all stored values. */
    public array(): V[] {
        return [...this.values()];
    }
    /** Returns an array containing all stored keys. */
    public keyArray(): K[] {
        return [...this.keys()];
    }
    /** Returns a plain array of entries. */
    public entriesArray(): [K, V][] {
        return [...this.entries()];
    }
    /** Returns a new collection with the same entries. */
    public clone(): Collection<K, V> {
        const copy = new Collection<K, V>();
        for (const [key, value] of this) copy.set(key, value);
        return copy;
    }
    /** Returns whether all supplied keys are present. */
    public hasAll(...keys: K[]): boolean {
        for (let i = 0; i < keys.length; i++) {
            if (!this.has(keys[i]!)) return false;
        }
        return true;
    }
    /** Returns whether at least one supplied key is present. */
    public hasAny(...keys: K[]): boolean {
        for (let i = 0; i < keys.length; i++) {
            if (this.has(keys[i]!)) return true;
        }
        return false;
    }
    /** Returns the first key whose value matches a predicate. */
    public findKey(
        predicate: (value: V, key: K, collection: this) => boolean,
    ): K | undefined {
        for (const [key, value] of this) {
            if (predicate(value, key, this)) return key;
        }
        return undefined;
    }
    /** Returns whether a predicate matches at least one entry. */
    public someEntry(
        predicate: (value: V, key: K, collection: this) => boolean,
    ): boolean {
        return this.some(predicate);
    }
    /** Removes every entry matching a predicate and returns the number removed. */
    public sweep(
        predicate: (value: V, key: K, collection: this) => boolean,
    ): number {
        let removed = 0;
        for (const [key, value] of this) {
            if (predicate(value, key, this) && this.delete(key)) removed++;
        }
        return removed;
    }
    /** Returns the collection's first matching entry as a tuple. */
    public firstEntry(): [K, V] | undefined {
        for (const [key, value] of this) return [key, value];
        return undefined;
    }
    /** Returns the collection's last matching entry as a tuple. */
    public lastEntry(): [K, V] | undefined {
        let entry: [K, V] | undefined;
        for (const item of this) entry = [item[0], item[1]];
        return entry;
    }
    /** Returns a new Collection containing elements from both collections. */
    public union(other: Collection<K, V>): Collection<K, V> {
        const result = this.clone();
        for (const [key, value] of other) result.set(key, value);
        return result;
    }
    /** Returns a new Collection containing only elements present in both collections. */
    public intersection(other: Collection<K, V>): Collection<K, V> {
        const result = new Collection<K, V>();
        for (const [key, value] of this) {
            if (other.has(key)) result.set(key, value);
        }
        return result;
    }
    /** Returns a new Collection containing elements present in this collection but not the other. */
    public difference(other: Collection<K, V>): Collection<K, V> {
        const result = new Collection<K, V>();
        for (const [key, value] of this) {
            if (!other.has(key)) result.set(key, value);
        }
        return result;
    }
    /** Splits the collection into two collections based on a predicate.
     * @returns `[passing, failing]` — entries satisfying the predicate, then those that don't.
     */
    public partition(
        predicate: (value: V, key: K, collection: this) => boolean,
    ): [Collection<K, V>, Collection<K, V>] {
        const pass = new Collection<K, V>();
        const fail = new Collection<K, V>();
        for (const [key, value] of this) {
            if (predicate(value, key, this)) pass.set(key, value);
            else fail.set(key, value);
        }
        return [pass, fail];
    }
    /** Calls `fn` with this collection and returns the collection unchanged.
     * Useful for inserting debug side-effects in a chain without breaking the flow.
     */
    public tap(fn: (collection: this) => unknown): this {
        fn(this);
        return this;
    }
    /** Maps every entry to an array of items and flattens the results. */
    public flatMap<T>(
        transform: (value: V, key: K, collection: this) => T[],
    ): T[] {
        const result: T[] = [];
        for (const [key, value] of this) {
            for (const item of transform(value, key, this)) result.push(item);
        }
        return result;
    }
    /** Reduces the collection to a single value. */
    public reduce<T>(
        fn: (accumulator: T, value: V, key: K, collection: this) => T,
        initialValue: T,
    ): T {
        let acc = initialValue;
        for (const [key, value] of this) acc = fn(acc, value, key, this);
        return acc;
    }
    /** Returns a new Collection with entries sorted by comparator (non-mutating).
     * Defaults to insertion order if no comparator is provided.
     */
    public sorted(
        comparator?: (a: V, b: V, aKey: K, bKey: K) => number,
    ): Collection<K, V> {
        // Decorate with the original insertion index and use it as a tiebreaker so
        // equal elements keep their insertion order (a stable sort independent of
        // the engine's Array.prototype.sort stability guarantees).
        const decorated = [...this.entries()].map((entry, index) => ({
            entry,
            index,
        }));
        if (comparator)
            decorated.sort((x, y) => {
                const comparison = comparator(
                    x.entry[1],
                    y.entry[1],
                    x.entry[0],
                    y.entry[0],
                );
                return comparison !== 0 ? comparison : x.index - y.index;
            });
        const result = new Collection<K, V>();
        for (const { entry } of decorated) result.set(entry[0], entry[1]);
        return result;
    }
    /** Returns a random value from the collection, or `undefined` if empty.
     * Uses `Math.random()` (fast, non-cryptographic) — do not use for security-sensitive
     * selection such as tokens or secrets. */
    public random(): V | undefined {
        const arr = [...this.values()];
        if (!arr.length) return undefined;
        return arr[Math.floor(Math.random() * arr.length)];
    }
    /** Returns a random key from the collection, or `undefined` if empty.
     * Uses `Math.random()` (fast, non-cryptographic) — do not use for security-sensitive
     * selection such as tokens or secrets. */
    public randomKey(): K | undefined {
        const arr = [...this.keys()];
        if (!arr.length) return undefined;
        return arr[Math.floor(Math.random() * arr.length)];
    }
    /** Returns the value at a given insertion-order index (supports negative indices). */
    public at(index: number): V | undefined {
        const arr = [...this.values()];
        const i = index < 0 ? arr.length + index : index;
        return arr[i];
    }
    /** Returns the key at a given insertion-order index (supports negative indices). */
    public keyAt(index: number): K | undefined {
        const arr = [...this.keys()];
        const i = index < 0 ? arr.length + index : index;
        return arr[i];
    }
    /** Serializes the collection to a plain `[key, value]` array. */
    public toJSON(): [K, V][] {
        return [...this.entries()];
    }
}

export { Cache } from "./cache.js";
export type { CacheOptions } from "./cache.js";
