/**
 * Collection micro-benchmark: `bun benchmarks/collection.ts`.
 * Compares a plain Map, discord.js's Collection (@discordjs/collection) and
 * Lunibee's Collection in its modes. Each figure is the best of several
 * interleaved runs, with a garbage collection before each.
 */
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { Collection as DiscordJS } from "@discordjs/collection";
import { Collection } from "../packages/collection/src/index.ts";

const N = 200_000;
const SMALL = 1_000;
const RUNS = 15;
const keys = Array.from({ length: N }, (_, i) => `k${i}`);
/** Results land here so the engine cannot drop a read as dead code. */
let sink: unknown;

/**
 * Best nanoseconds per operation for each contender. Contenders take turns
 * within every round, so a slow moment on a busy machine hits all of them,
 * and the fastest run is kept because noise only ever slows a run down.
 */
function measureAll(
    ops: number,
    contenders: [name: string, fn: () => void][],
): [string, number][] {
    for (const [, fn] of contenders) fn();
    const best = contenders.map(() => Infinity);
    for (let run = 0; run < RUNS; run++)
        contenders.forEach(([, fn], index) => {
            Bun.gc(true);
            const start = performance.now();
            fn();
            best[index] = Math.min(best[index]!, performance.now() - start);
        });
    return contenders.map(([name], index) => [
        name,
        (best[index]! * 1e6) / ops,
    ]);
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
    measureAll(
        N,
        makers.map(([name, make]) => [
            name,
            () => {
                const store = make();
                for (let i = 0; i < N; i++) store.set(keys[i]!, i);
                if (store instanceof Collection) store.clear();
            },
        ]),
    ),
);

const readable = makers.map(([name, make]) => [name, filled(make, N / 2)] as const);
report(
    `get, ${N / 2} hits`,
    measureAll(
        N / 2,
        readable.map(([name, store]) => [
            name,
            () => {
                for (let i = 0; i < N / 2; i++) sink = store.get(keys[i]!);
            },
        ]),
    ),
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
const scanStores = scans.map(([name, make]) => [name, make()] as const);
for (const [op, run] of scanOps)
    report(
        `${op}, ${SMALL} entries`,
        measureAll(
            1_000,
            scanStores.map(([name, store]) => [
                name,
                () => {
                    for (let i = 0; i < 1_000; i++) sink = run(store as never);
                },
            ]),
        ),
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
