/** The arithmetic behind `bench-compare.mjs`, kept apart so tests can load it without running a benchmark. */

/** Rows that measure the platform, not Lunibee. */
export const REFERENCE_ROWS = ["Map.set (reference)", "Map.get (reference)"];
const NOISE_FLOOR_NS = 50;

const key = (row) => `${row.group}/${row.name}`;

/** The middle value (the mean of the two middle ones for an even count). */
export function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param baseline Rows `{ group, name, <column>: ns }`.
 * @param current Rows `{ group, name, ns }`.
 * @returns `{ factor, regressions, compared }`: the machine factor, the rows more than
 *   `threshold` slower than the baseline after scaling, and how many rows were compared.
 */
export function compare(baseline, current, column, threshold = 0.15) {
    const now = new Map(current.map((row) => [key(row), row.ns]));
    const ratios = [];
    for (const row of baseline) {
        if (!REFERENCE_ROWS.includes(row.name)) continue;
        const ns = now.get(key(row));
        if (typeof ns === "number" && row[column] > 0)
            ratios.push(ns / row[column]);
    }
    // Without reference rows the machines are assumed equal.
    const factor = ratios.length ? median(ratios) : 1;
    const regressions = [];
    let compared = 0;
    for (const row of baseline) {
        const expected = row[column];
        const ns = now.get(key(row));
        if (
            REFERENCE_ROWS.includes(row.name) ||
            typeof expected !== "number" ||
            expected < NOISE_FLOOR_NS ||
            typeof ns !== "number"
        )
            continue;
        compared++;
        const ratio = ns / (expected * factor);
        if (ratio > 1 + threshold)
            regressions.push({
                group: row.group,
                name: row.name,
                baseline: expected * factor,
                current: ns,
                ratio,
            });
    }
    regressions.sort((a, b) => b.ratio - a.ratio);
    return { factor, regressions, compared };
}

/** Median `ns` per row over several runs of the benchmark. */
export function medians(runs) {
    const byKey = new Map();
    for (const run of runs)
        for (const row of run) {
            if (typeof row.ns !== "number") continue;
            const entry = byKey.get(key(row)) ?? { ...row, samples: [] };
            entry.samples.push(row.ns);
            byKey.set(key(row), entry);
        }
    return [...byKey.values()].map(({ samples, ...row }) => ({
        ...row,
        ns: median(samples),
    }));
}
