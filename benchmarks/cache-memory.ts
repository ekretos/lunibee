/**
 * Heap kept per guild by the default cache: `bun benchmarks/cache-memory.ts`.
 * Feeds GUILD_CREATE payloads (roles, channels, members) straight into the
 * client's handlers and measures the heap after a full GC. Users repeat
 * across guilds, as they do on Discord.
 */
import { Client } from "../packages/core/src/index.ts";

const snowflake = (n: number) => String(200_000_000_000_000_000n + BigInt(n));
const SIZES = [
    { name: "small", guilds: 200, members: 20, roles: 5, channels: 10 },
    { name: "medium", guilds: 50, members: 500, roles: 30, channels: 50 },
    { name: "large", guilds: 5, members: 10_000, roles: 100, channels: 200 },
];
const USERS = 20_000;

function heap(): number {
    Bun.gc(true);
    return process.memoryUsage().heapUsed;
}

console.log("size    guilds  members/guild  heap per guild");
for (const size of SIZES) {
    const client = new Client({ token: "a.b", intents: [] });
    const gateway = client.gateway as unknown as {
        emit(event: string, data: unknown): void;
    };
    const before = heap();
    let id = 0;
    for (let g = 0; g < size.guilds; g++)
        gateway.emit("GUILD_CREATE", {
            id: snowflake(++id),
            name: `guild ${g}`,
            roles: Array.from({ length: size.roles }, (_, r) => ({
                id: snowflake(1_000_000 + g * 1_000 + r),
                name: `role ${r}`,
                permissions: "0",
                position: r,
            })),
            channels: Array.from({ length: size.channels }, (_, c) => ({
                id: snowflake(2_000_000 + g * 1_000 + c),
                type: 0,
                name: `channel-${c}`,
            })),
            members: Array.from({ length: size.members }, (_, m) => ({
                user: {
                    id: snowflake(3_000_000 + ((g * size.members + m) % USERS)),
                    username: `user${m}`,
                },
                roles: [],
                joined_at: "2020-01-01T00:00:00Z",
            })),
        });
    const perGuild = (heap() - before) / size.guilds;
    console.log(
        `${size.name.padEnd(8)}${String(size.guilds).padStart(6)}${String(size.members).padStart(15)}  ${(perGuild / 1024).toFixed(1).padStart(10)} KiB`,
    );
    client.destroy();
}
