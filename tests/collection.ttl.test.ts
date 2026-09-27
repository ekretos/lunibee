import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Collection } from "../packages/collection/src/index.ts";
import { Manager } from "../packages/managers/src/index.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => setSystemTime());

describe("Collection TTL", () => {
    test("validates options and TTL arguments", () => {
        expect(() => new Collection(null, { ttl: 0 })).toThrow(RangeError);
        expect(() => new Collection(null, { maxSize: 1.5 })).toThrow(
            RangeError,
        );
        expect(() => new Collection<string, number>().set("a", 1, -1)).toThrow(
            RangeError,
        );
    });

    test("set() entries expire; get() slides, peek() does not", () => {
        setSystemTime(new Date(1_000_000));
        const c = new Collection<string, number>(null, { ttl: 100 });
        c.set("a", 1);
        c.set("b", 2);
        c.set("c", 3, 1_000);
        setSystemTime(new Date(1_000_080));
        expect(c.get("a")).toBe(1);
        expect(c.peek("b")).toBe(2);
        setSystemTime(new Date(1_000_150));
        expect(c.has("b")).toBe(false);
        expect(c.peek("b")).toBeUndefined();
        expect(c.delete("b")).toBe(false);
        expect(c.ttlRemaining("a")).toBe(30);
        expect(c.ttlRemaining("zz")).toBeUndefined();
        expect([...c.keys()]).toEqual(["a", "c"]);
        setSystemTime(new Date(1_000_300));
        expect(c.get("a")).toBeUndefined();
        expect(c.size).toBe(1);
        expect(c.purge()).toBe(0);
    });

    test("setWithoutTTL() never expires and needs no timer", () => {
        setSystemTime(new Date(2_000_000));
        const c = new Collection<string, number>(null, { ttl: 10 });
        c.set("guild", 1);
        c.setWithoutTTL("guild", 2);
        c.setWithoutTTL("user", 3);
        expect(c.ttlRemaining("guild")).toBeUndefined();
        setSystemTime(new Date(9_000_000));
        expect(c.purge()).toBe(0);
        expect(c.get("guild")).toBe(2);
        expect(c.size).toBe(2);
        c.set("guild", 4);
        setSystemTime(new Date(9_000_100));
        expect(c.has("guild")).toBe(false);
        expect(c.has("user")).toBe(true);
    });

    test("the sweep timer reclaims lapsed entries", async () => {
        const c = new Collection<string, number>(null, { ttl: 5 });
        c.set("a", 1);
        c.setWithoutTTL("p", 2);
        c.get("a");
        await sleep(40);
        expect(c.toJSON()).toEqual([["p", 2]]);
    });

    test("maxSize evicts LRU set() entries, never setWithoutTTL() ones", () => {
        const c = new Collection<string, number>(null, { maxSize: 2 });
        c.setWithoutTTL("p1", 0);
        c.setWithoutTTL("p2", 0);
        c.set("a", 1);
        c.set("b", 2);
        c.get("a");
        c.set("c", 3);
        expect([...c.keys()]).toEqual(["p1", "p2", "a", "c"]);
        c.set("p1", 9);
        expect(c.has("p1")).toBe(true);
        expect(c.has("a")).toBe(false);
        c.delete("p2");
        c.clear();
        expect(c.size).toBe(0);
    });

    test("forEach and seeded entries skip lapsed entries", () => {
        setSystemTime(new Date(3_000_000));
        const c = new Collection<string, number>([["a", 1]], { ttl: 50 });
        c.set("b", 2, 500);
        setSystemTime(new Date(3_000_100));
        const seen: string[] = [];
        c.forEach((_v, key) => seen.push(key));
        expect(seen).toEqual(["b"]);
        expect([...c.values()]).toEqual([2]);
    });

    test("re-dated entries keep the deadline heap bounded", () => {
        setSystemTime(new Date(4_000_000));
        const c = new Collection<number, number>(null, { ttl: 10_000 });
        for (let round = 0; round < 6; round++)
            for (let i = 0; i < 50; i++) c.set(i, i, 1_000 - round * 100);
        setSystemTime(new Date(4_000_600));
        expect(c.size).toBe(0);
        c.clear();
    });
});

describe("Manager resource storage", () => {
    test("stores resources without TTL", () => {
        const manager = new Manager<string, { id: string }>();
        manager.set("1", { id: "1" });
        expect(manager.cache.ttlRemaining("1")).toBeUndefined();
        expect(manager.values()).toEqual([{ id: "1" }]);
    });
});
