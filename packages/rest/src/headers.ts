/** Which limit a 429 counts against, from `X-RateLimit-Scope`. */
export type RateLimitScope = "user" | "global" | "shared";

/** A response's rate-limit headers, each one validated on its own. */
export interface RateLimitHeaders {
    /** `X-RateLimit-Limit`: requests per window. */
    limit?: number;
    /** `X-RateLimit-Remaining`: requests left in the window. */
    remaining?: number;
    /** `X-RateLimit-Reset-After`, in ms from now. */
    resetAfterMs?: number;
    /** `X-RateLimit-Reset`, as epoch ms: identifies the window. */
    resetAtMs?: number;
    /** `X-RateLimit-Bucket`: the server's bucket hash. */
    bucket?: string;
    /** `X-RateLimit-Scope`, when it is one Discord documents. */
    scope?: RateLimitScope;
    /** `X-RateLimit-Global: true`. */
    global: boolean;
    /** `Retry-After`, in ms. */
    retryAfterMs?: number;
}

/**
 * A non-negative finite number from a header, or `undefined`.
 *
 * `Number(null)` and `Number("")` are 0, which would read a missing header as
 * "nothing remaining" or "reset now"; a negative or non-numeric value is a
 * broken proxy, not information.
 */
export function headerNumber(
    headers: Headers,
    name: string,
): number | undefined {
    const raw = headers.get(name);
    if (raw === null || raw.trim() === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Bucket hashes are short opaque strings; anything else is not one. */
const BUCKET_HASH = /^[A-Za-z0-9:_\-.]{1,64}$/;

/** Reads every rate-limit header of a response defensively. */
export function parseRateLimitHeaders(headers: Headers): RateLimitHeaders {
    const remaining = headerNumber(headers, "X-RateLimit-Remaining");
    const limit = headerNumber(headers, "X-RateLimit-Limit");
    const resetAfter = headerNumber(headers, "X-RateLimit-Reset-After");
    const reset = headerNumber(headers, "X-RateLimit-Reset");
    const retryAfter = headerNumber(headers, "Retry-After");
    const bucket = headers.get("X-RateLimit-Bucket")?.trim();
    const scope = headers.get("X-RateLimit-Scope")?.trim().toLowerCase();
    return {
        limit: limit === undefined ? undefined : Math.floor(limit),
        remaining: remaining === undefined ? undefined : Math.floor(remaining),
        resetAfterMs: resetAfter === undefined ? undefined : resetAfter * 1000,
        resetAtMs: reset === undefined ? undefined : reset * 1000,
        bucket: bucket && BUCKET_HASH.test(bucket) ? bucket : undefined,
        scope:
            scope === "user" || scope === "global" || scope === "shared"
                ? scope
                : undefined,
        global:
            headers.get("X-RateLimit-Global")?.trim().toLowerCase() === "true",
        retryAfterMs: retryAfter === undefined ? undefined : retryAfter * 1000,
    };
}
