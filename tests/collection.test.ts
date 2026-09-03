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

        // Negative/Empty path coverage
        const emptyCol = new Collection<string, any>();
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
