import {
    DELETE_SCRIPT,
    GET_SCRIPT,
    LIST_SCRIPT,
    SET_SCRIPT,
} from "../../packages/collection/src/redis.ts";

/**
 * An in-memory Redis that answers `send(command, args)` for the commands
 * `RedisCache` uses and the `RedisCollection` scripts (run by a JS port of
 * each, so unit tests cover the TypeScript; tests/integration runs the Lua),
 * with expiry and fault injection.
 */
export function createCommandRedis() {
    const strings = new Map<string, string>();
    const hashes = new Map<string, Map<string, string>>();
    const sets = new Map<string, Set<string>>();
    const expiry = new Map<string, number>();
    const ops = new Map<string, number>();
    const zsets = new Map<string, Map<string, number>>();
    const counters = new Map<string, number>();
    const zset = (key: string) => {
        let z = zsets.get(key);
        if (!z) zsets.set(key, (z = new Map()));
        return z;
    };
    const ttlOf = (key: string): number => {
        if (!alive(key) || !strings.has(key)) return -2;
        const at = expiry.get(key);
        return at === undefined ? -1 : at - Date.now();
    };
    /** The RedisCollection scripts, in JS. */
    function script(source: string, keys: string[], argv: string[]): unknown {
        const [exp, lru, clock] = keys as [string, string, string];
        const ep = argv[0]!;
        const now = Date.now();
        const out: unknown[] = [];
        const get = (k: string) => (alive(k) ? (strings.get(k) ?? null) : null);
        const drop = (m: string, reason?: string) => {
            const v = get(ep + m);
            strings.delete(ep + m);
            expiry.delete(ep + m);
            zset(exp).delete(m);
            zset(lru).delete(m);
            if (reason) out.push(m, v, reason);
        };
        const touch = (m: string) => {
            const n = (counters.get(clock) ?? 0) + 1;
            counters.set(clock, n);
            zset(lru).set(m, n);
        };
        for (const [m, at] of [...zset(exp)].sort((a, b) => a[1] - b[1]))
            if (at <= now) drop(m, "expired");
        const byScore = () =>
            [...zset(lru)].sort((a, b) => a[1] - b[1]).map(([m]) => m);
        if (source === SET_SCRIPT) {
            const [, m, payload, ttlRaw, maxRaw, mode] = argv as string[];
            const ttl = Number(ttlRaw);
            const max = Number(maxRaw);
            if (mode === "nx") {
                const cur = get(ep + m!);
                if (cur) {
                    touch(m!);
                    return [cur, ...out];
                }
            }
            strings.set(ep + m, `${ttl}:${payload}`);
            if (ttl > 0) {
                expiry.set(ep + m, now + ttl + 1000);
                zset(exp).set(m!, now + ttl);
            } else {
                expiry.delete(ep + m);
                zset(exp).delete(m!);
            }
            touch(m!);
            if (max > 0) {
                let n = zset(lru).size;
                while (n > max) {
                    const victim = byScore()[0]!;
                    zset(lru).delete(victim);
                    if (victim !== m) drop(victim, "evicted");
                    n--;
                }
            }
            return [null, ...out];
        }
        if (source === GET_SCRIPT) {
            const [, m, slide, mark] = argv as string[];
            const env = get(ep + m!);
            if (!env) {
                zset(exp).delete(m!);
                zset(lru).delete(m!);
                return [null, ...out];
            }
            if (mark === "1") touch(m!);
            const ttl = Number(/^(\d+):/.exec(env)?.[1]);
            if (slide === "1" && ttl > 0) {
                expiry.set(ep + m, now + ttl + 1000);
                zset(exp).set(m!, now + ttl);
            }
            return [env, ...out];
        }
        if (source === DELETE_SCRIPT) {
            const existed = get(ep + argv[1]!) ? 1 : 0;
            drop(argv[1]!);
            return [existed, ...out];
        }
        if (source === LIST_SCRIPT) {
            const what = argv[1];
            if (what === "clear") {
                const all = byScore();
                for (const m of all) drop(m);
                zsets.delete(exp);
                zsets.delete(lru);
                counters.delete(clock);
                return [all.length];
            }
            return [what === "size" ? zset(lru).size : byScore(), ...out];
        }
        throw new Error("ERR unknown script");
    }
    const state = { fault: false };
    const alive = (key: string): boolean => {
        const at = expiry.get(key);
        if (at !== undefined && at <= Date.now()) {
            strings.delete(key);
            hashes.delete(key);
            sets.delete(key);
            expiry.delete(key);
            return false;
        }
        return true;
    };
    const hash = (key: string) => {
        alive(key);
        let h = hashes.get(key);
        if (!h) hashes.set(key, (h = new Map()));
        return h;
    };
    const client = {
        async send(command: string, args: string[]): Promise<unknown> {
            ops.set(command, (ops.get(command) ?? 0) + 1);
            await Promise.resolve();
            if (state.fault) throw new Error("ECONNREFUSED fake redis");
            const [key = ""] = args;
            switch (command) {
                case "GET":
                    return alive(key) ? (strings.get(key) ?? null) : null;
                case "MGET":
                    return args.map((k) =>
                        alive(k) ? (strings.get(k) ?? null) : null,
                    );
                case "SET":
                    strings.set(key, args[1]!);
                    if (args[2] === "EX")
                        expiry.set(key, Date.now() + Number(args[3]) * 1000);
                    else expiry.delete(key);
                    return "OK";
                case "DEL": {
                    let n = 0;
                    for (const k of args)
                        if (
                            strings.delete(k) ||
                            hashes.delete(k) ||
                            sets.delete(k)
                        )
                            n++;
                    return n;
                }
                case "EXPIRE":
                    expiry.set(key, Date.now() + Number(args[1]) * 1000);
                    return 1;
                case "HSET": {
                    const h = hash(key);
                    for (let i = 1; i < args.length; i += 2)
                        h.set(args[i]!, args[i + 1]!);
                    return 1;
                }
                case "HGET":
                    return alive(key)
                        ? (hashes.get(key)?.get(args[1]!) ?? null)
                        : null;
                case "HDEL":
                    return hashes.get(key)?.delete(args[1]!) ? 1 : 0;
                case "HVALS":
                    return alive(key)
                        ? [...(hashes.get(key)?.values() ?? [])]
                        : [];
                case "HKEYS":
                    return alive(key)
                        ? [...(hashes.get(key)?.keys() ?? [])]
                        : [];
                case "SADD": {
                    let s = sets.get(key);
                    if (!s) sets.set(key, (s = new Set()));
                    s.add(args[1]!);
                    return 1;
                }
                case "SREM":
                    return sets.get(key)?.delete(args[1]!) ? 1 : 0;
                case "SMEMBERS":
                    return [...(sets.get(key) ?? [])];
                case "EVAL": {
                    const n = Number(args[1]);
                    return script(
                        args[0]!,
                        args.slice(2, 2 + n),
                        args.slice(2 + n),
                    );
                }
                case "PTTL":
                    return ttlOf(key);
                default:
                    throw new Error(`ERR unknown command ${command}`);
            }
        },
    };
    return {
        client,
        state,
        ops,
        keys: () => [...strings.keys(), ...hashes.keys(), ...sets.keys()],
    };
}
