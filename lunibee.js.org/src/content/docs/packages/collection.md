---
title: "@lunibee/collection"
description: Complete API reference and guide for Lunibee's high-performance Collection and bounded Cache.
---

# `@lunibee/collection`

`@lunibee/collection` provides high-performance in-memory data structures engineered specifically for Bun and Discord bots. It extends JavaScript's native `Map` with Discord.js-compatible utility methods, zero-allocation iterators, and a bounded LRU/TTL cache.

## Installation

```bash
bun add @lunibee/collection
```

---

## `Collection<K, V>`

The `Collection` class extends `Map<K, V>` and provides rich array-like manipulation methods without converting the underlying map to an array.

```ts
import { Collection } from "@lunibee/collection";

const users = new Collection<string, { id: string; username: string; bot: boolean }>();

users.set("1001", { id: "1001", username: "Alice", bot: false });
users.set("1002", { id: "1002", username: "Bob", bot: false });
users.set("1003", { id: "1003", username: "ZedBot", bot: true });
```

### Methods Reference

#### `first()` / `first(amount)`
Obtains the first value(s) stored in the collection.
- **Parameters**: `amount?: number` — The number of values to obtain.
- **Returns**: `V | V[] | undefined`
```ts
const firstUser = users.first(); // { id: "1001", username: "Alice", ... }
const firstTwo = users.first(2); // [{ id: "1001", ... }, { id: "1002", ... }]
```

#### `firstKey()` / `firstKey(amount)`
Obtains the first key(s) stored in the collection.
- **Parameters**: `amount?: number` — The number of keys to obtain.
- **Returns**: `K | K[] | undefined`
```ts
const firstId = users.firstKey(); // "1001"
const firstTwoIds = users.firstKey(2); // ["1001", "1002"]
```

#### `last()` / `last(amount)`
Obtains the last value(s) stored in the collection.
- **Parameters**: `amount?: number` — The number of values to obtain.
- **Returns**: `V | V[] | undefined`
```ts
const lastUser = users.last(); // { id: "1003", username: "ZedBot", ... }
```

#### `lastKey()` / `lastKey(amount)`
Obtains the last key(s) stored in the collection.
- **Parameters**: `amount?: number` — The number of keys to obtain.
- **Returns**: `K | K[] | undefined`
```ts
const lastId = users.lastKey(); // "1003"
```

#### `find(predicate)`
Searches for a single value where the given function returns a truthy value.
- **Parameters**: `predicate: (value: V, key: K, collection: this) => boolean`
- **Returns**: `V | undefined`
```ts
const botUser = users.find(u => u.bot === true);
```

#### `findKey(predicate)`
Searches for the key of an item where the given function returns a truthy value.
- **Parameters**: `predicate: (value: V, key: K, collection: this) => boolean`
- **Returns**: `K | undefined`
```ts
const botId = users.findKey(u => u.bot === true); // "1003"
```

#### `filter(predicate)`
Returns a new Collection containing only the entries that satisfy the predicate.
- **Parameters**: `predicate: (value: V, key: K, collection: this) => boolean`
- **Returns**: `Collection<K, V>`
```ts
const humans = users.filter(u => !u.bot);
console.log(humans.size); // 2
```

#### `map(transform)`
Maps each value into a new array.
- **Parameters**: `transform: (value: V, key: K, collection: this) => T`
- **Returns**: `T[]`
```ts
const usernames = users.map(u => u.username); // ["Alice", "Bob", "ZedBot"]
```

#### `mapValues(transform)`
Maps each value into a new Collection with transformed values and preserved keys.
- **Parameters**: `transform: (value: V, key: K, collection: this) => T`
- **Returns**: `Collection<K, T>`
```ts
const uppercaseUsers = users.mapValues(u => u.username.toUpperCase());
```

#### `some(predicate)` / `every(predicate)`
Tests whether at least one (or every) entry satisfies the predicate.
- **Returns**: `boolean`
```ts
const hasBots = users.some(u => u.bot); // true
const allBots = users.every(u => u.bot); // false
```

#### `reduce(fn, initialValue?)`
Applies a reducer function against an accumulator and each entry in the collection.
- **Parameters**: `fn: (accumulator: T, value: V, key: K, collection: this) => T, initialValue?: T`
- **Returns**: `T`
```ts
const totalBots = users.reduce((acc, u) => acc + (u.bot ? 1 : 0), 0);
```

#### `each(callback)`
Executes a function for each stored entry and returns `this` for chaining.
- **Parameters**: `callback: (value: V, key: K, collection: this) => unknown`
- **Returns**: `this`
```ts
users.each((u, id) => console.log(`User ${id}: ${u.username}`));
```

#### `partition(predicate)`
Splits the collection into two collections: `[matching, nonMatching]`.
- **Returns**: `[Collection<K, V>, Collection<K, V>]`
```ts
const [bots, humans] = users.partition(u => u.bot);
```

#### `sweep(predicate)`
Removes every entry matching the predicate and returns the total number of removed entries.
- **Returns**: `number`
```ts
const deletedCount = users.sweep(u => u.bot); // removes bots from the map
```

#### `hasAll(...keys)` / `hasAny(...keys)`
Checks if all (or any) specified keys are present in the collection.
- **Returns**: `boolean`
```ts
const hasBoth = users.hasAll("1001", "1002"); // true
const hasEither = users.hasAny("1001", "9999"); // true
```

#### `clone()`
Creates an identical copy of this collection using native C++ copy semantics.
- **Returns**: `Collection<K, V>`
```ts
const copy = users.clone();
```

#### `random()` / `randomKey()`
Returns a random value (or key) from the collection.
- **Returns**: `V | undefined` or `K | undefined`
```ts
const luckyUser = users.random();
```

---

## `Cache<K, V>`

The `Cache` class provides bounded in-memory caching with Least-Recently-Used (LRU) style eviction and Time-To-Live (TTL) expiration.

```ts
import { Cache } from "@lunibee/collection";

const userCache = new Cache<string, UserData>({
  maxSize: 5000,          // Maximum 5000 entries before oldest are evicted
  ttl: 15 * 60 * 1000,    // 15 minutes TTL
  sweepInterval: 60_000,  // Background sweep every 60 seconds
});
```

### `CacheOptions`

| Option | Type | Description |
|---|---|---|
| `maxSize` | `number` | Maximum number of items retained. Defaults to `Infinity`. |
| `ttl` | `number` | Time-to-live in milliseconds. Omit or set to `0` to disable expiration. |
| `sweepInterval` | `number` | Background timer interval in milliseconds to sweep expired entries. |

### Methods Reference

- **`get(key: K): V | undefined`**: Reads a live entry. Features zero-syscall fast path when no TTL is configured. Returns `undefined` if missing or expired.
- **`set(key: K, value: V): this`**: Stores an entry and evicts the oldest items if `maxSize` is exceeded.
- **`has(key: K): boolean`**: Checks if an active unexpired entry exists.
- **`delete(key: K): boolean`**: Removes an entry by key.
- **`clear(): void`**: Invalidates all stored entries.
- **`invalidate(predicate: (value: V, key: K) => boolean): number`**: Removes all entries matching a predicate.
- **`sweep(): number`**: Manually purges all expired entries.
- **`dispose(): void`**: Stops the background sweeping timer.
- **`values(): V[]`** & **`entries(): [K, V][]`**: Returns arrays of all active unexpired values or entries.
