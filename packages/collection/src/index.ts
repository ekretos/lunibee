/** A lightweight keyed collection compatible with common Discord.js collection patterns. */
export class Collection<K, V> extends Map<K, V> {
    /** Returns the first stored value. */
    public first(): V | undefined {
        return this.values().next().value as V | undefined;
    }

    /** Returns the first stored key. */
    public firstKey(): K | undefined {
        return this.keys().next().value as K | undefined;
    }

    /** Returns the last stored value. */
    public last(): V | undefined {
        let value: V | undefined;
        for (value of this.values()) {
            // Map iteration preserves insertion order; the final value is the last entry.
        }
        return value;
    }

    /** Returns the last stored key. */
    public lastKey(): K | undefined {
        let key: K | undefined;
        for (key of this.keys()) {
            // Map iteration preserves insertion order; the final key is the last entry.
        }
        return key;
    }

    /** Finds the first value matching a predicate. */
    public find(predicate: (value: V, key: K, collection: this) => boolean): V | undefined {
        for (const [key, value] of this) {
            if (predicate(value, key, this)) return value;
        }
        return undefined;
    }

    /** Returns all values matching a predicate. */
    public filter(predicate: (value: V, key: K, collection: this) => boolean): Collection<K, V> {
        const result = new Collection<K, V>();
        for (const [key, value] of this) {
            if (predicate(value, key, this)) result.set(key, value);
        }
        return result;
    }

    /** Transforms every stored value into an array. */
    public map<T>(transform: (value: V, key: K, collection: this) => T): T[] {
        const result: T[] = [];
        for (const [key, value] of this) result.push(transform(value, key, this));
        return result;
    }

    /** Returns whether at least one stored value satisfies a predicate. */
    public some(predicate: (value: V, key: K, collection: this) => boolean): boolean {
        for (const [key, value] of this) {
            if (predicate(value, key, this)) return true;
        }
        return false;
    }

    /** Returns whether every stored value satisfies a predicate. */
    public every(predicate: (value: V, key: K, collection: this) => boolean): boolean {
        for (const [key, value] of this) {
            if (!predicate(value, key, this)) return false;
        }
        return true;
    }

    /** Runs a callback for each stored value. */
    public each(callback: (value: V, key: K, collection: this) => unknown): this {
        for (const [key, value] of this) callback(value, key, this);
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
        return new Collection(this);
    }

    /** Returns whether the collection contains a value by identity. */
    public hasAll(...keys: K[]): boolean {
        return keys.every(key => this.has(key));
    }

    /** Removes every entry matching a predicate and returns the number removed. */
    public sweep(predicate: (value: V, key: K, collection: this) => boolean): number {
        let removed = 0;
        for (const [key, value] of this) {
            if (predicate(value, key, this)) {
                this.delete(key);
                removed += 1;
            }
        }
        return removed;
    }
}
