/**
 * Collection compatibility. Lunibee's Collection is the discord.js Collection analogue:
 * a Map subclass with first()/last()/find()/filter()/map()/reduce()/at() helpers.
 * Return-type contracts matter: filter() must return a Collection, map() an array.
 */
import { describe, expect, test } from "bun:test";
import { Collection } from "@lunibee/collection";

/** Builds a small ordered collection for assertions. */
function sample(): Collection<string, number> {
    const c = new Collection<string, number>();
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    return c;
}

describe("Collection is a Map subclass (discord.js parity)", () => {
    test("extends Map and supports Map operations", () => {
        const c = sample();
        expect(c).toBeInstanceOf(Map);
        expect(c.size).toBe(3);
        expect(c.get("b")).toBe(2);
        expect(c.has("z")).toBe(false);
    });
});

describe("Collection accessors", () => {
    test("first/last return insertion-ordered values", () => {
        const c = sample();
        expect(c.first()).toBe(1);
        expect(c.last()).toBe(3);
        expect(c.firstKey()).toBe("a");
        expect(c.lastKey()).toBe("c");
    });
    test("at()/keyAt() support positive and negative indexing", () => {
        const c = sample();
        expect(c.at(0)).toBe(1);
        expect(c.at(-1)).toBe(3);
        expect(c.keyAt(1)).toBe("b");
    });
    test("first/last on an empty collection return undefined", () => {
        const c = new Collection<string, number>();
        expect(c.first()).toBeUndefined();
        expect(c.last()).toBeUndefined();
    });
});

describe("Collection iteration helpers preserve discord.js return types", () => {
    test("find returns a single value or undefined", () => {
        const c = sample();
        expect(c.find((v) => v > 1)).toBe(2);
        expect(c.find((v) => v > 9)).toBeUndefined();
    });
    test("filter returns a Collection (not an array)", () => {
        const c = sample();
        const even = c.filter((v) => v % 2 === 0);
        expect(even).toBeInstanceOf(Collection);
        expect(even.size).toBe(1);
        expect(even.first()).toBe(2);
    });
    test("map returns an array", () => {
        const c = sample();
        const doubled = c.map((v) => v * 2);
        expect(Array.isArray(doubled)).toBe(true);
        expect(doubled).toEqual([2, 4, 6]);
    });
    test("some/every are boolean predicates", () => {
        const c = sample();
        expect(c.some((v) => v === 2)).toBe(true);
        expect(c.every((v) => v > 0)).toBe(true);
        expect(c.every((v) => v > 1)).toBe(false);
    });
    test("reduce folds with an initial accumulator", () => {
        const c = sample();
        expect(c.reduce((acc, v) => acc + v, 0)).toBe(6);
    });
});
