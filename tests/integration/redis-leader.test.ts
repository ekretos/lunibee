/**
 * RedisLeaderLock against a real Redis, through `Bun.RedisClient` as it is.
 * Skipped unless REDIS_URL is set.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { RedisLeaderLock } from "../../packages/sharding/src/index.ts";

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("RedisLeaderLock on a real Redis", () => {
    const one = REDIS_URL ? new Bun.RedisClient(REDIS_URL) : undefined;
    const two = REDIS_URL ? new Bun.RedisClient(REDIS_URL) : undefined;
    afterAll(() => {
        one?.close();
        two?.close();
    });

    test("one holder across connections; renew, expire and release", async () => {
        const key = `lunibee:it:${crypto.randomUUID()}:leader`;
        const a = new RedisLeaderLock({ client: one!, key });
        const b = new RedisLeaderLock({ client: two!, key });
        const results = await Promise.all(
            Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).acquire(300)),
        );
        // Whoever won, the other never also holds it.
        const aWon = await a.acquire(300);
        const bWon = await b.acquire(300);
        expect(aWon !== bWon).toBe(true);
        expect(results.includes(true)).toBe(true);
        const [holder, other] = aWon ? [a, b] : [b, a];
        await other.release();
        expect(await other.acquire(300)).toBe(false);
        await Bun.sleep(350);
        expect(await other.acquire(300)).toBe(true);
        expect(await holder.acquire(300)).toBe(false);
        await other.release();
        expect(await holder.acquire(300)).toBe(true);
        await holder.release();
    });
});
