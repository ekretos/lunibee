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
