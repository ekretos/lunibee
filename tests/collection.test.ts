import { describe, expect, test } from "bun:test";
import {
    Collection,
    type ReadonlyCollection,
} from "../packages/collection/src/index.ts";

describe("Collection Full Coverage", () => {
    test("covers all collection manipulation and helper methods", () => {
        const col = new Collection<string, { id: string; num: number }>();
        col.set("a", { id: "a", num: 1 });
        col.set("b", { id: "b", num: 2 });
        col.set("c", { id: "c", num: 3 });

        expect(col.first()?.id).toBe("a");
        expect(col.last()?.id).toBe("c");
        expect(col.firstKey()).toBe("a");
        expect(col.lastKey()).toBe("c");
        expect(col.firstEntry()?.[0]).toBe("a");
        expect(col.lastEntry()?.[0]).toBe("c");

        expect(col.map((item) => item.num * 2)).toEqual([2, 4, 6]);
        expect(col.filter((item) => item.num > 1).size).toBe(2);
        expect(col.every((item) => item.num > 0)).toBe(true);
        expect(col.some((item) => item.num === 2)).toBe(true);
        expect(col.someEntry((item) => item.num === 2)).toBe(true);
        expect(col.find((item) => item.num === 2)?.id).toBe("b");
        expect(col.findKey((item) => item.num === 2)).toBe("b");
        expect(col.hasAll("a", "b")).toBe(true);
        expect(col.hasAny("a", "z")).toBe(true);
        expect(col.array().length).toBe(3);
        expect(col.keyArray().length).toBe(3);
        expect(col.entriesArray().length).toBe(3);

        const visited: string[] = [];
        col.each((item) => visited.push(item.id));
        expect(visited).toEqual(["a", "b", "c"]);

        const cloned = col.clone();
        expect(cloned.size).toBe(3);

        const swept = col.sweep((item) => item.num === 1);
        expect(swept).toBe(1);
        expect(col.size).toBe(2);
        const emptyCol = new Collection<string, number>();
        expect(emptyCol.first()).toBeUndefined();
        expect(emptyCol.firstKey()).toBeUndefined();
        expect(emptyCol.last()).toBeUndefined();
        expect(emptyCol.lastKey()).toBeUndefined();
        expect(emptyCol.firstEntry()).toBeUndefined();
        expect(emptyCol.lastEntry()).toBeUndefined();
        expect(col.find((i) => i.num === 999)).toBeUndefined();
        expect(col.findKey((i) => i.num === 999)).toBeUndefined();
        expect(col.some((i) => i.num === 999)).toBe(false);
        expect(col.every((i) => i.num === 999)).toBe(false);
        expect(col.hasAll("a", "b", "z")).toBe(false);
        expect(col.hasAny("x", "y", "z")).toBe(false);

        // Set operations coverage (union, intersection, difference)
        const colA = new Collection<string, number>();
        colA.set("x", 1);
        colA.set("y", 2);
        const colB = new Collection<string, number>();
        colB.set("y", 2);
        colB.set("z", 3);

        const union = colA.union(colB);
        expect(union.size).toBe(3);
        expect(union.hasAll("x", "y", "z")).toBe(true);

        const intersection = colA.intersection(colB);
        expect(intersection.size).toBe(1);
        expect(intersection.has("y")).toBe(true);

        const difference = colA.difference(colB);
        expect(difference.size).toBe(1);
        expect(difference.has("x")).toBe(true);
    });
});

