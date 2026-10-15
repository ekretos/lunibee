/**
 * A fake Discord REST server for benchmarks and integration tests.
 *
 * It enforces real rate-limit windows — per bot token, per bucket hash and
 * major parameter — plus a per-token global limit, emits Discord's headers,
 * and counts every request it had to reject. A 429 here is an *overshoot*:
 * a request the client sent although the limit was already spent.
 */
export interface FakeDiscordOptions {
    /** Requests per bucket window. */
    limit?: number;
    /** Bucket window length in ms. */
    windowMs?: number;
    /** Requests per token per second across all buckets (0 disables). */
    globalPerSecond?: number;
    /** Added latency per request, in ms. */
    latencyMs?: number;
}

export interface FakeDiscordStats {
    requests: number;
    ok: number;
    bucket429: number;
    global429: number;
    /** Most requests in flight at once. */
    peak: number;
}

export function createFakeDiscord(options: FakeDiscordOptions = {}) {
    const limit = options.limit ?? 5;
    const windowMs = options.windowMs ?? 1000;
    const globalPerSecond = options.globalPerSecond ?? 0;
    const latency = options.latencyMs ?? 0;
    const windows = new Map<string, { start: number; used: number }>();
    const globals = new Map<string, { start: number; used: number }>();
    const stats: FakeDiscordStats = {
        requests: 0,
        ok: 0,
        bucket429: 0,
        global429: 0,
        peak: 0,
    };
    let inFlight = 0;

    async function handle(req: Request): Promise<Response> {
        stats.requests++;
        stats.peak = Math.max(stats.peak, ++inFlight);
        try {
            if (latency) await Bun.sleep(latency);
            return answer(req);
        } finally {
            inFlight--;
        }
    }

    function answer(req: Request): Response {
        const url = new URL(req.url);
        const token = req.headers.get("authorization") ?? "anon";
        const major = /\/channels\/(\d+)/.exec(url.pathname)?.[1] ?? "-";
        const hash = `h-${req.method}-${url.pathname.replace(/\d+/g, ":id")}`;
        const now = Date.now();

        if (globalPerSecond > 0) {
            let g = globals.get(token);
            if (!g || now - g.start >= 1000) {
                g = { start: now, used: 0 };
                globals.set(token, g);
            }
            if (g.used >= globalPerSecond) {
                stats.global429++;
                const retry = (g.start + 1000 - now) / 1000;
                return Response.json(
                    { message: "global", retry_after: retry, global: true },
                    {
                        status: 429,
                        headers: {
                            "retry-after": String(Math.ceil(retry)),
                            "x-ratelimit-global": "true",
                            "x-ratelimit-scope": "global",
                        },
                    },
                );
            }
            g.used++;
        }

        const key = `${token}|${hash}|${major}`;
        let w = windows.get(key);
        if (!w || now - w.start >= windowMs) {
            w = { start: now, used: 0 };
            windows.set(key, w);
        }
        const resetAfter = Math.max(0, w.start + windowMs - now) / 1000;
        const headers: Record<string, string> = {
            "content-type": "application/json",
            "x-ratelimit-bucket": hash,
            "x-ratelimit-limit": String(limit),
            "x-ratelimit-reset-after": resetAfter.toFixed(3),
            "x-ratelimit-reset": ((w.start + windowMs) / 1000).toFixed(3),
        };
        if (w.used >= limit) {
            stats.bucket429++;
            return Response.json(
                {
                    message: "rate limited",
                    retry_after: resetAfter,
                    global: false,
                },
                {
                    status: 429,
                    headers: {
                        ...headers,
                        "x-ratelimit-remaining": "0",
                        "x-ratelimit-scope": "user",
                        "retry-after": String(Math.ceil(resetAfter)),
                    },
                },
            );
        }
        w.used++;
        stats.ok++;
        return new Response("{}", {
            status: 200,
            headers: {
                ...headers,
                "x-ratelimit-remaining": String(limit - w.used),
            },
        });
    }
    return {
        handle,
        /** A `fetch` for `HttpTransport`, answering in-process. */
        fetch: (input: string, init: RequestInit) =>
            handle(new Request(input, init)),
        stats,
        reset() {
            windows.clear();
            globals.clear();
            stats.requests =
                stats.ok =
                stats.bucket429 =
                stats.global429 =
                stats.peak =
                    0;
        },
    };
}

/** {@link createFakeDiscord} behind a real HTTP server on 127.0.0.1, for other processes. */
export function startFakeDiscord(options: FakeDiscordOptions = {}) {
    const discord = createFakeDiscord(options);
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: (req) => discord.handle(req),
    });
    return {
        ...discord,
        url: `http://127.0.0.1:${server.port}`,
        stop: () => server.stop(true),
    };
}
