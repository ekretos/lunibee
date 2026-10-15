/**
 * An in-memory Redis for unit tests. Commands on one instance are atomic (one
 * JavaScript turn each), every client shares the same data, keys expire, and
 * EVAL runs the RedisRateLimitStore scripts through the same JS functions the
 * Lua ports — so unit tests exercise the store's TypeScript paths, and the
 * Lua itself is checked against real Redis in tests/integration.
 */
import {
    EXTEND_GLOBAL_SCRIPT,
    RECONCILE_SCRIPT,
    RELEASE_SCRIPT,
    RESERVE_SCRIPT,
    type MinimalRedisClient,
} from "../../packages/rest/src/redis.ts";
import {
    reconcileState,
    reserveState,
    type BucketState,
} from "../../packages/rest/src/store.ts";

export interface FakeRedis {
    /** A new client connection to this server. */
    client(options?: { eval?: boolean }): MinimalRedisClient;
    /** Makes every command fail (`"error"`), hang (`"hang"`), or work again (`undefined`). */
    fault: "error" | "hang" | undefined;
    /** Shifts the server clock. */
    skewMs: number;
    /** Commands run, by name. */
    readonly ops: Map<string, number>;
    readonly data: Map<string, { value: string; expiresAt: number }>;
    /** Forgets everything (a restart without persistence). */
    flush(): void;
}

export function createFakeRedis(): FakeRedis {
    const data = new Map<string, { value: string; expiresAt: number }>();
    const ops = new Map<string, number>();
    const server: FakeRedis = {
        fault: undefined,
        skewMs: 0,
        ops,
        data,
        flush: () => data.clear(),
        client: (options = {}) => {
            const c: MinimalRedisClient = {
                get: (key) => run("GET", () => get(key)),
                mget: (keys) => run("MGET", () => keys.map(get)),
                set: (key, value, mode, duration) =>
                    run("SET", () => {
                        set(key, String(value), mode, duration);
                        return "OK";
                    }),
                del: (...keys) =>
                    run("DEL", () => keys.filter((k) => data.delete(k)).length),
            };
            if (options.eval !== false)
                c.eval = (script, numKeys, ...args) =>
                    run("EVAL", () =>
                        evaluate(
                            script,
                            args.slice(0, numKeys).map(String),
                            args.slice(numKeys).map(String),
                        ),
                    );
            return c;
        },
    };
    const now = (): number => Date.now() + server.skewMs;
    async function run<T>(name: string, fn: () => T): Promise<T> {
        ops.set(name, (ops.get(name) ?? 0) + 1);
        await Promise.resolve();
        if (server.fault === "error")
            throw new Error("ECONNREFUSED fake redis");
        if (server.fault === "hang") return new Promise<T>(() => {});
        return fn();
    }
    function get(key: string): string | null {
        const entry = data.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= now()) {
            data.delete(key);
            return null;
        }
        return entry.value;
    }
    function set(
        key: string,
        value: string,
        mode?: string,
        duration?: number,
    ): void {
        const m = mode?.toUpperCase();
        const expiresAt =
            m === "EX"
                ? now() + Number(duration) * 1000
                : m === "PX"
                  ? now() + Number(duration)
                  : m === "KEEPTTL"
                    ? (data.get(key)?.expiresAt ?? Infinity)
                    : Infinity;
        data.set(key, { value, expiresAt });
    }
    function load(key: string): BucketState | undefined {
        const raw = get(key);
        if (!raw) return undefined;
        try {
            const s = JSON.parse(raw) as BucketState;
            return typeof s.resetAt === "number" &&
                typeof s.remaining === "number"
                ? s
                : undefined;
        } catch {
            return undefined;
        }
    }
    function save(
        key: string,
        s: BucketState,
        t: number,
        linger: number,
    ): void {
        set(
            key,
            JSON.stringify(s),
            "PX",
            Math.max(1, Math.ceil(s.resetAt - t)) + linger,
        );
    }
    function num(v: string | undefined): number | undefined {
        return v === undefined || v === "" ? undefined : Number(v);
    }
    function evaluate(script: string, keys: string[], argv: string[]): unknown {
        const t = now();
        if (script === RESERVE_SCRIPT) {
            if (keys[1] !== undefined) {
                const g = Number(get(keys[1]) ?? 0);
                if (g > t) return [0, Math.ceil(g - t), "global"];
            }
            const { reservation, next } = reserveState(
                load(keys[0]!),
                t,
                Number(argv[0]),
            );
            if (next) save(keys[0]!, next, t, next.probe ? 0 : Number(argv[2]));
            return reservation.granted
                ? [1, reservation.resetAt, reservation.known ? 1 : 0]
                : [0, Math.ceil(reservation.retryAfterMs), reservation.reason];
        }
        if (script === RECONCILE_SCRIPT) {
            const next = reconcileState(
                load(keys[0]!),
                {
                    remaining: num(argv[0]),
                    resetAfterMs: num(argv[1]),
                    limit: num(argv[2]),
                    window: num(argv[3]),
                    retryAfterMs: num(argv[4]),
                },
                t,
            );
            if (next === null) data.delete(keys[0]!);
            else if (next) save(keys[0]!, next, t, Number(argv[5]));
            return next ? 1 : 0;
        }
        if (script === EXTEND_GLOBAL_SCRIPT) {
            const target = Math.ceil(t + Number(argv[0]));
            const cur = Number(get(keys[0]!) ?? 0);
            if (target > cur) {
                set(keys[0]!, String(target), "PX", Math.max(1, target - t));
                return target - t;
            }
            return Math.max(0, cur - t);
        }
        if (script === RELEASE_SCRIPT) {
            const s = load(keys[0]!);
            if (!s || s.resetAt !== Number(argv[0])) return 0;
            if (s.probe) {
                data.delete(keys[0]!);
                return 1;
            }
            if (argv[1] === "1") {
                s.remaining = Math.min(s.remaining + 1, s.limit ?? Infinity);
                set(keys[0]!, JSON.stringify(s), "KEEPTTL");
                return 1;
            }
            return 0;
        }
        if (script.includes("TIME")) return String(Math.floor(t / 1000));
        throw new Error("ERR unknown script");
    }
    return server;
}
