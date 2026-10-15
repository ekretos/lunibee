/**
 * RedisCache against a real Redis, through `Bun.RedisClient` as it is.
 * Skipped unless REDIS_URL is set.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { RedisCache } from "../../packages/core/src/index.ts";

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)("RedisCache on a real Redis", () => {
    const writer = REDIS_URL ? new Bun.RedisClient(REDIS_URL) : undefined;
    const reader = REDIS_URL ? new Bun.RedisClient(REDIS_URL) : undefined;
    afterAll(() => {
        writer?.close();
        reader?.close();
    });

    test("one process writes, another reads, a leave cleans up", async () => {
        const prefix = `lunibee:it:${crypto.randomUUID()}:`;
        const a = new RedisCache({ client: writer!, prefix, ttlSeconds: 600 });
        const b = new RedisCache({ client: reader!, prefix });
        const G = "100000000000000001";
        a.handle("GUILD_CREATE", {
            id: G,
            name: "g",
            roles: [{ id: "300000000000000001", name: "r" }],
            channels: [{ id: "200000000000000001", type: 0 }],
            members: Array.from({ length: 1500 }, (_, i) => ({
                user: {
                    id: String(400000000000000000n + BigInt(i)),
                    username: `u${i}`,
                },
                roles: [],
            })),
        });
        a.handle("GUILD_MEMBER_UPDATE", {
            guild_id: G,
            user: { id: "400000000000000000", username: "renamed" },
            nick: "n",
        });
        await a.flush();
        expect(a.diagnostics().failures).toBe(0);
        expect(await b.guild(G)).toEqual({ id: G, name: "g" });
        expect(await b.guildIds()).toEqual([G]);
        expect(await b.roles(G)).toHaveLength(1);
        expect(await b.channel("200000000000000001")).toMatchObject({
            guild_id: G,
        });
        expect(await b.members(G)).toHaveLength(1500);
        expect(await b.member(G, "400000000000000000")).toMatchObject({
            nick: "n",
            user: { username: "renamed" },
        });
        const ttl = Number(
            await reader!.send("TTL", [`${prefix}v1:guild:${G}:members`]),
        );
        expect(ttl).toBeGreaterThan(0);

        a.handle("GUILD_DELETE", { id: G });
        await a.flush();
        expect(await b.guild(G)).toBeUndefined();
        expect(await b.channels(G)).toEqual([]);
        expect(await b.channel("200000000000000001")).toBeUndefined();
        // Users outlive the guild (they may be in others) and expire by TTL.
        expect(await b.user("400000000000000001")).toMatchObject({
            username: "u1",
        });
    });
});
