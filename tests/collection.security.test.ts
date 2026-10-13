import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Cache, Collection } from "../packages/collection/src/index.ts";

const realRandom = Math.random;
afterEach(() => {
    setSystemTime();
    Math.random = realRandom;
});

const T0 = new Date("2030-01-01T00:00:00.000Z").getTime();
const at = (ms: number) => setSystemTime(new Date(T0 + ms));

describe("TTL deadlines", () => {
    test("an entry lives for exactly its TTL, however it is read", () => {
        at(0);
        const c = new Collection<string, number>(null, {
            ttl: 1000,
            slide: false,
        });
        c.set("a", 1);
        at(999);
        expect(c.get("a")).toBe(1);
        expect(c.ttlRemaining("a")).toBe(1);
        at(1000);
        expect(c.has("a")).toBe(false);
        expect(c.get("a")).toBeUndefined();
        expect(c.size).toBe(0);
        c.clear();
    });

    test("a sliding read extends the deadline, a fixed one does not", () => {
        at(0);
        const sliding = new Collection<string, number>(null, { ttl: 1000 });
        const fixed = new Collection<string, number>(null, {
            ttl: 1000,
            slide: false,
        });
        for (const c of [sliding, fixed]) c.set("a", 1);
        at(900);
        sliding.get("a");
        fixed.get("a");
        at(1500);
        expect(sliding.get("a")).toBe(1);
        expect(fixed.get("a")).toBeUndefined();
        sliding.clear();
        fixed.clear();
    });

    test("eviction by size never brings an expired entry back", () => {
        at(0);
        const c = new Collection<string, number>(null, {
            ttl: 1000,
            maxSize: 2,
            slide: false,
        });
        c.set("old", 1);
        at(1200);
        c.set("b", 2);
        c.set("c", 3); // evicts the least recently used
        c.set("d", 4);
        expect([...c.keys()].sort()).toEqual(["c", "d"]);
        expect(c.get("old")).toBeUndefined();
        // Setting it again gives it a fresh deadline, not the old one.
        c.set("old", 5);
        at(2100);
        expect(c.get("old")).toBe(5);
        at(2300);
        expect(c.get("old")).toBeUndefined();
        c.clear();
    });

    test("purge removes exactly the expired entries and reports them", () => {
        at(0);
        const evicted: string[] = [];
        const c = new Collection<string, number>(null, {
            ttl: 1000,
            slide: false,
            onEvict: (key, _value, reason) => evicted.push(`${key}:${reason}`),
        });
        c.set("short", 1, 100);
        c.set("long", 2, 5000);
        c.setWithoutTTL("forever", 3);
        at(500);
        expect(c.purge()).toBe(1);
        expect(evicted).toEqual(["short:expired"]);
        expect([...c.keys()].sort()).toEqual(["forever", "long"]);
        c.clear();
    });
});

describe("jitter", () => {
    const remaining = (jitter: number, random: number, ttl = 1000) => {
        at(0);
        Math.random = () => random;
        const c = new Collection<string, number>(null, {
            ttl,
            jitter,
            slide: false,
        });
        c.set("a", 1);
        const left = c.ttlRemaining("a")!;
        c.clear();
        return left;
    };

    test("is off by default", () => {
        at(0);
        const c = new Collection<string, number>(null, { ttl: 1000 });
        for (let i = 0; i < 20; i++) c.set(String(i), i);
        expect(new Set([...c.keys()].map((k) => c.ttlRemaining(k))).size).toBe(
            1,
        );
        c.clear();
    });

    test("shaves off at most the given fraction and never adds time", () => {
        expect(remaining(0.2, 0)).toBe(1000); // the lowest draw keeps the full TTL
        expect(remaining(0.2, 0.5)).toBe(900);
        expect(remaining(0.2, 0.999999)).toBeGreaterThanOrEqual(800);
        expect(remaining(0.2, 0.999999)).toBeLessThanOrEqual(801);
        expect(remaining(0.5, 0.5)).toBe(750);
    });

    test("every entry of a large batch stays inside the window", () => {
        at(0);
        Math.random = realRandom;
        const c = new Collection<number, number>(null, {
            ttl: 1000,
            jitter: 0.3,
            slide: false,
        });
        for (let i = 0; i < 2000; i++) c.set(i, i);
        const left = [...c.keys()].map((k) => c.ttlRemaining(k)!);
        expect(Math.max(...left)).toBeLessThanOrEqual(1000);
        expect(Math.min(...left)).toBeGreaterThanOrEqual(700);
        expect(new Set(left.map(Math.floor)).size).toBeGreaterThan(50);
        c.clear();
    });

    test("a full jitter never produces a zero or negative lifetime", () => {
        for (const random of [0, 0.5, 0.9999999999]) {
            expect(remaining(1, random, 1)).toBeGreaterThanOrEqual(0);
            expect(remaining(1, random, 1)).toBeLessThanOrEqual(1);
        }
        at(0);
        Math.random = () => 0.9999999999;
        const c = new Collection<string, number>(null, { ttl: 1, jitter: 1 });
        expect(() => c.set("a", 1)).not.toThrow();
        c.clear();
    });

    test("applies to a per-call TTL too, and expiry stays exact at the boundary", () => {
        at(0);
        Math.random = () => 0.5;
        const c = new Collection<string, number>(null, {
            ttl: 5000,
            jitter: 0.2,
            slide: false,
        });
        c.set("a", 1, 1000); // 1000 * (1 - 0.2 * 0.5) = 900
        at(899);
        expect(c.has("a")).toBe(true);
        at(900);
        expect(c.has("a")).toBe(false);
        c.clear();
    });

    test("rejects values outside 0 to 1", () => {
        for (const jitter of [-0.1, 1.1, NaN, Infinity])
            expect(() => new Collection(null, { ttl: 10, jitter })).toThrow(
                RangeError,
            );
        for (const jitter of [-1, 2])
            expect(() => new Cache({ ttl: 10, jitter })).toThrow(RangeError);
        expect(() => new Cache({ ttl: 10, jitter: 0.5 })).not.toThrow();
    });
});

describe("bounds", () => {
    test("a bounded cache never holds more than maxSize entries under churn", () => {
        const cache = new Cache<number, number>({
            maxSize: 50,
            ttl: 60_000,
            jitter: 0.1,
        });
        for (let i = 0; i < 5000; i++) {
            cache.set(i, i);
            expect(cache.size).toBeLessThanOrEqual(50);
        }
        expect(cache.get(4999)).toBe(4999);
        expect(cache.get(0)).toBeUndefined();
        cache.clear();
        expect(cache.size).toBe(0);
    });

    test("clear() and dispose leave no entries to expire later", async () => {
        const evicted: unknown[] = [];
        const c = new Collection<number, number>(null, {
            ttl: 20,
            onEvict: (key) => evicted.push(key),
        });
        for (let i = 0; i < 10; i++) c.set(i, i);
        c.clear();
        await new Promise((r) => setTimeout(r, 60));
        expect(evicted).toEqual([]);
        expect(c.size).toBe(0);
    });
});