describe("random and findLast", () => {
    const make = () =>
        new Collection<string, number>([
            ["a", 1],
            ["b", 2],
            ["c", 3],
            ["d", 4],
        ]);

    test("random() with an amount returns that many different values", () => {
        const col = make();
        for (let round = 0; round < 50; round++) {
            const picked = col.random(3);
            expect(picked).toHaveLength(3);
            expect(new Set(picked).size).toBe(3);
            for (const value of picked) expect([1, 2, 3, 4]).toContain(value);
        }
        expect(col.randomKey(2).every((key) => col.has(key))).toBe(true);
        expect(new Set(col.randomKey(2)).size).toBe(2);
    });

    test("random(amount) clamps to the size, accepts 0, and rejects bad amounts", () => {
        const col = make();
        expect(col.random(10).sort()).toEqual([1, 2, 3, 4]);
        expect(col.random(0)).toEqual([]);
        expect(new Collection<string, number>().random(3)).toEqual([]);
        expect(() => col.random(-1)).toThrow(RangeError);
        expect(() => col.random(1.5)).toThrow(RangeError);
        expect(() => col.randomKey(NaN)).toThrow(RangeError);
        expect(col.size).toBe(4);
    });

    test("random() without an amount picks every entry in turn and is empty-safe", () => {
        const col = make();
        const seen = new Set<number | undefined>();
        const original = Math.random;
        try {
            for (const r of [0, 0.3, 0.6, 0.99]) {
                Math.random = () => r;
                seen.add(col.random());
            }
            Math.random = () => 0.99;
            expect(col.randomKey()).toBe("d");
        } finally {
            Math.random = original;
        }
        expect([...seen].sort()).toEqual([1, 2, 3, 4]);
        expect(new Collection<string, number>().random()).toBeUndefined();
        expect(new Collection<string, number>().randomKey()).toBeUndefined();
    });

    test("findLast and findLastKey search from the end", () => {
        const col = make();
        expect(col.findLast((value) => value % 2 === 1)).toBe(3);
        expect(col.findLastKey((value) => value % 2 === 1)).toBe("c");
        expect(col.findLast((value) => value > 10)).toBeUndefined();
        expect(col.findLastKey((value) => value > 10)).toBeUndefined();
        const seen: string[] = [];
        col.findLast((_value, key, collection) => {
            seen.push(key);
            return collection !== col;
        });
        expect(seen).toEqual(["d", "c", "b", "a"]);
    });
});

describe("Symbol.species", () => {
    class Users extends Collection<string, number> {
        label = "users";
    }
    class Plain extends Collection<string, number> {
        static override get [Symbol.species]() {
            return Collection;
        }
    }
    const fill = <C extends Collection<string, number>>(col: C): C => {
        col.set("a", 1).set("b", 2).set("c", 3);
        return col;
    };

    test("derived collections keep the subclass", () => {
        const users = fill(new Users());
        const other = fill(new Users());
        const derived = [
            users.filter((value) => value > 1),
            users.clone(),
            users.sorted((x, y) => y - x),
            users.union(other),
            users.intersection(other),
            users.difference(other),
            ...users.partition((value) => value > 1),
        ];
        for (const result of derived) {
            expect(result).toBeInstanceOf(Users);
            expect(result.label).toBe("users");
        }
        expect([...users.sorted((x, y) => y - x).keys()]).toEqual([
            "c",
            "b",
            "a",
        ]);
        expect(
            users.partition((value) => value > 1).map((c) => c.size),
        ).toEqual([2, 1]);
    });

    test("a subclass can opt out, and a plain Collection stays plain", () => {
        const plain = fill(new Plain());
        const filtered = plain.filter((value) => value > 1);
        expect(filtered).toBeInstanceOf(Collection);
        expect(filtered).not.toBeInstanceOf(Plain);
        const base = fill(new Collection<string, number>());
        expect(base.filter(() => true).constructor).toBe(Collection);
        expect(base.clone().constructor).toBe(Collection);
    });

    test("a derived collection starts without a TTL or size bound", () => {
        const bounded = new Collection<string, number>(null, { maxSize: 1 });
        bounded.set("a", 1);
        const copy = bounded.clone();
        copy.set("b", 2);
        expect(copy.size).toBe(2);
    });
});

