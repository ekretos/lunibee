/**
 * Collection micro-benchmark: `bun benchmarks/collection.ts`.
 * Compares a plain Map with Collection in its three modes.
 */
import { Collection } from "../packages/collection/src/index.ts";

const N = 200_000;
const keys = Array.from({ length: N }, (_, i) => `k${i}`);

function bench(name: string, fn: () => void): void {
    fn(); // warm up
    const start = performance.now();
    fn();
    const ms = performance.now() - start;
    console.log(`${name.padEnd(40)} ${((ms * 1e6) / N).toFixed(1)} ns/op`);
}

const map = new Map<string, number>();
const plain = new Collection<string, number>();
const persistent = new Collection<string, number>(null, { maxSize: N / 2 });
const ttl = new Collection<string, number>(null, { ttl: 60_000 });
const lru = new Collection<string, number>(null, { maxSize: N / 2 });

bench("Map.set", () => keys.forEach((k, i) => map.set(k, i)));
bench("Collection.set (plain)", () => keys.forEach((k, i) => plain.set(k, i)));
bench("Collection.setWithoutTTL (bounded)", () =>
    keys.forEach((k, i) => persistent.setWithoutTTL(k, i)),
);
bench("Collection.set (ttl)", () => keys.forEach((k, i) => ttl.set(k, i)));
bench("Collection.set (lru, evicting)", () =>
    keys.forEach((k, i) => lru.set(k, i)),
);
bench("Map.get", () => keys.forEach((k) => map.get(k)));
bench("Collection.get (plain)", () => keys.forEach((k) => plain.get(k)));
bench("Collection.get (ttl, sliding)", () => keys.forEach((k) => ttl.get(k)));
bench("Collection.get (lru, promoting)", () => keys.forEach((k) => lru.get(k)));
bench("Collection.delete (ttl)", () => keys.forEach((k) => ttl.delete(k)));
ttl.clear();
