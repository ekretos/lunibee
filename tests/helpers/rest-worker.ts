/**
 * One REST instance in its own process, for benchmarks/rest-distributed.ts and tests/integration.
 * Prints a JSON summary line on stdout.
 *
 *   bun tests/helpers/rest-worker.ts <config-json>
 */
import {
    HttpTransport,
    REST,
    RedisRateLimitStore,
} from "../../packages/rest/src/index.ts";

const cfg = JSON.parse(process.argv[2]!) as {
    url: string;
    redis?: string;
    prefix: string;
    token: string;
    buckets: number;
    perBucket: number;
    /** Requests per second for the bot; omitted: no proactive global limit. */
    globalLimit?: number;
};
let redisOps = 0;
let store: RedisRateLimitStore | undefined;
let client: InstanceType<typeof Bun.RedisClient> | undefined;
if (cfg.redis) {
    client = new Bun.RedisClient(cfg.redis);
    await client.connect();
    const c = client;
    const count = <T>(p: Promise<T>): Promise<T> => {
        redisOps++;
        return p;
    };
    store = new RedisRateLimitStore({
        prefix: cfg.prefix,
        client: {
            get: (k) => count(c.get(k)),
            mget: (ks) =>
                count(c.send("MGET", ks) as Promise<Array<string | null>>),
            set: (k, v, m?, d?) =>
                count(
                    c.send(
                        "SET",
                        m ? [k, String(v), m, String(d)] : [k, String(v)],
                    ) as Promise<string | null>,
                ),
            del: (...ks) => count(c.send("DEL", ks) as Promise<number>),
            eval: (s, n, ...a) =>
                count(c.send("EVAL", [s, String(n), ...a.map(String)])),
        },
    });
}
const rest = new REST({
    token: cfg.token,
    retries: 20,
    globalLimit: cfg.globalLimit ?? false,
    store,
    transport: new HttpTransport({
        baseURL: cfg.url,
        fetch: (i, init) => fetch(i, init),
    }),
});
const latencies: number[] = [];
let errors = 0;
const started = performance.now();
const work: Promise<void>[] = [];
for (let b = 0; b < cfg.buckets; b++)
    for (let i = 0; i < cfg.perBucket; i++) {
        const t0 = performance.now();
        work.push(
            rest.post(`/channels/${1000 + b}/messages`, { content: "x" }).then(
                () => void latencies.push(performance.now() - t0),
                (error: unknown) => {
                    errors++;
                    console.error("request failed:", String(error));
                },
            ),
        );
    }
await Promise.all(work);
const durationMs = performance.now() - started;
console.log(
    JSON.stringify({
        durationMs,
        latencies,
        errors,
        redisOps,
        rssMB: process.memoryUsage().rss / 1048576,
    }),
);
client?.close();
