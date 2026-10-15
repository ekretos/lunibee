import { createHash } from "node:crypto";

/**
 * Who a request's rate limits belong to.
 *
 * `bucket` prefixes the bucket key: Discord counts a bot's buckets per bot, so
 * two bots sharing one Redis must not share counters. `global` is the scope of
 * the global limit the request counts against, or `undefined` when it counts
 * against none.
 */
export interface RequestIdentity {
    bucket: string;
    global?: string;
}

/**
 * A stable, non-reversible fingerprint of a token, identical in every process.
 * The token itself never enters a key, a label or a log line.
 */
export function tokenFingerprint(token: string): string {
    return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/**
 * Classifies a request.
 *
 * - Interaction callbacks (`/interactions/:id/:token/…`) and token webhooks
 *   (`/webhooks/:id/:token…`, which includes interaction follow-ups) are
 *   limited per webhook, whoever sends them: their buckets are shared
 *   (`"shared"`), so every bot and process agrees on one counter.
 *   Interaction callbacks are not bound to any global limit; a token webhook
 *   still counts against the sender's, conservatively, because a follow-up
 *   cannot be told from a plain webhook by its path.
 * - A request sent without a bot token is limited per caller (`"anon"`).
 * - Everything else belongs to the bot that sends it.
 */
export function requestIdentity(
    path: string,
    fingerprint: string | undefined,
): RequestIdentity {
    if (/^\/interactions\//i.test(path)) return { bucket: "shared" };
    if (/^\/webhooks\/[^/?]+\/[^/?]+/i.test(path))
        return { bucket: "shared", global: fingerprint ?? "anon" };
    if (!fingerprint) return { bucket: "anon", global: "anon" };
    return { bucket: fingerprint, global: fingerprint };
}
