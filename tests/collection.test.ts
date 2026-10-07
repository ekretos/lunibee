import { describe, expect, test } from "bun:test";
import { Collection } from "../packages/collection/src/index.ts";

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
