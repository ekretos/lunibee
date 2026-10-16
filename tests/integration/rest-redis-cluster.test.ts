/**
 * RedisRateLimitStore on a real Redis Cluster. Every script touches the bot's
 * keys together, so they must share a slot: a hash-tagged `prefix` does that.
 * Skipped unless REDIS_CLUSTER_NODES lists the nodes:
 *
 *   REDIS_CLUSTER_NODES=127.0.0.1:7001,127.0.0.1:7002,127.0.0.1:7003 bun test tests/integration
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
    HttpTransport,
    REST,
    RedisRateLimitStore,
    fromBunRedis,
} from "../../packages/rest/src/index.ts";
import { startFakeDiscord } from "../helpers/fake-discord-server.ts";

const NODES = process.env.REDIS_CLUSTER_NODES?.split(",").filter(Boolean);
const clients: Array<InstanceType<typeof Bun.RedisClient>> = [];
afterAll(() => {
    for (const c of clients) c.close();
});

/**
 * The smallest cluster-aware client: send to any node and follow `MOVED`,
 * remembering where each slot lives — what ioredis' Cluster does.
 */
function clusterClient(nodes: string[]) {
    const byAddress = new Map<string, InstanceType<typeof Bun.RedisClient>>();
    const node = (address: string) => {
        let client = byAddress.get(address);
        if (!client) {
            client = new Bun.RedisClient(`redis://${address}`);
            clients.push(client);
            byAddress.set(address, client);
        }
        return client;
    };
    let preferred = nodes[0]!;
    let redirects = 0;
    return {
        get redirects() {
            return redirects;
        },
        async send(command: string, args: string[]): Promise<unknown> {
            let address = preferred;
            for (let hop = 0; ; hop++) {
                try {
                    return await node(address).send(command, args);
                } catch (error) {
                    const moved = /MOVED \d+ (\S+)/.exec(String(error));
                    if (!moved || hop > 3) throw error;
                    redirects++;
                    address = preferred = moved[1]!;
                }
            }
        },
    };
}

describe.skipIf(!NODES)("RedisRateLimitStore on a Redis Cluster", () => {
    const discord = startFakeDiscord({ limit: 5, windowMs: 150, latencyMs: 3 });
    afterAll(() => discord.stop());

    test("a hash-tagged prefix keeps every script in one slot: no request over the limit", async () => {
        discord.reset();
        const prefix = `{lunibee-it-${crypto.randomUUID()}}:rest:`;
        const instances = Array.from({ length: 4 }, () => {
            const client = clusterClient(NODES!);
            const store = new RedisRateLimitStore({
                client: fromBunRedis(client),
                prefix,
                failurePolicy: "fail-closed",
                requireAtomic: true,
            });
            const rest = new REST({
                token: "it.cluster.token",
                retries: 20,
                globalLimit: false,
                store,
                transport: new HttpTransport({
                    baseURL: discord.url,
                    fetch: (i, init) => fetch(i, init),
                }),
            });
            return { store, rest };
        });
        await instances[0]!.store.verify();
        const work: Promise<unknown>[] = [];
        for (const { rest } of instances)
            for (let b = 0; b < 2; b++)
                for (let i = 0; i < 10; i++)
                    work.push(
                        rest.post(`/channels/${2000 + b}/messages`, {
                            content: "x",
                        }),
                    );
        await Promise.all(work);
        expect(discord.stats.ok).toBe(80);
        expect(discord.stats.bucket429).toBe(0);
        for (const { store } of instances) {
            expect(store.mode).toBe("distributed");
            expect(store.diagnostics().failures).toBe(0);
        }
    }, 30_000);

    test("without a hash tag the scripts cross slots, and fail-closed refuses instead of overshooting", async () => {
        discord.reset();
        const store = new RedisRateLimitStore({
            client: fromBunRedis(clusterClient(NODES!)),
            prefix: `lunibee-it-${crypto.randomUUID()}:rest:`,
            failurePolicy: "fail-closed",
        });
        const rest = new REST({
            token: "it.cluster.untagged",
            retries: 0,
            globalLimit: false,
            store,
            transport: new HttpTransport({
                baseURL: discord.url,
                fetch: (i, init) => fetch(i, init),
            }),
        });
        const warn = console.warn;
        const warnings: string[] = [];
        console.warn = (message: string) => void warnings.push(message);
        try {
            const error = await rest
                .post("/channels/3000/messages", { content: "x" })
                .catch((e: unknown) => e);
            expect((error as { kind?: string }).kind).toBe("coordination");
        } finally {
            console.warn = warn;
        }
        expect(discord.stats.requests).toBe(0);
        expect(store.diagnostics().lastError).toMatch(/CROSSSLOT/);
        expect(warnings.some((w) => w.includes("hash-tagged prefix"))).toBe(
            true,
        );
    }, 15_000);
});
