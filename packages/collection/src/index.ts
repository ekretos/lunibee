/** A lightweight keyed collection for Lunibee resource and application state. */
export class Collection<K, V> extends Map<K, V> {
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
        const entries = [...this.entries()];
        if (comparator)
            entries.sort(([aKey, a], [bKey, b]) =>
                comparator(a, b, aKey, bKey),
            );
        const result = new Collection<K, V>();
        for (const [key, value] of entries) result.set(key, value);
        return result;
    }
    /** Returns a random value from the collection, or `undefined` if empty. */
    public random(): V | undefined {
        const arr = [...this.values()];
        if (!arr.length) return undefined;
        return arr[Math.floor(Math.random() * arr.length)];
    }
    /** Returns a random key from the collection, or `undefined` if empty. */
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
