# @lunibee/collection

> `Collection` (a `Map` with array-style helpers) and a bounded, TTL-aware `Cache`.

```bash
bun add @lunibee/collection
```

```ts
import { Collection, Cache } from "@lunibee/collection";

const users = new Collection<string, { name: string; bot: boolean }>([
    ["1", { name: "bee", bot: false }],
    ["2", { name: "helper", bot: true }],
]);

const humans = users.filter((user) => !user.bot);
const [bots, people] = users.partition((user) => user.bot);
const byName = users.sorted((a, b) => a.name.localeCompare(b.name));
console.log(humans.size, bots.size, people.size, byName.first());

const cache = new Cache<string, string>({ maxSize: 1_000, ttl: 60_000 });
cache.set("key", "value");
cache.get("key"); // "value" until it expires or is evicted
cache.dispose(); // stop the sweeper
```

## `Collection`

`first`, `last`, `find`, `findKey`, `filter`, `map`, `flatMap`, `reduce`, `some`, `every`,
`each`, `partition`, `sweep`, `sorted` (stable, non-mutating), `union`, `intersection`,
`difference`, `hasAll`, `hasAny`, `at`, `keyAt`, `random`, `randomKey`, `clone`, `tap`,
`array`, `keyArray`, `toJSON`.

## `Cache`

Options: `maxSize` (least-recently-set entries are evicted first), `ttl` in ms, and
`sweepInterval`. The sweeper does not keep the process alive. Methods: `get`, `set`, `has`,
`delete`, `clear`, `invalidate`, `sweep`, `values`, `entries`, `dispose`.

## What's new in 0.2.0

TTL/LRU options (`new Collection(null, { ttl, maxSize, onEvict })`), `set(key, value, ttl?)`, `setWithoutTTL()` for entries that never expire, `peek()`, `purge()`, `ttlRemaining()` and `stats`. Without options a Collection behaves like a Map.

Docs: https://lunibee.js.org/reference/collection/
