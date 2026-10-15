/**
 * REST coordination across processes, against a fake Discord that enforces
 * real windows and counts every request it had to reject (an overshoot).
 * Each REST instance runs in its own Bun process with its own Redis
 * connection; Redis must be reachable at REDIS_URL for the Redis rows.
 *
 *   REDIS_URL=redis://127.0.0.1:6379 bun benchmarks/rest-distributed.ts
 */
import { startFakeDiscord } from "../tests/helpers/fake-discord-server.ts";

const LIMIT = Number(process.env.LIMIT ?? 5);
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 200);
const BUCKETS = Number(process.env.BUCKETS ?? 4);
const PER_BUCKET = Number(process.env.PER_BUCKET ?? 25);
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 5);
const REDIS = process.env.REDIS_URL;

const discord = startFakeDiscord({
    limit: LIMIT,
    windowMs: WINDOW_MS,
    latencyMs: LATENCY_MS,
});

interface Result {
    durationMs: number;
    latencies: number[];
    errors: number;
    redisOps: number;
    rssMB: number;
}

async function scenario(
    name: string,
    processes: number,
    tokens: number,
    redis: boolean,
) {
    discord.reset();
    const prefix = `lunibee:bench:${crypto.randomUUID()}:`;
    const started = performance.now();
    const results = await Promise.all(
        Array.from({ length: processes }, async (_, i) => {
            const proc = Bun.spawn(
                [
                    "bun",
                    `${import.meta.dir}/../tests/helpers/rest-worker.ts`,
                    JSON.stringify({
                        url: discord.url,
                        redis: redis ? REDIS : undefined,
                        prefix,
                        token: `bench.token.${i % tokens}`,
                        buckets: BUCKETS,
                        perBucket: PER_BUCKET,
                    }),
                ],
                { stdout: "pipe", stderr: "inherit" },
            );
            const out = await new Response(proc.stdout).text();
            await proc.exited;
            return JSON.parse(out.trim().split("\n").at(-1)!) as Result;
        }),
    );
    const wall = performance.now() - started;
    const lat = results.flatMap((r) => r.latencies).sort((a, b) => a - b);
    const pct = (p: number) =>
        lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] ?? 0;
    const total = processes * BUCKETS * PER_BUCKET;
    const ops = results.reduce((s, r) => s + r.redisOps, 0);
    const errors = results.reduce((s, r) => s + r.errors, 0);
    // The floor: each (token, bucket) pair needs ceil(n / LIMIT) windows.
    console.log(
        [
            name.padEnd(30),
            `${wall.toFixed(0).padStart(6)} ms`,
            `${String(discord.stats.bucket429 + discord.stats.global429).padStart(4)} 429`,
            `${String(errors).padStart(3)} err`,
            `p50 ${pct(50).toFixed(0).padStart(5)}`,
            `p95 ${pct(95).toFixed(0).padStart(5)}`,
            `p99 ${pct(99).toFixed(0).padStart(5)} ms`,
            `${(ops / total).toFixed(2).padStart(5)} redis ops/req`,
            `${Math.max(...results.map((r) => r.rssMB)).toFixed(0)} MB rss`,
        ].join("  "),
    );
}

console.log(
    `${BUCKETS} buckets x ${PER_BUCKET} requests per process, limit ${LIMIT} per ${WINDOW_MS} ms, ${LATENCY_MS} ms latency, bun ${Bun.version}`,
);
await scenario("1 process, memory", 1, 1, false);
await scenario("4 processes, memory (no coord)", 4, 1, false);
if (REDIS) {
    await scenario("1 process, redis", 1, 1, true);
    await scenario("4 processes, redis, 1 token", 4, 1, true);
    await scenario("4 processes, redis, 2 tokens", 4, 2, true);
} else console.log("REDIS_URL not set: Redis rows skipped.");
discord.stop();
