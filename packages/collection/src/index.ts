/** Retention policy for a {@link Collection}. */
export interface CollectionOptions<K = unknown, V = unknown> {
    /** Default sliding TTL in ms for `set()`. Omit for no expiry. */
    ttl?: number;
    /** Maximum entries stored with `set()`; least-recently-used are evicted past it. `setWithoutTTL()` entries are never counted or evicted. */
    maxSize?: number;
    /** Whether a read restarts a TTL entry's window. Default `true`; with `false` an entry lapses a fixed time after it was set, and reads only mark it recently used. */
    slide?: boolean;
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

/**
 * Everything the policy knows about one key: its place in the recency list
 * and its TTL. One record serves the policy map, the recency list and the
 * expiry heap, so a write touches one extra hash entry and allocates once.
 */
type Entry<K> = {
    key: K;
    /** Neighbours in recency order; meaningful while `inLru`. */
    older: Entry<K> | undefined;
    newer: Entry<K> | undefined;
    inLru: boolean;
    /** TTL window in ms; 0 when the entry does not expire (and is not in the heap). */
    window: number;
    /** The current deadline; a read moves it later without touching the heap. */
    deadline: number;
    /** The deadline the heap ordered this record by. */
    filed: number;
};

/**
 * Everything a retention policy needs. A Collection without `ttl` or
 * `maxSize` never creates one, so plain collections cost no more than a Map.
 */
type Policy<K> = {
    /** Keys with a TTL or a recency position; `setWithoutTTL()` keys are absent. */
    entries: Map<K, Entry<K>>;
    /** Oldest and newest entries of the recency list; only `maxSize` collections use it. */
    oldest: Entry<K> | undefined;
    newest: Entry<K> | undefined;
    lruSize: number;
    /** Min-heap by `filed`. A record that is no longer its key's map value is stale and dropped lazily. */
    heap: Entry<K>[];
    timer?: ReturnType<typeof setTimeout>;
    armedFor: number;
    /** The options, kept here so a plain collection carries none of them. */
    ttl: number | undefined;
    maxSize: number | undefined;
    slide: boolean;
    /** Stored loosely typed so the callback does not make Collection invariant in K and V. */
    onEvict:
        | ((key: unknown, value: unknown, reason: EvictionReason) => void)
        | undefined;
    expired: number;
    evicted: number;
};

function newPolicy<K, V>(options: CollectionOptions<K, V> = {}): Policy<K> {
    return {
        ttl: options.ttl,
        maxSize: options.maxSize,
        slide: options.slide ?? true,
        onEvict: options.onEvict as Policy<K>["onEvict"],
        expired: 0,
        evicted: 0,
        entries: new Map(),
        oldest: undefined,
        newest: undefined,
        lruSize: 0,
        heap: [],
        armedFor: Infinity,
    };
}

/**
 * Reads a value that `has()` just confirmed, without touching a Lunibee
 * collection's TTL, recency or hit counters.
 */
function peekOf<K, V>(
    collection: ReadonlyCollection<K, V>,
    key: K,
): V | undefined {
    return collection instanceof Map
        ? (Map.prototype.get.call(collection, key) as V | undefined)
        : collection.get(key);
}

/** What `merge()` does with one entry: keep it with `value`, or drop it. */
export type Keep<V> = { keep: true; value: V } | { keep: false };

/**
 * A `Collection` seen read-only: every method that does not change it. Pass it
 * where you only read, so a function cannot add to or remove from the cache.
 */
export type ReadonlyCollection<K, V> = Omit<
    Collection<K, V>,
    | "set"
    | "setWithoutTTL"
    | "delete"
    | "clear"
    | "ensure"
    | "forEach"
    | "get"
    | "sweep"
    | "purge"
> &
    ReadonlyMap<K, V>;

/** Picks `amount` different items at random (a partial Fisher-Yates shuffle of `items`). */
function sample<T>(items: T[], amount: number): T[] {
    if (!Number.isInteger(amount) || amount < 0)
        throw new RangeError("amount must be a non-negative integer.");
    const count = Math.min(amount, items.length);
    for (let i = 0; i < count; i++) {
        const j = i + Math.floor(Math.random() * (items.length - i));
        [items[i], items[j]] = [items[j]!, items[i]!];
    }
    items.length = count;
    return items;
}

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
    /** Created with any option, or by the first `set()` with its own TTL. */
    #policy?: Policy<K>;
    #hits = 0;
    #misses = 0;

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
        if (
            options.ttl !== undefined ||
            options.maxSize !== undefined ||
            options.slide !== undefined ||
            options.onEvict !== undefined
        )
            this.#policy = newPolicy(options);
        if (entries) for (const [key, value] of entries) this.set(key, value);
    }

    /**
     * Stores an entry with the default TTL (or `ttl`), marks it most recently
     * used, and enforces `maxSize`. Turns a `setWithoutTTL()` entry back into
     * a TTL/LRU entry.
     */
    public override set(key: K, value: V, ttl?: number): this {
        assertTTL(ttl);
        const window = ttl ?? this.#policy?.ttl;
        if (window !== undefined) this.#policy ??= newPolicy();
        if (!this.#policy) return super.set(key, value);
        // A key that was not stored before has no policy entry.
        const before = super.size;
        super.set(key, value);
        this.#track(key, window, super.size !== before);
        this.#enforceCap();
        return this;
    }

    /**
     * Stores an entry that never expires: no deadline, heap record, timer or
     * LRU eviction. It leaves only through `delete`, `sweep`, `clear`, or a
     * later `set()`.
     */
    public setWithoutTTL(key: K, value: V): this {
        if (this.#policy) this.#forget(key);
        super.set(key, value);
        return this;
    }

    /** Reads a value; restarts a TTL entry's window and promotes it. */
    public override get(key: K): V | undefined {
        const policy = this.#policy;
        const entry = policy?.entries.get(key);
        const timed = entry !== undefined && entry.window !== 0;
        const now = timed ? Date.now() : 0;
        if (entry && timed && entry.deadline <= now) {
            this.#expire(entry);
            this.#misses++;
            return undefined;
        }
        const value = super.get(key);
        if (value === undefined && !super.has(key)) {
            this.#misses++;
            return undefined;
        }
        this.#hits++;
        if (entry) {
            if (timed && policy!.slide) entry.deadline = now + entry.window;
            if (entry.inLru) this.#promote(policy!, entry);
        }
        return value;
    }

    /**
     * Returns the value for `key`, or stores and returns what `factory`
     * makes. Reading counts as a `get()` (restarts the TTL, marks it recently
     * used); creating stores with `set()`, so `ttl` applies.
     * @param factory Called with the key and this collection only when the key is missing; if it throws, nothing is stored.
     * @param ttl TTL in ms for a created entry; defaults to the collection's.
     */
    public ensure(
        key: K,
        factory: (key: K, collection: this) => V,
        ttl?: number,
    ): V {
        const existing = this.get(key);
        if (existing !== undefined || super.has(key)) return existing as V;
        const created = factory(key, this);
        this.set(key, created, ttl);
        return created;
    }

    /** Reads a value without restarting its TTL or promoting it. */
    public peek(key: K): V | undefined {
        if (!this.#expireIfDue(key) && super.has(key)) {
            this.#hits++;
            return super.get(key);
        }
        this.#misses++;
        return undefined;
    }

    /** Cumulative hit, miss, expiry and eviction counters (a copy). */
    public get stats(): CollectionStats {
        return {
            hits: this.#hits,
            misses: this.#misses,
            expired: this.#policy?.expired ?? 0,
            evicted: this.#policy?.evicted ?? 0,
        };
    }

    public override has(key: K): boolean {
        return !this.#expireIfDue(key) && super.has(key);
    }

    public override delete(key: K): boolean {
        if (this.#expireIfDue(key)) return false;
        if (this.#policy) this.#forget(key);
        return super.delete(key);
    }

    public override clear(): void {
        super.clear();
        const policy = this.#policy;
        if (!policy) return;
        policy.entries.clear();
        policy.oldest = policy.newest = undefined;
        policy.lruSize = 0;
        policy.heap.length = 0;
        if (policy.timer) clearTimeout(policy.timer);
        policy.timer = undefined;
        policy.armedFor = Infinity;
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
        const entry = this.#policy?.entries.get(key);
        return entry && entry.window !== 0
            ? Math.max(0, entry.deadline - Date.now())
            : undefined;
    }

    /** Drops every lapsed TTL entry now. @returns How many were dropped. */
    public purge(): number {
        if (!this.#policy || this.#policy.heap.length === 0) return 0;
        const now = Date.now();
        let removed = 0;
        const dropped: [K, V][] = [];
        while (this.#nextDeadline() <= now) {
            const due = this.#heapPop()!;
            dropped.push([due.key, super.get(due.key)!]);
            this.#remove(due.key);
            removed++;
        }
        this.#policy!.expired += removed;
        this.#rearm();
        for (const [key, value] of dropped) this.#notify(key, value, "expired");
        return removed;
    }

    /** Drops `key` if its TTL has lapsed. @returns Whether it did. */
    #expireIfDue(key: K): boolean {
        const entry = this.#policy?.entries.get(key);
        if (!entry || entry.window === 0 || entry.deadline > Date.now())
            return false;
        this.#expire(entry);
        return true;
    }

    #expire(entry: Entry<K>): void {
        const value = super.get(entry.key)!;
        this.#remove(entry.key);
        this.#policy!.expired++;
        this.#notify(entry.key, value, "expired");
    }

    #remove(key: K): void {
        this.#forget(key);
        super.delete(key);
    }

    /** Drops a key's policy entry (recency position and TTL); its heap record goes stale. */
    #forget(key: K): void {
        const policy = this.#policy!;
        const entry = policy.entries.get(key);
        if (!entry) return;
        if (entry.inLru) this.#unlink(policy, entry);
        policy.entries.delete(key);
    }

    /**
     * Brings the key's policy entry in line with a `set()`: marks it newest
     * when `maxSize` is set, and gives it a deadline when `window` is defined.
     * Only a new entry, or a deadline that moves earlier, gets a heap record;
     * a later one is a number write and the record re-files itself when it
     * surfaces.
     */
    #track(key: K, window: number | undefined, isNew: boolean): void {
        const policy = this.#policy!;
        const lru = policy.maxSize !== undefined;
        let entry = isNew ? undefined : policy.entries.get(key);
        if (window === undefined) {
            if (entry && entry.window !== 0) {
                // It had a TTL and now has none.
                if (lru) entry = this.#replace(policy, entry, 0, 0);
                else {
                    this.#forget(key);
                    return;
                }
            }
            if (!entry && lru) {
                entry = this.#create(key, 0, 0);
                policy.entries.set(key, entry);
            }
            if (entry) this.#promote(policy, entry);
            return;
        }
        const deadline = Date.now() + window;
        if (entry && entry.window !== 0) {
            entry.deadline = deadline;
            entry.window = window;
            if (deadline < entry.filed)
                // The heap cannot move a record up, and this one is in it: file a fresh one.
                entry = this.#replace(policy, entry, window, deadline);
            else {
                if (entry.inLru) this.#promote(policy, entry);
                return;
            }
        } else if (entry) {
            entry.window = window;
            entry.deadline = entry.filed = deadline;
        } else {
            entry = this.#create(key, window, deadline);
            policy.entries.set(key, entry);
        }
        if (lru) this.#promote(policy, entry);
        this.#heapPush(entry);
        if (policy.heap.length > 2 * policy.entries.size + 8) this.#compact();
        // A timer already armed for an earlier deadline stays correct.
        if (policy.timer === undefined || deadline < policy.armedFor)
            this.#rearm();
    }

    #create(key: K, window: number, deadline: number): Entry<K> {
        return {
            key,
            older: undefined,
            newer: undefined,
            inLru: false,
            window,
            deadline,
            filed: deadline,
        };
    }

    /** Swaps in a fresh record for `old` (which goes stale), keeping its recency position. */
    #replace(
        policy: Policy<K>,
        old: Entry<K>,
        window: number,
        deadline: number,
    ): Entry<K> {
        const entry: Entry<K> = { ...old, window, deadline, filed: deadline };
        if (old.inLru) {
            if (old.older) old.older.newer = entry;
            else policy.oldest = entry;
            if (old.newer) old.newer.older = entry;
            else policy.newest = entry;
        }
        policy.entries.set(old.key, entry);
        return entry;
    }

    /** Makes an entry the newest in recency order, linking it first if needed. */
    #promote(policy: Policy<K>, entry: Entry<K>): void {
        if (entry === policy.newest) return;
        if (entry.inLru) this.#unlink(policy, entry, true);
        else {
            entry.inLru = true;
            policy.lruSize++;
        }
        entry.older = policy.newest;
        entry.newer = undefined;
        if (policy.newest) policy.newest.newer = entry;
        else policy.oldest = entry;
        policy.newest = entry;
    }

    /** Takes an entry out of the recency list; `keepCount` is for a move within it. */
    #unlink(policy: Policy<K>, entry: Entry<K>, keepCount = false): void {
        if (entry.older) entry.older.newer = entry.newer;
        else policy.oldest = entry.newer;
        if (entry.newer) entry.newer.older = entry.older;
        else policy.newest = entry.older;
        entry.older = entry.newer = undefined;
        if (!keepCount) {
            entry.inLru = false;
            policy.lruSize--;
        }
    }

    /**
     * An empty collection of the species this one derives, so `filter()` and
     * friends on a subclass return the subclass. It is built without
     * arguments and carries no `ttl` or `maxSize`.
     */
    #derived(): this {
        const Species =
            (
                this.constructor as {
                    [Symbol.species]?: new () => Collection<K, V>;
                }
            )[Symbol.species] ?? Collection;
        return new Species() as this;
    }

    #notify(key: K, value: V, reason: EvictionReason): void {
        const onEvict = this.#policy?.onEvict;
        if (!onEvict) return;
        try {
            onEvict(key, value, reason);
        } catch {
            // A throwing callback must not leave the collection inconsistent.
        }
    }

    /** Evicts least-recently-used `set()` entries past `maxSize`; O(1) per eviction. */
    #enforceCap(): void {
        const policy = this.#policy!;
        const max = policy.maxSize;
        if (max === undefined) return;
        // Lapsed entries must not push live ones out.
        if (
            policy.lruSize > max &&
            policy.heap.length > 0 &&
            policy.heap[0]!.filed <= Date.now()
        )
            this.purge();
        while (policy.lruSize > max) {
            const oldest = policy.oldest!;
            const value = policy.onEvict ? super.get(oldest.key) : undefined;
            this.#unlink(policy, oldest);
            policy.entries.delete(oldest.key);
            super.delete(oldest.key);
            policy.evicted++;
            this.#notify(oldest.key, value as V, "evicted");
        }
    }

    #nextDeadline(): number {
        const policy = this.#policy!;
        for (;;) {
            const top = policy.heap[0];
            if (top === undefined) return Infinity;
            if (policy.entries.get(top.key) !== top) {
                this.#heapPop();
                continue;
            }
            if (top.deadline === top.filed) return top.filed;
            // Extended since it was filed: re-file for its current deadline.
            this.#heapPop();
            top.filed = top.deadline;
            this.#heapPush(top);
        }
    }

    #compact(): void {
        const policy = this.#policy!;
        const live = policy.heap.filter(
            (entry) => policy.entries.get(entry.key) === entry,
        );
        policy.heap.length = 0;
        for (const entry of live) this.#heapPush(entry);
    }

    #rearm(): void {
        const p = this.#policy!;
        const deadline = this.#nextDeadline();
        if (p.timer !== undefined && deadline >= p.armedFor) return;
        if (p.timer) clearTimeout(p.timer);
        p.timer = undefined;
        p.armedFor = deadline;
        if (deadline === Infinity) return;
        p.timer = setTimeout(
            () => {
                p.timer = undefined;
                p.armedFor = Infinity;
                this.purge();
            },
            Math.max(0, deadline - Date.now()),
        );
        // Pending expiry is housekeeping, not a reason to keep the process alive.
        (p.timer as { unref?: () => void }).unref?.();
    }

    #heapPush(entry: Entry<K>): void {
        const heap = this.#policy!.heap;
        let i = heap.length;
        heap.push(entry);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            const above = heap[parent]!;
            if (above.filed <= entry.filed) break;
            heap[i] = above;
            i = parent;
        }
        heap[i] = entry;
    }

    #heapPop(): Entry<K> | undefined {
        const heap = this.#policy!.heap;
        const top = heap[0];
        const last = heap.pop();
        if (top === undefined || heap.length === 0) return top;
        let i = 0;
        for (;;) {
            let child = 2 * i + 1;
            if (child >= heap.length) break;
            if (
                child + 1 < heap.length &&
                heap[child + 1]!.filed < heap[child]!.filed
            )
                child++;
            if (heap[child]!.filed >= last!.filed) break;
            heap[i] = heap[child]!;
            i = child;
        }
        heap[i] = last!;
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
    /** Finds the last value (in insertion order) matching a predicate. */
    public findLast(
        predicate: (value: V, key: K, collection: this) => boolean,
    ): V | undefined {
        const entries = [...this];
        for (let i = entries.length - 1; i >= 0; i--) {
            const [key, value] = entries[i]!;
            if (predicate(value, key, this)) return value;
        }
        return undefined;
    }
    /** Finds the key of the last entry (in insertion order) matching a predicate. */
    public findLastKey(
        predicate: (value: V, key: K, collection: this) => boolean,
    ): K | undefined {
        const entries = [...this];
        for (let i = entries.length - 1; i >= 0; i--) {
            const [key, value] = entries[i]!;
            if (predicate(value, key, this)) return key;
        }
        return undefined;
    }
    /** Returns all values matching a predicate. */
    public filter(
        predicate: (value: V, key: K, collection: this) => boolean,
    ): this {
        const result = this.#derived();
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
    public clone(): this {
        const copy = this.#derived();
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
    public union(other: ReadonlyCollection<K, V>): this {
        const result = this.clone();
        for (const [key, value] of other) result.set(key, value);
        return result;
    }
    /** Returns a new Collection containing only elements present in both collections. */
    public intersection(other: ReadonlyCollection<K, V>): this {
        const result = this.#derived();
        for (const [key, value] of this) {
            if (other.has(key)) result.set(key, value);
        }
        return result;
    }
    /** Returns a new Collection containing elements present in this collection but not the other. */
    public difference(other: ReadonlyCollection<K, V>): this {
        const result = this.#derived();
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
    ): [this, this] {
        const pass = this.#derived();
        const fail = this.#derived();
        for (const [key, value] of this) {
            if (predicate(value, key, this)) pass.set(key, value);
            else fail.set(key, value);
        }
        return [pass, fail];
    }
    /** Returns the entries of both collections that are in only one of them. */
    public symmetricDifference(other: ReadonlyCollection<K, V>): this {
        const result = this.#derived();
        for (const [key, value] of this)
            if (!other.has(key)) result.set(key, value);
        for (const [key, value] of other)
            if (!this.has(key)) result.set(key, value);
        return result;
    }
    /** Returns a new Collection with this one's entries followed by each of `collections`'; a later collection wins a shared key. */
    public concat(...collections: ReadonlyCollection<K, V>[]): this {
        const result = this.clone();
        for (const collection of collections)
            for (const [key, value] of collection) result.set(key, value);
        return result;
    }
    /**
     * Combines this collection with `other`, deciding per key what to keep.
     * @param whenInSelf Called for a key only in this collection.
     * @param whenInOther Called for a key only in `other`.
     * @param whenInBoth Called for a key in both.
     * @returns A new collection of the entries the callbacks kept, in this collection's order, then `other`'s new keys.
     */
    public merge<T, R>(
        other: ReadonlyCollection<K, T>,
        whenInSelf: (value: V, key: K) => Keep<R>,
        whenInOther: (valueOther: T, key: K) => Keep<R>,
        whenInBoth: (value: V, valueOther: T, key: K) => Keep<R>,
    ): Collection<K, R> {
        const result = this.#derived() as unknown as Collection<K, R>;
        const decide = (key: K, kept: Keep<R>): void => {
            if (kept.keep) result.set(key, kept.value);
        };
        for (const [key, value] of this) {
            decide(
                key,
                other.has(key)
                    ? whenInBoth(value, peekOf(other, key) as T, key)
                    : whenInSelf(value, key),
            );
        }
        for (const [key, value] of other)
            if (!this.has(key)) decide(key, whenInOther(value, key));
        return result;
    }
    /** Returns whether `other` holds the same keys with `===` equal values. Neither side's TTL or recency is touched. */
    public equals(other: ReadonlyCollection<K, V> | null | undefined): boolean {
        if (!other) return false;
        if (other === (this as unknown)) return true;
        if (this.size !== other.size) return false;
        for (const [key, value] of this) {
            if (!other.has(key)) return false;
            if (value !== peekOf(other, key)) return false;
        }
        return true;
    }
    /** Returns a new collection with the same keys and each value passed through `transform`. */
    public mapValues<T>(
        transform: (value: V, key: K, collection: this) => T,
    ): Collection<K, T> {
        const result = this.#derived() as unknown as Collection<K, T>;
        for (const [key, value] of this)
            result.set(key, transform(value, key, this));
        return result;
    }
    /** Returns a new collection with the entries in reverse order. */
    public toReversed(): this {
        const result = this.#derived();
        const entries = [...this];
        for (let i = entries.length - 1; i >= 0; i--)
            result.set(entries[i]![0], entries[i]![1]);
        return result;
    }
    /** Same as {@link sorted}, under the name the standard `Array` uses. */
    public toSorted(
        comparator?: (a: V, b: V, aKey: K, bKey: K) => number,
    ): this {
        return this.sorted(comparator);
    }
    /**
     * Groups `items` by the key `keySelector` returns for each.
     * @param keySelector Called with each item and its index.
     * @returns A new collection from each key to its items, in input order.
     */
    public static override groupBy<K, V>(
        items: Iterable<V>,
        keySelector: (item: V, index: number) => K,
    ): Collection<K, V[]> {
        const groups = new Collection<K, V[]>();
        let index = 0;
        for (const item of items)
            groups.ensure(keySelector(item, index++), () => []).push(item);
        return groups;
    }
    /**
     * Builds a collection from `entries`, merging values that share a key.
     * @param combine Called with the value stored so far, the new one and the key; its result is stored.
     */
    public static combineEntries<K, V>(
        entries: Iterable<readonly [K, V]>,
        combine: (firstValue: V, secondValue: V, key: K) => V,
    ): Collection<K, V> {
        const result = new Collection<K, V>();
        for (const [key, value] of entries)
            result.set(
                key,
                result.has(key) ? combine(result.get(key)!, value, key) : value,
            );
        return result;
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
    /** Like {@link reduce}, but from the last entry to the first. */
    public reduceRight<T>(
        fn: (accumulator: T, value: V, key: K, collection: this) => T,
        initialValue: T,
    ): T {
        const entries = [...this];
        let acc = initialValue;
        for (let i = entries.length - 1; i >= 0; i--)
            acc = fn(acc, entries[i]![1], entries[i]![0], this);
        return acc;
    }
    /** Returns a new Collection with entries sorted by comparator (non-mutating).
     * Defaults to insertion order if no comparator is provided.
     */
    public sorted(comparator?: (a: V, b: V, aKey: K, bKey: K) => number): this {
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
        const result = this.#derived();
        for (const { entry } of decorated) result.set(entry[0], entry[1]);
        return result;
    }
    /**
     * Returns a random value, or `undefined` if empty. With `amount`, returns
     * that many different values (all of them, shuffled, when `amount` is at
     * least the size).
     * Uses `Math.random()` (fast, non-cryptographic): do not use it for
     * security-sensitive selection such as tokens or secrets.
     * @param amount How many values to pick.
     * @throws {RangeError} If `amount` is not a non-negative integer.
     */
    public random(): V | undefined;
    public random(amount: number): V[];
    public random(amount?: number): V | V[] | undefined {
        if (amount !== undefined) return sample([...this.values()], amount);
        const size = this.size;
        if (size === 0) return undefined;
        let index = Math.floor(Math.random() * size);
        for (const value of this.values()) if (index-- === 0) return value;
        return undefined;
    }
    /**
     * Returns a random key, or `undefined` if empty. With `amount`, returns
     * that many different keys. Same randomness and errors as {@link random}.
     * @param amount How many keys to pick.
     */
    public randomKey(): K | undefined;
    public randomKey(amount: number): K[];
    public randomKey(amount?: number): K | K[] | undefined {
        if (amount !== undefined) return sample([...this.keys()], amount);
        const size = this.size;
        if (size === 0) return undefined;
        let index = Math.floor(Math.random() * size);
        for (const key of this.keys()) if (index-- === 0) return key;
        return undefined;
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
