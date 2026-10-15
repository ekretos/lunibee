import { describe, expect, test } from "bun:test";
import { cloneData } from "../packages/builders/src/clone.ts";
import { CreateEmbed } from "../packages/builders/src/index.ts";

describe("cloneData", () => {
    test("copies plain JSON exactly as structuredClone does, and deeply", () => {
        const value = {
            a: 1,
            b: "s",
            c: null,
            d: undefined,
            e: [1, { f: [true, false] }],
            g: { h: { i: "deep" } },
        };
        const copy = cloneData(value);
        expect(copy).toEqual(structuredClone(value));
        expect("d" in copy).toBe(true);
        copy.e[1] = 0;
        (copy.g.h as { i: string }).i = "changed";
        expect(value.e[1]).toEqual({ f: [true, false] });
        expect(value.g.h.i).toBe("deep");
        expect(cloneData(5)).toBe(5);
        expect(cloneData(null)).toBeNull();
        const bare = Object.assign(Object.create(null), { x: 1 });
        expect(cloneData(bare)).toEqual({ x: 1 });
    });

    test("anything that is not plain JSON goes to structuredClone", () => {
        const when = new Date(0);
        const map = new Map([["k", 1]]);
        const copy = cloneData({ when, map });
        expect(copy.when).toBeInstanceOf(Date);
        expect(copy.when).not.toBe(when);
        expect(copy.map.get("k")).toBe(1);
        const cyclic: Record<string, unknown> = { name: "loop" };
        cyclic.self = cyclic;
        const copied = cloneData(cyclic) as Record<string, unknown>;
        expect(copied.name).toBe("loop");
    });

    test("a builder's toJSON is a copy the caller can change freely", () => {
        const embed = new CreateEmbed()
            .setTitle("t")
            .addFields({ name: "a", value: "b" });
        const first = embed.toJSON();
        (first.fields as Array<{ name: string }>)[0]!.name = "changed";
        expect(
            (embed.toJSON().fields as Array<{ name: string }>)[0]!.name,
        ).toBe("a");
    });
});
