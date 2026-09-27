# Lunibee architecture

Lunibee is organized around a lightweight Bun-first core.

- `packages/` contains distributable library packages.
- `tests/` contains repository-level validation.
- `examples/` contains user-facing usage examples.
- `docs/` contains project documentation.
- `benchmarks/` contains performance experiments.
- `.github/workflows/` contains repository automation.

Discord entities such as messages and interactions belong to `structures`. Transport systems such as REST and Gateway remain independent. Builders construct Discord payloads without becoming resource structures.

## Resource state vs cache

`Collection` (`@lunibee/collection`) is the storage primitive for both:

- `set(key, value, ttl?)` — TTL/LRU entry (from the `ttl` / `maxSize`
  options, or a per-call TTL) for temporary application data.
- `setWithoutTTL(key, value)` — never expires: no deadline, heap record or
  timer, and exempt from `maxSize` eviction.

Managers store Discord resources with `setWithoutTTL()`. A resource leaves the
cache only through an explicit delete (e.g. a Gateway `*_DELETE` event), never
through inactivity.

Messages are temporary data, not resource state: they are not cached unless
the client is given `messageCache: { maxSize?, ttl? }`, which enables a
bounded per-channel TTL/LRU cache (default `maxSize` 100).

## Memory model for large bots

Lunibee keeps three kinds of state apart:

| Layer | What it holds | Storage | Lifetime |
|---|---|---|---|
| Authoritative resource state | Guilds, channels, roles, members, emojis, users | Manager caches, `setWithoutTTL()` | Until a Gateway delete event or an explicit `delete()` |
| Temporary data | Messages (opt-in `messageCache`) | Bounded `Collection`, `set()` with TTL/LRU | Until TTL or LRU eviction |
| Application caches | Your own data (config, cooldowns, REST results) | `new Collection(null, { ttl, maxSize, onEvict })` | Your policy |

Guidelines:

- TTL never decides whether a Discord resource exists. If memory is the
  limit, turn caching off per resource with `ClientOptions.cache`
  (`users`, `members`, `roles`, `emojis`) rather than expiring it; events
  are still emitted with full objects.
- `Collection.stats` (hits, misses, expired, evicted) and `onEvict` show
  whether an application cache is sized right.
- `ShardManager.health()` reports per-shard state and ping.
- `benchmarks/collection.ts` measures the collection's hot paths.
