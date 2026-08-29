import { describe, expect, test } from "bun:test";
import { Collection } from "../packages/collection/src/index.js";

describe("Collection", () => {
    test("preserves insertion order and supports lookup helpers", () => {
        const collection = new Collection<string, number>([["a", 1], ["b", 2], ["c", 3]]);
        expect(collection.first()).toBe(1);
        expect(collection.last()).toBe(3);
        expect(collection.firstKey()).toBe("a");
        expect(collection.lastKey()).toBe("c");
        expect(collection.find(value => value === 2)).toBe(2);
        expect(collection.findKey(value => value === 3)).toBe("c");
    });

    test("filters and sweeps without mutating unrelated entries", () => {
        const collection = new Collection([["a", 1], ["b", 2], ["c", 3]]);
        expect(collection.filter(value => value > 1).array()).toEqual([2, 3]);
        expect(collection.sweep(value => value % 2 === 1)).toBe(2);
        expect(collection.array()).toEqual([2]);
    });
});
