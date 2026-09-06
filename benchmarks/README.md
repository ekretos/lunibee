# Lunibee benchmarks

Run the representative benchmark harnesses with Bun after installing dependencies.

```sh
bun benchmarks/parity.ts
bun benchmarks/cache.ts
bun benchmarks/rest.ts
```

Use `BENCH_ITERATIONS` to change the sample count, for example:

```sh
BENCH_ITERATIONS=50000 bun benchmarks/cache.ts
```

The collection and builder harnesses report deterministic `ns/op` measurements. The cache harness isolates common hit/miss/set/materialization operations. The REST harness uses a controlled local `fetch` fake so measurements do not depend on Discord availability.

Network and Gateway load tests should use controlled fakes or dedicated integration environments rather than making CI depend on Discord availability.
