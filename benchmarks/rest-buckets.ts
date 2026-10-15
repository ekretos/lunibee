/**
 * REST bucket scheduling: sequential (`concurrentBuckets: false`) against
 * concurrent (the default), with a fake Discord that enforces real rate-limit
 * windows and answers after a fixed latency.
 *
 *   bun benchmarks/rest-buckets.ts
 */
import { HttpTransport, REST } from "../packages/rest/src/index.ts";

const LATENCY_MS = 20;
const LIMIT = 5;
const WINDOW_MS = 250;
const BUCKETS = 4;
const REQUESTS_PER_BUCKET = 20;

/** A fake Discord: `LIMIT` requests per bucket per `WINDOW_MS`, then 429. */
function fakeDiscord() {
    const windows = new Map<string, { start: number; used: number }>();
    let limited = 0;
    const fetch = async (url: string): Promise<Response> => {
        await Bun.sleep(LATENCY_MS);
        const bucket = /channels\/(\d+)/.exec(url)?.[1] ?? "x";
        const now = Date.now();
        let w = windows.get(bucket);
        if (!w || now - w.start >= WINDOW_MS) {
            w = { start: now, used: 0 };
            windows.set(bucket, w);
        }
        const resetAfter = Math.max(0, w.start + WINDOW_MS - now) / 1000;
        const headers = {
            "content-type": "application/json",
            "x-ratelimit-bucket": `hash-${bucket}`,
            "x-ratelimit-limit": String(LIMIT),
            "x-ratelimit-reset-after": resetAfter.toFixed(3),
        };
        if (w.used >= LIMIT) {
            limited++;
            return new Response(
                JSON.stringify({
                    message: "rate limited",
                    retry_after: resetAfter,
                    global: false,
                }),
                {
                    status: 429,
                    headers: {
                        ...headers,
                        "x-ratelimit-remaining": "0",
                        "retry-after": resetAfter.toFixed(3),
                    },
                },
            );
        }
        w.used++;
        return new Response("{}", {
            status: 200,
            headers: {
                ...headers,
                "x-ratelimit-remaining": String(LIMIT - w.used),
            },
        });
    };
    return { fetch, limited: () => limited };
}

async function run(concurrentBuckets: boolean) {
    const discord = fakeDiscord();
    const rest = new REST({
        token: "bench.token.value-0123456789",
        concurrentBuckets,
        retries: 10,
        // Bucket scheduling only; the global limit is not what is measured.
        globalLimit: false,
        transport: new HttpTransport({ fetch: discord.fetch as never }),
    });
    const started = performance.now();
    const work: Promise<unknown>[] = [];
    for (let b = 0; b < BUCKETS; b++)
        for (let i = 0; i < REQUESTS_PER_BUCKET; i++)
            work.push(rest.get(`/channels/10000000000000000${b}/messages`));
    await Promise.all(work);
    return { ms: performance.now() - started, limited: discord.limited() };
}

const sequential = await run(false);
const concurrent = await run(true);
const total = BUCKETS * REQUESTS_PER_BUCKET;
const row = (name: string, r: { ms: number; limited: number }) =>
    `${name.padEnd(12)} ${r.ms.toFixed(0).padStart(7)} ms   ${String(r.limited).padStart(4)} 429s   ${(total / (r.ms / 1000)).toFixed(0).padStart(5)} req/s`;
console.log(
    `${total} requests over ${BUCKETS} buckets, limit ${LIMIT} per ${WINDOW_MS} ms, ${LATENCY_MS} ms latency`,
);
console.log(row("sequential", sequential));
console.log(row("concurrent", concurrent));
