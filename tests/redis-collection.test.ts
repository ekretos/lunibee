import { describe, expect, test } from "bun:test";
import { RedisCollection } from "../packages/collection/src/index.ts";
import { createCommandRedis } from "./helpers/fake-redis-commands.ts";
import { redisCollectionSuite } from "./shared/redis-collection-suite.ts";

const redis = createCommandRedis();

describe("RedisCollection (in-memory fake)", () => {
    redisCollectionSuite(
        () => redis.client,
        (ms) => Bun.sleep(ms),
    );

    test("options are validated", () => {
        const client = redis.client;
        expect(() => new RedisCollection({ client, name: "" })).toThrow(
            TypeError,
        );
        expect(() => new RedisCollection({ client, name: "a b" })).toThrow(
            TypeError,
        );
        expect(
            () => new RedisCollection({ client, name: "n", ttl: 0 }),
        ).toThrow(RangeError);
        expect(
            () => new RedisCollection({ client, name: "n", ttl: -1 }),
        ).toThrow(RangeError);
        expect(
            () => new RedisCollection({ client, name: "n", maxSize: 0 }),
        ).toThrow(RangeError);
        const c = new RedisCollection({ client, name: "n" });
        expect(c.set("k", 1, Number.NaN)).rejects.toThrow(RangeError);
    });

    test("keys live under one versioned, hash-tagged prefix", async () => {
        const c = new RedisCollection({ client: redis.client, name: "tagged" });
        await c.set("k", 1);
        expect(
            redis
                .keys()
                .some((k) => k === "lunibee:collection:v1:{tagged}:e:k"),
        ).toBe(true);
    });

    test("a throwing onEvict or an undecodable value does not break it", async () => {
        const c = new RedisCollection<number>({
            client: redis.client,
            name: "loud",
            maxSize: 1,
            serializer: {
                serialize: String,
                deserialize: (raw) => {
                    if (raw === "bad") throw new Error("decode");
                    return Number(raw);
                },
            },
            onEvict: () => {
                throw new Error("listener");
            },
        });
        await c.set("a", "bad" as unknown as number);
        await c.set("b", 2);
        expect(c.stats.evicted).toBe(1);
        expect(await c.get("b")).toBe(2);
    });

    test("an unexpected reply is an error", async () => {
        const c = new RedisCollection({
            client: { send: async () => "OK" },
            name: "odd",
        });
        expect(c.get("k")).rejects.toThrow("Unexpected reply");
    });
});
