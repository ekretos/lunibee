# Lunibee benchmarks

Run the parity benchmark harness with Bun after installing dependencies:

```sh
bun benchmarks/parity.ts
```

Use `BENCH_ITERATIONS` to change the sample count, for example `BENCH_ITERATIONS=50000 bun benchmarks/parity.ts`.

The harness reports deterministic `ns/op` measurements for representative collection operations and builder serialization. It is intentionally kept outside `packages/` so benchmark code never becomes part of the runtime library.

Compare Lunibee's `Collection` with discord.js's (`@discordjs/collection`) and a plain `Map`:

```sh
bun benchmarks/collection.ts
```

It reports the median of nine runs for `set`, `get`, `filter`, `find`, `random` and `at`, plus the shallow size of an empty instance. Figures vary by up to about 20% between runs on a busy machine, so compare ratios, not absolute times.

Other harnesses:

```sh
bun run bench:rest                 # REST scheduling: sequential vs concurrent buckets, fake Discord
bun benchmarks/gateway-events.ts   # per-event cost of Gateway dispatches, cache included
bun benchmarks/cache-memory.ts     # heap kept per guild for small, medium and large guilds
bun run bench:compare              # runtime benchmark vs the committed baseline (build first)
```

The [Benchmarks](https://lunibee.js.org/benchmarks/) pages of the docs are generated from all of these with `bun run build && bun scripts/bench-docs.ts`.

Network and Gateway load tests should use controlled fakes or dedicated integration environments rather than making CI depend on Discord availability.
