/**
 * Runs the runtime benchmark and compares it with a committed baseline.
 *
 *   bun scripts/bench-compare.mjs [--baseline docs/perf/runtime-2026-09-30.json]
 *                                 [--column bun14] [--threshold 0.15]
 *                                 [--rounds 3] [--fail]
 *
 * Needs `bun run build` first (the benchmark loads dist/). Absolute times
 * depend on the machine, so every row is first scaled by how much faster or
 * slower this machine runs the native `Map` reference rows than the baseline
 * machine did. A row regresses when it is more than `threshold` slower after
 * that scaling. Rows under 50 ns in the baseline are ignored: they are
 * mostly timer noise. The exit code is 0 unless `--fail` is passed.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { compare, medians } from "./bench-compare-lib.mjs";

function option(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : process.argv[index + 1];
}

function runOnce() {
    const result = spawnSync(
        process.execPath,
        [new URL("./bench-runtime.mjs", import.meta.url).pathname, "--json"],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.status !== 0)
        throw new Error(
            `bench-runtime failed: ${result.stderr || result.stdout}`,
        );
    return JSON.parse(result.stdout).results;
}

if (import.meta.main) {
    const baselinePath = option(
        "baseline",
        "docs/perf/runtime-2026-09-30.json",
    );
    const column = option("column", "bun14");
    const threshold = Number(option("threshold", "0.15"));
    const rounds = Number(option("rounds", "3"));
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")).results;
    const current = medians(Array.from({ length: rounds }, runOnce));
    const { factor, regressions, compared } = compare(
        baseline,
        current,
        column,
        threshold,
    );
    console.log(
        `Compared ${compared} rows with ${baselinePath} (${column}); the Map reference rows take ${factor.toFixed(2)}x the baseline's time on this machine.`,
    );
    if (regressions.length === 0)
        console.log(`No row is more than ${threshold * 100}% slower.`);
    else {
        console.log(
            `\n${regressions.length} row(s) more than ${threshold * 100}% slower (after scaling):`,
        );
        for (const row of regressions)
            console.log(
                `  ${`${row.group}/${row.name}`.padEnd(60)} ${row.baseline.toFixed(0)} ns -> ${row.current.toFixed(0)} ns (${row.ratio.toFixed(2)}x)`,
            );
        if (process.argv.includes("--fail")) process.exit(1);
    }
}
