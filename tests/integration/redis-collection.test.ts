/**
 * RedisCollection against a real Redis (the Lua scripts), with the same
 * behaviour suite the unit tests run on the fake. Skipped unless REDIS_URL is set.
 */
import { afterAll, describe } from "bun:test";
import { redisCollectionSuite } from "../shared/redis-collection-suite.ts";

const REDIS_URL = process.env.REDIS_URL;
const clients: Array<InstanceType<typeof Bun.RedisClient>> = [];
afterAll(() => {
    for (const c of clients) c.close();
});

describe.skipIf(!REDIS_URL)("RedisCollection on a real Redis", () => {
    redisCollectionSuite(
        () => {
            // A connection per instance, the way separate processes would.
            const client = new Bun.RedisClient(REDIS_URL!);
            clients.push(client);
            return client;
        },
        (ms) => Bun.sleep(ms),
    );
});
