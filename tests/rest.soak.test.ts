import { describe, expect, test } from "bun:test";
import { REST } from "../packages/rest/src/index.ts";
import { fakeDiscord } from "./helpers/fake-discord.ts";

async function flood(
    options: { concurrentBuckets?: boolean },
    channels: number,
    perChannel: number,
    limit: number,
) {
    const { transport, stats } = fakeDiscord({
        limit,
        windowMs: 100,
        latencyMs: 2,
    });
    const rest = new REST({ token: "t", transport, ...options });
    const jobs: Promise<unknown>[] = [];
    for (let channel = 0; channel < channels; channel++)
        for (let i = 0; i < perChannel; i++)
            jobs.push(
                rest.post(`/channels/${100 + channel}/messages`, {
                    content: "x",
                }),
            );
    await Promise.all(jobs);
    return stats;
}

describe("REST bucket scheduling under load", () => {
    test("concurrent buckets are the default and spend a bucket's allowance in parallel", async () => {
        const stats = await flood({}, 4, 40, 10);
        expect(stats.requests).toBe(160 + stats.rateLimited);
        expect(stats.peak).toBeGreaterThan(4);
    });

    test("concurrentBuckets: false keeps one request per bucket in flight", async () => {
        const stats = await flood({ concurrentBuckets: false }, 4, 20, 10);
        expect(stats.peak).toBeLessThanOrEqual(4);
        expect(stats.rateLimited).toBe(0);
    });

    test("10,000 requests across shared buckets are not rate limited beyond the slack", async () => {
        const stats = await flood({}, 20, 500, 50);
        expect(stats.requests - stats.rateLimited).toBe(10_000);
        // Discord tolerates a little overshoot at a window edge; the scheduler
        // must not lean on 429s to find the limit.
        expect(stats.rateLimited).toBeLessThanOrEqual(10_000 * 0.01);
    }, 30_000);
});
