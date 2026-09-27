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
