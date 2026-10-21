import packageJson from "../package.json" with { type: "json" };

/** `/gateway/bot` information used to pace shard startup. */
export interface GatewayBotInfo {
    /** Recommended shard count. */
    shards: number;
    /** IDENTIFY budget, when Discord reported it. */
    sessionStartLimit?: {
        total: number;
        remaining: number;
        /** Milliseconds until `remaining` resets. */
        resetAfter: number;
        maxConcurrency: number;
    };
}

/**
 * Asks Discord for the recommended shard count and the IDENTIFY budget.
 * @throws {Error} If the request fails or the answer is not usable.
 */
export async function fetchGatewayBot(token: string): Promise<GatewayBotInfo> {
    const response = await fetch("https://discord.com/api/v10/gateway/bot", {
        headers: {
            Authorization: `Bot ${token}`,
            "User-Agent": `Lunibee/${packageJson.version}`,
        },
    });
    if (!response.ok)
        throw new Error(
            `Gateway discovery failed with status ${response.status}`,
        );
    const data = (await response.json()) as {
        shards?: unknown;
        session_start_limit?: {
            total?: unknown;
            remaining?: unknown;
            reset_after?: unknown;
            max_concurrency?: unknown;
        };
    };
    if (
        typeof data.shards !== "number" ||
        !Number.isInteger(data.shards) ||
        data.shards < 1
    )
        throw new Error("Gateway discovery returned an invalid shard count.");
    const limit = data.session_start_limit;
    const info: GatewayBotInfo = { shards: data.shards };
    if (
        limit &&
        typeof limit.total === "number" &&
        typeof limit.remaining === "number" &&
        typeof limit.reset_after === "number" &&
        typeof limit.max_concurrency === "number"
    )
        info.sessionStartLimit = {
            total: limit.total,
            remaining: limit.remaining,
            resetAfter: limit.reset_after,
            maxConcurrency: Math.max(1, limit.max_concurrency),
        };
    return info;
}

/** Discord's hard limit: a shard may serve at most this many guilds. */
export const MAX_GUILDS_PER_SHARD = 2500;

/** Checks a `guildsPerShard` option. @throws {RangeError} Unless it is an integer from 1 to 2500. */
export function assertGuildsPerShard(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > MAX_GUILDS_PER_SHARD)
        throw new RangeError(
            `guildsPerShard must be an integer from 1 to ${MAX_GUILDS_PER_SHARD}.`,
        );
}

/** How many shards keep each at or under `guildsPerShard` guilds (at least one). */
export function shardsForGuilds(
    guilds: number,
    guildsPerShard: number,
): number {
    assertGuildsPerShard(guildsPerShard);
    if (!Number.isInteger(guilds) || guilds < 0)
        throw new RangeError("guildCount must be a non-negative integer.");
    return Math.max(1, Math.ceil(guilds / guildsPerShard));
}

/**
 * Asks Discord how many guilds the bot is in (`approximate_guild_count` of the application).
 * @throws {Error} If the request fails or the answer is not usable.
 */
export async function fetchGuildCount(token: string): Promise<number> {
    const response = await fetch(
        "https://discord.com/api/v10/applications/@me",
        {
            headers: {
                Authorization: `Bot ${token}`,
                "User-Agent": `Lunibee/${packageJson.version}`,
            },
        },
    );
    if (!response.ok)
        throw new Error(
            `Guild count discovery failed with status ${response.status}`,
        );
    const data = (await response.json()) as {
        approximate_guild_count?: unknown;
    };
    const count = data.approximate_guild_count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0)
        throw new Error("Discord did not report a guild count.");
    return count;
}

/**
 * The shard count to use for `"auto"`: Discord's recommendation, or, with
 * `guildsPerShard`, enough shards for the bot's guild count (`guildCount`, or
 * what Discord reports), but never fewer than the recommendation: a stale or
 * low guild count must not leave shards over Discord's 2,500-guild limit.
 */
export async function resolveShardCount(
    token: string,
    info: GatewayBotInfo,
    options: { guildsPerShard?: number; guildCount?: number },
): Promise<number> {
    if (options.guildsPerShard === undefined) return info.shards;
    return Math.max(
        info.shards,
        shardsForGuilds(
            options.guildCount ?? (await fetchGuildCount(token)),
            options.guildsPerShard,
        ),
    );
}
