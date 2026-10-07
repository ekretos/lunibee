import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Cache } from "../packages/collection/src/index.ts";

const caches: Cache<unknown, unknown>[] = [];

afterEach(() => {
    setSystemTime();
    for (const cache of caches) cache.dispose();
    caches.length = 0;
});

describe("Cache", () => {
    test("validates constructor options", () => {
        expect(() => new Cache({ maxSize: 0 })).toThrow();
        expect(() => new Cache({ maxSize: 1.5 })).toThrow();
        expect(() => new Cache({ ttl: -5 })).toThrow();
        expect(() => new Cache({ ttl: NaN })).toThrow();
        expect(() => new Cache({ ttl: 10, sweepInterval: 0 })).toThrow();
        expect(() => new Cache({ ttl: 10, sweepInterval: NaN })).toThrow();
    });

    test("evicts oldest entries at the configured bound", () => {
        const cache = new Cache<string, number>({ maxSize: 2 });
        caches.push(cache);
        cache.set("a", 1).set("b", 2).set("c", 3);
        expect(cache.has("a")).toBe(false);
        expect(cache.entries()).toEqual([
            ["b", 2],
            ["c", 3],
        ]);
    });

    test("expires entries according to TTL", async () => {
        const cache = new Cache<string, number>({ ttl: 10, sweepInterval: 5 });
        caches.push(cache);
        cache.set("a", 1);
        expect(cache.get("a")).toBe(1);
        expect(cache.size).toBe(1);
        expect(cache.values()).toEqual([1]);
        expect(cache.entries()).toEqual([["a", 1]]);
        await Bun.sleep(20);
        expect(cache.get("a")).toBeUndefined();
        expect(cache.size).toBe(0);
        expect(cache.values()).toEqual([]);
        expect(cache.entries()).toEqual([]);
    });

    test("supports explicit predicate invalidation, clear and delete", () => {
        const cache = new Cache<string, number>();
        caches.push(cache);
        cache.set("one", 1).set("two", 2).set("three", 3);
        expect(cache.has("one")).toBe(true);
        expect(cache.has("missing")).toBe(false);
        expect(cache.get("missing")).toBeUndefined();
        expect(cache.delete("one")).toBe(true);
        expect(cache.delete("missing")).toBe(false);
        expect(cache.invalidate((value) => value % 2 === 1)).toBe(1);
        expect(cache.values()).toEqual([2]);
        cache.clear();
        expect(cache.size).toBe(0);
    });

    test("reads promote an entry, so the least recently used one is evicted", () => {
        const cache = new Cache<string, number>({ maxSize: 2 });
        caches.push(cache);
        cache.set("a", 1).set("b", 2);
        expect(cache.get("a")).toBe(1);
        cache.set("c", 3);
        expect(cache.has("b")).toBe(false);
        expect(cache.has("a")).toBe(true);
        expect(cache.has("c")).toBe(true);
    });

    test("reads do not extend the TTL but a set() restarts it", () => {
        setSystemTime(new Date(1_000_000));
        const cache = new Cache<string, number>({ ttl: 100 });
        caches.push(cache);
        cache.set("a", 1).set("b", 2);
        setSystemTime(new Date(1_000_080));
        expect(cache.get("a")).toBe(1);
        cache.set("b", 3);
        setSystemTime(new Date(1_000_120));
        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBe(3);
        setSystemTime(new Date(1_000_200));
        expect(cache.sweep()).toBe(1);
        expect(cache.size).toBe(0);
    });

    test("a hot bounded cache keeps evicting in order", () => {
        const cache = new Cache<number, number>({ maxSize: 100 });
        caches.push(cache);
        for (let i = 0; i < 20_000; i++) {
            cache.set(i, i);
            cache.get(i - 50);
        }
        expect(cache.size).toBe(100);
        expect(cache.has(19_999)).toBe(true);
        expect(cache.has(0)).toBe(false);
    });
});
