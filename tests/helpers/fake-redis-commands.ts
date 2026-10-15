/**
 * An in-memory Redis that answers `send(command, args)` for the commands
 * `RedisCache` uses, with expiry and fault injection.
 */
export function createCommandRedis() {
    const strings = new Map<string, string>();
    const hashes = new Map<string, Map<string, string>>();
    const sets = new Map<string, Set<string>>();
    const expiry = new Map<string, number>();
    const ops = new Map<string, number>();
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
