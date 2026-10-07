import { describe, expect, test } from "bun:test";
// @ts-expect-error: a plain ES module without declarations
import { compare, median, medians } from "../scripts/bench-compare-lib.mjs";

interface Row {
    group: string;
    name: string;
    ns: number;
}

const baseline = [
    { group: "Collection", name: "Map.set (reference)", bun13: 100 },
    { group: "Collection", name: "Map.get (reference)", bun13: 50 },
    { group: "Collection", name: "filter", bun13: 1000 },
    { group: "Collection", name: "tiny", bun13: 10 },
    { group: "Collection", name: "missing", bun13: 500 },
    { group: "Builders", name: "embed", bun13: null },
];
const row = (name: string, ns: number, group = "Collection"): Row => ({
    group,
    name,
    ns,
});

describe("bench compare", () => {
    test("median", () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 3, 2])).toBe(2.5);
    });

    test("takes the median of several runs and skips failed rows", () => {
        const merged = medians([
            [row("a", 10), { group: "Collection", name: "b", ns: null }],
            [row("a", 30)],
            [row("a", 20)],
        ]);
        expect(merged).toEqual([{ group: "Collection", name: "a", ns: 20 }]);
    });

    test("scales by the machine, then flags slower rows", () => {
        // This machine runs the Map rows twice as slowly: everything is allowed to be 2x.
        const current = [
            row("Map.set (reference)", 200),
            row("Map.get (reference)", 100),
            row("filter", 2100),
            row("tiny", 1000),
        ];
        const { factor, regressions, compared } = compare(
            baseline,
            current,
            "bun13",
            0.15,
        );
        expect(factor).toBe(2);
        expect(compared).toBe(1);
        expect(regressions).toHaveLength(0);

        const slower = compare(
            baseline,
            [...current.slice(0, 2), row("filter", 2600)],
            "bun13",
            0.15,
        );
        expect(slower.regressions).toHaveLength(1);
        expect(slower.regressions[0]).toMatchObject({
            name: "filter",
            current: 2600,
        });
        expect(slower.regressions[0].ratio).toBeCloseTo(1.3);
    });

    test("without reference rows the machines count as equal", () => {
        const { factor, regressions } = compare(
            baseline,
            [row("filter", 1200)],
            "bun13",
            0.15,
        );
        expect(factor).toBe(1);
        expect(regressions.map((r: { name: string }) => r.name)).toEqual([
            "filter",
        ]);
        expect(
            compare(baseline, [row("filter", 1100)], "bun13", 0.15).regressions,
        ).toEqual([]);
    });
});
