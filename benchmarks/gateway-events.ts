/**
 * Client Gateway event processing: `bun benchmarks/gateway-events.ts`.
 * Feeds dispatch payloads straight into the client's handlers (no socket)
 * and reports the per-event cost including cache synchronisation.
 */
import { Client } from "../packages/core/src/index.ts";

const client = new Client({ token: "a.b", intents: 0 });
const gateway = client.gateway as unknown as {
    emit(event: string, data: unknown): void;
};
const snowflake = (n: number) => String(200_000_000_000_000_000n + BigInt(n));

function bench(name: string, count: number, run: (i: number) => void): void {
    for (let i = 0; i < Math.min(count, 1_000); i++) run(i); // warm up
    const start = performance.now();
    for (let i = 0; i < count; i++) run(i);
    const us = ((performance.now() - start) * 1000) / count;
    console.log(`${name.padEnd(36)} ${us.toFixed(2)} us/event`);
}

const guildId = snowflake(0);
gateway.emit("GUILD_CREATE", { id: guildId, name: "bench" });

bench("GUILD_CREATE (50 members, 20 roles)", 2_000, (i) =>
    gateway.emit("GUILD_CREATE", {
        id: snowflake(1_000_000 + i),
        name: "g",
        roles: Array.from({ length: 20 }, (_, r) => ({
            id: snowflake(2_000_000 + r),
            name: "r",
        })),
        members: Array.from({ length: 50 }, (_, m) => ({
            user: { id: snowflake(3_000_000 + m), username: "u" },
            roles: [],
            joined_at: "2020-01-01T00:00:00Z",
        })),
        channels: [{ id: snowflake(4_000_000 + i), type: 0, name: "c" }],
    }),
);
bench("GUILD_MEMBER_UPDATE", 50_000, (i) =>
    gateway.emit("GUILD_MEMBER_UPDATE", {
        guild_id: guildId,
        user: { id: snowflake(5_000_000 + (i % 5_000)), username: "u" },
        roles: [],
        joined_at: "2020-01-01T00:00:00Z",
    }),
);
bench("MESSAGE_CREATE", 50_000, (i) =>
    gateway.emit("MESSAGE_CREATE", {
        id: snowflake(6_000_000 + i),
        channel_id: snowflake(4_000_000),
        author: { id: snowflake(5_000_000 + (i % 5_000)), username: "u" },
        content: "hello",
        timestamp: "2020-01-01T00:00:00Z",
    }),
);
bench("GUILD_ROLE_UPDATE", 50_000, (i) =>
    gateway.emit("GUILD_ROLE_UPDATE", {
        guild_id: guildId,
        role: { id: snowflake(7_000_000 + (i % 100)), name: "r" },
    }),
);