describe("set operations and transforms", () => {
    const make = (entries: [string, number][]) =>
        new Collection<string, number>(entries);
    const left = () =>
        make([
            ["a", 1],
            ["b", 2],
            ["c", 3],
        ]);
    const right = () =>
        make([
            ["b", 20],
            ["c", 3],
            ["d", 4],
        ]);

    test("symmetricDifference keeps what only one side has", () => {
        const result = left().symmetricDifference(right());
        expect([...result]).toEqual([
            ["a", 1],
            ["d", 4],
        ]);
    });

    test("concat adds collections in order and a later one wins a shared key", () => {
        const result = left().concat(right(), make([["e", 5]]));
        expect([...result]).toEqual([
            ["a", 1],
            ["b", 20],
            ["c", 3],
            ["d", 4],
            ["e", 5],
        ]);
        const original = left();
        original.concat(right());
        expect(original.size).toBe(3);
    });

    test("merge decides per key what to keep", () => {
        const result = left().merge(
            right(),
            (value) => ({ keep: true, value: `self:${value}` }),
            (value) => ({ keep: true, value: `other:${value}` }),
            (value, other) =>
                value === other
                    ? { keep: false }
                    : { keep: true, value: `both:${value}+${other}` },
        );
        expect([...result]).toEqual([
            ["a", "self:1"],
            ["b", "both:2+20"],
            ["d", "other:4"],
        ]);
        const onlyOther = left().merge(
            right(),
            () => ({ keep: false }),
            (value) => ({ keep: true, value }),
            () => ({ keep: false }),
        );
        expect([...onlyOther]).toEqual([["d", 4]]);
    });

    test("equals compares keys and values without touching TTL or recency", () => {
        expect(left().equals(left())).toBe(true);
        expect(left().equals(right())).toBe(false);
        expect(left().equals(make([["a", 1]]))).toBe(false);
        expect(left().equals(null)).toBe(false);
        expect(left().equals(undefined)).toBe(false);
        const same = left();
        expect(same.equals(same)).toBe(true);
        expect(
            left().equals(
                new Map([
                    ["a", 1],
                    ["b", 2],
                    ["c", 3],
                ]) as never,
            ),
        ).toBe(true);
        expect(
            left().equals(
                new Map([
                    ["a", 1],
                    ["b", 2],
                    ["z", 3],
                ]) as never,
            ),
        ).toBe(false);
        const withUndefined = make([["a", undefined as never]]);
        expect(withUndefined.equals(make([["b", undefined as never]]))).toBe(
            false,
        );
        expect(withUndefined.equals(make([["a", undefined as never]]))).toBe(
            true,
        );
        const timed = new Collection<string, number>(null, {
            ttl: 1_000,
            maxSize: 2,
        });
        timed.set("a", 1).set("b", 2);
        const mirror = new Collection<string, number>([
            ["a", 1],
            ["b", 2],
        ]);
        mirror.equals(timed);
        timed.equals(mirror);
        expect(timed.stats.hits).toBe(0);
        timed.set("c", 3);
        expect([...timed.keys()]).toEqual(["b", "c"]);
    });

    test("mapValues keeps keys and order and changes the value type", () => {
        const result = left().mapValues((value, key) => `${key}${value * 2}`);
        expect([...result]).toEqual([
            ["a", "a2"],
            ["b", "b4"],
            ["c", "c6"],
        ]);
        class Users extends Collection<string, number> {}
        expect(
            new Users([["a", 1]]).mapValues((value) => value),
        ).toBeInstanceOf(Users);
    });

    test("reduceRight folds from the last entry and toReversed / toSorted return new collections", () => {
        const col = left();
        expect(col.reduceRight((acc, _value, key) => acc + key, "")).toBe(
            "cba",
        );
        expect(col.reduceRight((acc, value) => acc + value, 10)).toBe(16);
        expect([...col.toReversed().keys()]).toEqual(["c", "b", "a"]);
        expect([...col.toSorted((x, y) => y - x).keys()]).toEqual([
            "c",
            "b",
            "a",
        ]);
        expect([...col.toSorted().keys()]).toEqual(["a", "b", "c"]);
        expect([...col.keys()]).toEqual(["a", "b", "c"]);
        expect(new Collection<string, number>().toReversed().size).toBe(0);
    });

    test("groupBy and combineEntries build collections from iterables", () => {
        const groups = Collection.groupBy([1, 2, 3, 4, 5], (n, index) =>
            index === 0 ? "first" : n % 2 === 0 ? "even" : "odd",
        );
        expect([...groups]).toEqual([
            ["first", [1]],
            ["even", [2, 4]],
            ["odd", [3, 5]],
        ]);
        const sums = Collection.combineEntries<string, number>(
            [
                ["a", 1],
                ["b", 2],
                ["a", 10],
            ],
            (first, second) => first + second,
        );
        expect([...sums]).toEqual([
            ["a", 11],
            ["b", 2],
        ]);
    });

    test("a Collection can be passed as a ReadonlyCollection", () => {
        const total = (collection: ReadonlyCollection<string, number>) =>
            collection.reduce((sum, value) => sum + value, 0);
        expect(total(left())).toBe(6);
        const mutate = (collection: ReadonlyCollection<string, number>) => {
            // @ts-expect-error a ReadonlyCollection has no set()
            collection.set("x", 1);
        };
        expect(typeof mutate).toBe("function");
    });
});
