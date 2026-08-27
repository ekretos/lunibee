/** A lightweight keyed collection used by Lunibee managers and caches. */
export class Collection<K, V> extends Map<K, V> {
    /** Returns the first stored value. */
    public first(): V | undefined {
        return this.values().next().value;
    }

    /** Returns the first stored key. */
    public firstKey(): K | undefined {
        return this.keys().next().value;
    }

    /** Finds the first value matching a predicate. */
    public find(predicate: (value: V, key: K, collection: this) => boolean): V | undefined {
        for (const [key, value] of this) {
            if (predicate(value, key, this)) return value;
        }
        return undefined;
    }

    /** Returns an array containing values matching a predicate. */
    public filter(predicate: (value: V, key: K, collection: this) => boolean): V[] {
        const result: V[] = [];
        for (const [key, value] of this) {
            if (predicate(value, key, this)) result.push(value);
        }
        return result;
    }

    /** Transforms every stored value into an array. */
    public map<T>(transform: (value: V, key: K, collection: this) => T): T[] {
        const result: T[] = [];
        for (const [key, value] of this) result.push(transform(value, key, this));
        return result;
    }
}
