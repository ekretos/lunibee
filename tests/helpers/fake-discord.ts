import { HttpTransport } from "../../packages/rest/src/transport.ts";

/** How the fake server limits and counts requests. */
export interface FakeDiscordOptions {
    /** Requests a route may make per window. */
    limit: number;
    /** Window length in ms. */
    windowMs: number;
    /** Time one request takes to answer, in ms. */
    latencyMs: number;
}

/** What the fake server saw. */
export interface FakeDiscordStats {
    requests: number;
    rateLimited: number;
    /** Most requests in flight at once. */
    peak: number;
}

/**
 * A stand-in for Discord's HTTP API that enforces per-route fixed windows the
 * way the real one does: `X-RateLimit-*` headers on every answer and a 429
 * with `Retry-After` when a window is overspent.
 */
export function fakeDiscord(options: FakeDiscordOptions): {
    transport: HttpTransport;
    stats: FakeDiscordStats;
} {
    const stats: FakeDiscordStats = { requests: 0, rateLimited: 0, peak: 0 };
    const windows = new Map<string, { start: number; used: number }>();
    let inFlight = 0;
    const transport = {
        async send(request: { path: string }): Promise<Response> {
            stats.requests++;
            stats.peak = Math.max(stats.peak, ++inFlight);
            await new Promise((resolve) =>
                setTimeout(resolve, options.latencyMs),
            );
            inFlight--;
            const now = Date.now();
            let window = windows.get(request.path);
            if (!window || now - window.start >= options.windowMs) {
                window = { start: now, used: 0 };
                windows.set(request.path, window);
            }
            const resetAfter = Math.max(
                0,
                (window.start + options.windowMs - now) / 1000,
            );
            if (window.used >= options.limit) {
                stats.rateLimited++;
                return new Response(
                    JSON.stringify({
                        message: "rate limited",
                        retry_after: resetAfter,
                    }),
                    {
                        status: 429,
                        headers: {
                            "Retry-After": String(resetAfter),
                            "X-RateLimit-Bucket": "messages",
                            "X-RateLimit-Limit": String(options.limit),
                            "X-RateLimit-Remaining": "0",
                            "X-RateLimit-Reset-After": String(resetAfter),
                        },
                    },
                );
            }
            window.used++;
            return new Response("{}", {
                status: 200,
                headers: {
                    "X-RateLimit-Bucket": "messages",
                    "X-RateLimit-Limit": String(options.limit),
                    "X-RateLimit-Remaining": String(
                        options.limit - window.used,
                    ),
                    "X-RateLimit-Reset-After": String(resetAfter),
                },
            });
        },
    } as unknown as HttpTransport;
    return { transport, stats };
}
