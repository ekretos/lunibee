import { afterEach, describe, expect, test } from "bun:test";
import { Cache } from "../packages/collection/src/index.ts";

const caches: Cache<unknown, unknown>[] = [];

afterEach(() => { for (const cache of caches) cache.dispose(); caches.length = 0; });

describe("Cache", () => {
    test("evicts oldest entries at the configured bound", () => {
        const cache = new Cache<string, number>({ maxSize: 2 });
        caches.push(cache);
        cache.set("a", 1).set("b", 2).set("c", 3);
        expect(cache.has("a")).toBe(false);
        expect(cache.entries()).toEqual([["b", 2], ["c", 3]]);
    });

    test("expires entries according to TTL", async () => {
        const cache = new Cache<string, number>({ ttl: 10, sweepInterval: 5 });
        caches.push(cache);
        cache.set("a", 1);
        expect(cache.get("a")).toBe(1);
        await Bun.sleep(20);
        expect(cache.get("a")).toBeUndefined();
    });

    test("supports explicit predicate invalidation", () => {
        const cache = new Cache<string, number>();
        caches.push(cache);
        cache.set("one", 1).set("two", 2).set("three", 3);
        expect(cache.invalidate(value => value % 2 === 1)).toBe(2);
        expect(cache.values()).toEqual([2]);
    });
});
