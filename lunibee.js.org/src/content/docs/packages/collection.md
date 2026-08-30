---
title: "@lunibee/collection"
description: High-performance in-memory Collection and bounded LRU/TTL Cache.
---

The `@lunibee/collection` package provides high-performance in-memory data structures engineered specifically for Bun and Discord bots.

## Installation

```bash
bun add @lunibee/collection
```

---

## `Collection<K, V>`

The `Collection` class extends `Map<K, V>` and provides rich array-like manipulation methods without allocating unnecessary intermediate arrays.

```ts
import { Collection } from "@lunibee/collection";

const users = new Collection<string, { id: string; username: string; bot: boolean }>();

users.set("1001", { id: "1001", username: "Alice", bot: false });
users.set("1002", { id: "1002", username: "Bob", bot: false });
users.set("1003", { id: "1003", username: "ZedBot", bot: true });
```

### Methods Reference

#### `first()` / `first(amount)`
- **Parameters**: `amount?: number`
- **Returns**: `V | V[] | undefined`
```ts
const firstUser = users.first();
const firstTwo = users.first(2);
```

#### `firstKey()` / `firstKey(amount)`
- **Returns**: `K | K[] | undefined`
```ts
const firstId = users.firstKey();
```

#### `find(predicate)`
- **Parameters**: `predicate: (value: V, key: K, collection: this) => boolean`
- **Returns**: `V | undefined`
```ts
const botUser = users.find(u => u.bot === true);
```

#### `filter(predicate)`
- **Parameters**: `predicate: (value: V, key: K, collection: this) => boolean`
- **Returns**: `Collection<K, V>`
```ts
const humans = users.filter(u => !u.bot);
```

#### `map(transform)`
- **Parameters**: `transform: (value: V, key: K, collection: this) => T`
- **Returns**: `T[]`
```ts
const usernames = users.map(u => u.username);
```

#### `sweep(predicate)`
- **Returns**: `number` (count of removed entries)
```ts
const deletedCount = users.sweep(u => u.bot);
```

---

## `Cache<K, V>`

```ts
import { Cache } from "@lunibee/collection";

const cache = new Cache<string, UserData>({
  maxSize: 5000,
  ttl: 15 * 60 * 1000,
  sweepInterval: 60_000,
});

cache.set("1001", userData);
const user = cache.get("1001");
```
