import { Cache } from "../packages/collection/src/index.ts";

const iterations = Number(process.env.BENCH_ITERATIONS ?? 100_000);
if (!Number.isInteger(iterations) || iterations <= 0)
  throw new RangeError("BENCH_ITERATIONS must be a positive integer");

function bench(name: string, operation: () => void): void {
  for (let i = 0; i < Math.min(1_000, iterations); i++) operation();
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i++) operation();
  const elapsed = Bun.nanoseconds() - start;
  console.log(
    `${name}: ${(elapsed / iterations).toFixed(2)} ns/op (${iterations} iterations)`,
  );
}

const cache = new Cache<number, number>({ maxSize: 1_000 });
for (let i = 0; i < 1_000; i++) cache.set(i, i);

bench("cache.get-hit", () => cache.get(999));
bench("cache.get-miss", () => cache.get(-1));
bench("cache.has-hit", () => cache.has(999));
bench("cache.set-existing", () => cache.set(999, 999));
bench("cache.values", () => cache.values());
bench("cache.entries", () => cache.entries());

cache.dispose();
console.log(`Lunibee cache benchmarks complete (iterations=${iterations}).`);
