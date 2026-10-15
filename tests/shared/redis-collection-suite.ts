/**
 * The behaviour of RedisCollection, run against the in-memory fake
 * (tests/redis-collection.test.ts) and against a real Redis
 * (tests/integration/redis-collection.test.ts), so both agree.
 */
import { expect, test } from "bun:test";
import {
    RedisCollection,
    type RedisCommandClient,
} from "../../packages/collection/src/index.ts";

export function redisCollectionSuite(
    connect: () => RedisCommandClient,
    sleep: (ms: number) => Promise<void>,
): void {
    const make = <V>(
        extra: Partial<
            ConstructorParameters<typeof RedisCollection<V>>[0]
        > = {},
        name = `t${crypto.randomUUID().slice(0, 8)}`,
    ) =>
        new RedisCollection<V>({
            client: connect(),
            name,
            prefix: "lunibee:test:",
            ...extra,
        });

    test("two instances with one name share entries", async () => {
        const a = make<{ n: number }>();
        const b = make<{ n: number }>({}, a.name);
        await a.set("x", { n: 1 });
        await a.set(2, { n: 2 });
        expect(await b.get("x")).toEqual({ n: 1 });
        expect(await b.get("2")).toEqual({ n: 2 });
        expect(await b.has("x")).toBe(true);
        expect(await b.size()).toBe(2);
        expect(await b.delete("x")).toBe(true);
        expect(await b.delete("x")).toBe(false);
        expect(await a.get("x")).toBeUndefined();
        expect(a.stats).toMatchObject({ hits: 0, misses: 1 });
        expect(b.stats).toMatchObject({ hits: 2 });
    });

    test("entries expire by TTL, and get() slides the window but peek() does not", async () => {
        const evicted: string[] = [];
        const c = make<string>({
            ttl: 150,
            onEvict: (key, value, reason) =>
                void evicted.push(`${key}=${value}:${reason}`),
        });
        await c.set("slide", "s");
        await c.set("fixed", "f");
        await c.set("long", "l", 5000);
        await c.setWithoutTTL("forever", "v");
        await sleep(90);
        expect(await c.get("slide")).toBe("s"); // restarts its window
        expect(await c.peek("fixed")).toBe("f");
        await sleep(90);
        expect(await c.get("slide")).toBe("s");
        expect(await c.peek("fixed")).toBeUndefined();
        expect(await c.ttlRemaining("long")).toBeGreaterThan(4000);
        expect(await c.ttlRemaining("forever")).toBeUndefined();
        expect(await c.ttlRemaining("missing")).toBeUndefined();
        expect((await c.keys()).sort()).toEqual(["forever", "long", "slide"]);
        expect(evicted).toEqual(["fixed=f:expired"]);
        expect(c.stats.expired).toBe(1);
    });

    test("slide: false keeps a fixed window", async () => {
        const c = make<number>({ ttl: 120, slide: false });
        await c.set("k", 1);
        await sleep(70);
        expect(await c.get("k")).toBe(1);
        await sleep(70);
        expect(await c.get("k")).toBeUndefined();
    });

    test("maxSize evicts the least recently used across instances", async () => {
        const evicted: string[] = [];
        const a = make<number>({
            maxSize: 3,
            onEvict: (key, value, reason) =>
                void evicted.push(`${key}=${value}:${reason}`),
        });
        const b = make<number>({ maxSize: 3 }, a.name);
        await a.set("a", 1);
        await b.set("b", 2);
        await a.set("c", 3);
        await b.get("a"); // b's read makes "a" recent for everyone
        await a.set("d", 4);
        expect((await a.keys()).sort()).toEqual(["a", "c", "d"]);
        expect(evicted).toEqual(["b=2:evicted"]);
        expect(a.stats.evicted).toBe(1);
        // Overwriting a key never evicts itself.
        await a.set("d", 5);
        expect(await a.size()).toBe(3);
    });

    test("ensure() creates once; racing creators agree on one value", async () => {
        const a = make<number>();
        const b = make<number>({}, a.name);
        let calls = 0;
        const [x, y] = await Promise.all([
            a.ensure("k", async () => {
                calls++;
                await sleep(20);
                return 1;
            }),
            b.ensure("k", async () => {
                calls++;
                await sleep(20);
                return 2;
            }),
        ]);
        expect(x).toBe(y);
        expect(calls).toBe(2);
        expect(await a.ensure("k", () => 99)).toBe(x);
        expect(await a.ensure("n", () => 7, 5000)).toBe(7);
        expect(await a.ttlRemaining("n")).toBeGreaterThan(4000);
    });

    test("entries(), values() and clear()", async () => {
        const c = make<{ v: number }>();
        for (let i = 0; i < 5; i++) await c.set(`k${i}`, { v: i });
        expect((await c.entries()).map(([k]) => k)).toEqual([
            "k0",
            "k1",
            "k2",
            "k3",
            "k4",
        ]);
        expect((await c.values()).map((v) => v.v)).toEqual([0, 1, 2, 3, 4]);
        expect(await c.clear()).toBe(5);
        expect(await c.size()).toBe(0);
        expect(await c.entries()).toEqual([]);
        expect(await c.clear()).toBe(0);
    });

    test("a custom serializer carries values JSON cannot", async () => {
        const c = make<bigint>({
            serializer: {
                serialize: (v) => v.toString(),
                deserialize: (raw) => BigInt(raw),
            },
        });
        await c.set("big", 2n ** 70n);
        expect(await c.get("big")).toBe(2n ** 70n);
    });
}
