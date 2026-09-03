import { afterEach, describe, expect, test } from "bun:test";
import { Cache } from "../packages/collection/src/index.ts";

const caches: Cache<unknown, unknown>[] = [];

afterEach(() => {
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
});
