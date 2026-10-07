import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Collection } from "../packages/collection/src/index.ts";

afterEach(() => setSystemTime());

/** Deterministic pseudo-random numbers, so a failure can be replayed. */
function random(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0;
        return state / 2 ** 32;
    };
}

type Config = { ttl?: number; maxSize?: number; slide?: boolean };

/** The documented behaviour of Collection, written for clarity instead of speed. */
class Model {
    readonly data = new Map<number, number>();
    readonly timing = new Map<number, { window: number; deadline: number }>();
    /** `set()` keys, oldest first; only used with `maxSize`. */
    lru: number[] = [];
    now = 1_000_000;

    constructor(readonly config: Config) {}

    #drop(key: number): void {
        this.data.delete(key);
        this.timing.delete(key);
        this.lru = this.lru.filter((k) => k !== key);
    }

    #due(key: number): boolean {
        const timing = this.timing.get(key);
        return timing !== undefined && timing.deadline <= this.now;
    }

    #expireIfDue(key: number): boolean {
        if (!this.#due(key)) return false;
        this.#drop(key);
        return true;
    }

    #purge(): void {
        for (const key of [...this.timing.keys()])
            if (this.#due(key)) this.#drop(key);
    }

    #promote(key: number): void {
        this.lru = this.lru.filter((k) => k !== key);
        this.lru.push(key);
    }

    set(key: number, value: number, ttl?: number): void {
        const window = ttl ?? this.config.ttl;
        this.data.set(key, value);
        if (window !== undefined)
            this.timing.set(key, { window, deadline: this.now + window });
        else this.timing.delete(key);
        const max = this.config.maxSize;
        if (max === undefined) return;
        this.#promote(key);
        if (this.lru.length > max) this.#purge();
        while (this.lru.length > max) this.#drop(this.lru[0]!);
    }

    setWithoutTTL(key: number, value: number): void {
        this.timing.delete(key);
        this.lru = this.lru.filter((k) => k !== key);
        this.data.set(key, value);
    }

    get(key: number): number | undefined {
        if (this.#expireIfDue(key)) return undefined;
        if (!this.data.has(key)) return undefined;
        const timing = this.timing.get(key);
        if (timing && this.config.slide !== false)
            timing.deadline = this.now + timing.window;
        if (this.lru.includes(key)) this.#promote(key);
        return this.data.get(key);
    }

    ensure(key: number, value: number): number {
        const existing = this.get(key);
        if (existing !== undefined || this.data.has(key)) return existing!;
        this.set(key, value);
        return value;
    }

    peek(key: number): number | undefined {
        return this.#expireIfDue(key) ? undefined : this.data.get(key);
    }

    has(key: number): boolean {
        return !this.#expireIfDue(key) && this.data.has(key);
    }

    delete(key: number): boolean {
        if (this.#expireIfDue(key)) return false;
        const had = this.data.has(key);
        this.#drop(key);
        return had;
    }

    keys(): number[] {
        this.#purge();
        return [...this.data.keys()];
    }
}

const configs: Config[] = [
    {},
    { ttl: 50 },
    { maxSize: 4 },
    { ttl: 50, maxSize: 4 },
    { maxSize: 1 },
    { ttl: 50, maxSize: 4, slide: false },
    { ttl: 50, slide: false },
];

describe("Collection against a plain model", () => {
    for (const config of configs)
        test(`random operations agree (${JSON.stringify(config)})`, () => {
            for (let seed = 1; seed <= 25; seed++) {
                const next = random(seed);
                const model = new Model(config);
                setSystemTime(new Date(model.now));
                const real = new Collection<number, number>(null, config);
                for (let step = 0; step < 300; step++) {
                    const key = Math.floor(next() * 7);
                    const value = Math.floor(next() * 1000);
                    const op = Math.floor(next() * 11);
                    const at = `seed ${seed} step ${step} op ${op} key ${key}`;
                    if (op < 3) {
                        const ttl =
                            next() < 0.3
                                ? 1 + Math.floor(next() * 120)
                                : undefined;
                        model.set(key, value, ttl);
                        real.set(key, value, ttl);
                    } else if (op === 3) {
                        model.setWithoutTTL(key, value);
                        real.setWithoutTTL(key, value);
                    } else if (op === 4 || op === 5) {
                        expect(real.get(key), at).toBe(model.get(key));
                    } else if (op === 6) {
                        expect(real.peek(key), at).toBe(model.peek(key));
                    } else if (op === 7) {
                        expect(real.has(key), at).toBe(model.has(key));
                    } else if (op === 10) {
                        expect(
                            real.ensure(key, () => value),
                            at,
                        ).toBe(model.ensure(key, value));
                    } else if (op === 8) {
                        expect(real.delete(key), at).toBe(model.delete(key));
                    } else {
                        model.now += Math.floor(next() * 80);
                        setSystemTime(new Date(model.now));
                    }
                    if (step % 7 === 0)
                        expect([...real.keys()], at).toEqual(model.keys());
                }
                expect([...real.keys()], `seed ${seed} end`).toEqual(
                    model.keys(),
                );
                real.clear();
            }
        });
});
