/**
 * Collection micro-benchmark: `bun benchmarks/collection.ts`.
 * Compares a plain Map, discord.js's Collection (@discordjs/collection) and
 * Lunibee's Collection in its modes. Each figure is the median of several
 * runs, with a garbage collection before each.
 */
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { Collection as DiscordJS } from "@discordjs/collection";
import { Collection } from "../packages/collection/src/index.ts";

const N = 200_000;
const SMALL = 1_000;
const RUNS = 9;
const keys = Array.from({ length: N }, (_, i) => `k${i}`);
/** Results land here so the engine cannot drop a read as dead code. */
let sink: unknown;

/** Median nanoseconds per operation over `RUNS` runs of `fn`, which performs `ops` operations. */
function measure(ops: number, fn: () => void): number {
    fn();
    const times: number[] = [];
    for (let run = 0; run < RUNS; run++) {
        Bun.gc(true);
        const start = performance.now();
        fn();
        times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return (times[RUNS >> 1]! * 1e6) / ops;
}

function report(group: string, rows: [string, number][]): void {
    console.log(`\n${group}`);
    const fastest = Math.min(...rows.map(([, ns]) => ns));
    for (const [name, ns] of rows)
        console.log(
            `  ${name.padEnd(36)} ${ns.toFixed(1).padStart(9)} ns/op  ${(ns / fastest).toFixed(1).padStart(5)}x`,
        );
}

type Store = Map<string, number>;
const makers: [string, () => Store][] = [
    ["Map", () => new Map()],
    ["discord.js Collection", () => new DiscordJS<string, number>()],
    ["Lunibee Collection", () => new Collection<string, number>()],
    ["Lunibee, ttl", () => new Collection<string, number>(null, { ttl: 60_000 })],
    [
        "Lunibee, maxSize (evicting)",
        () => new Collection<string, number>(null, { maxSize: N / 2 }),
    ],
    [
        "Lunibee, ttl + maxSize (evicting)",
        () =>
            new Collection<string, number>(null, {
                ttl: 60_000,
                maxSize: N / 2,
            }),
    ],
];

function filled(make: () => Store, count = N): Store {
    const store = make();
    for (let i = 0; i < count; i++) store.set(keys[i]!, i);
    return store;
}

report(
    `set, ${N} new keys`,
    makers.map(([name, make]) => [
        name,
        measure(N, () => {
            const store = make();
            for (let i = 0; i < N; i++) store.set(keys[i]!, i);
            if (store instanceof Collection) store.clear();
        }),
    ]),
);

report(
    `get, ${N} hits`,
    makers.map(([name, make]) => {
        const store = filled(make, N / 2);
        return [
            name,
            measure(N / 2, () => {
                for (let i = 0; i < N / 2; i++) sink = store.get(keys[i]!);
            }),
        ];
    }),
);

const scans: [string, () => Store][] = [
    ["discord.js Collection", () => filled(() => new DiscordJS(), SMALL)],
    ["Lunibee Collection", () => filled(() => new Collection(), SMALL)],
];
const scanOps: [string, (store: never) => unknown][] = [
    ["filter", (c: DiscordJS<string, number>) => c.filter((v) => v % 2 === 0)],
    ["find (last match)", (c: DiscordJS<string, number>) => c.find((v) => v === SMALL - 1)],
    ["random", (c: DiscordJS<string, number>) => c.random()],
    ["at(500)", (c: DiscordJS<string, number>) => c.at(500)],
];
for (const [op, run] of scanOps)
    report(
        `${op}, ${SMALL} entries`,
        scans.map(([name, make]) => {
            const store = make();
            return [
                name,
                measure(1_000, () => {
                    for (let i = 0; i < 1_000; i++) sink = run(store as never);
                }),
            ];
        }),
    );

console.log("\nempty instance (shallow bytes, bun:jsc)");
for (const [name, make] of [
    ["Map", () => new Map()],
    ["discord.js Collection", () => new DiscordJS()],
    ["Lunibee Collection", () => new Collection()],
] as const)
    console.log(
        `  ${name.padEnd(36)} ${String(estimateShallowMemoryUsageOf(make())).padStart(9)} B`,
    );
