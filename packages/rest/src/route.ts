/** Query-string value accepted by a request. */
export type RESTQuery =
    | URLSearchParams
    | Record<string, string | number | boolean | null | undefined>
    | string;

/**
 * Identity of a request as Discord's rate limiter sees it.
 *
 * `route` is the shape of the endpoint (ids replaced by `:id`), which is what
 * Discord returns a bucket hash for. `major` is the resource that gives an
 * endpoint its own independent limit. Both are needed: the hash alone would
 * make two channels share one counter.
 */
export interface RouteKey {
    /** Uppercased HTTP method. */ method: string;
    /** Raw request path, without query string. */ path: string;
    /** Normalized `METHOD:/path/:id` route used for bucket-hash lookup. */ route: string;
    /** Major parameter scoping the limit (channel, guild, webhook id[:token]). */ major: string;
}

/** Normalizes Discord routes for stable bucket discovery. */
export function normalizeRoutePath(path: string): string {
    const queryIndex = path.indexOf("?");
    const routePath = queryIndex === -1 ? path : path.slice(0, queryIndex);
    return routePath.replace(/\/\d+(?=\/|$)/g, "/:id");
}

/**
 * Discord's *major parameters* — the resource ids that give an endpoint its own
 * independent rate limit. Per the API documentation these are `channel_id`,
 * `guild_id` and `webhook_id`; webhook routes are additionally scoped by
 * their token. Any other id in a path shares its limit with sibling resources.
 */
export function majorParameter(path: string): string {
    const match = /^\/(channels|guilds|webhooks)\/(\d+)(?:\/([^/?]+))?/.exec(
        path,
    );
    if (!match) return "@none";
    // A webhook's limit is keyed by both its id and its token.
    if (match[1] === "webhooks" && match[3] !== undefined)
        return `${match[2]}:${match[3]}`;
    return match[2]!;
}

/** Combines a bucket hash (or route) with a major parameter into a bucket key. */
export function scopeBucket(hashOrRoute: string, major: string): string {
    return `${hashOrRoute}|${major}`;
}

/** Builds the routing identity for one request. */
export function createRouteKey(method: string, path: string): RouteKey {
    const normalizedMethod = method.toUpperCase();
    return {
        method: normalizedMethod,
        path,
        route: `${normalizedMethod}:${normalizeRoutePath(path)}`,
        major: majorParameter(path),
    };
}

/** Serialises a query into a `?...` suffix (empty string when nothing to add). */
export function serializeQuery(query: RESTQuery | undefined): string {
    if (query === undefined) return "";
    if (typeof query === "string")
        return query.length === 0 || query.startsWith("?")
            ? query
            : `?${query}`;
    const params =
        query instanceof URLSearchParams
            ? query
            : new URLSearchParams(
                  Object.entries(query).flatMap(([key, value]) =>
                      value === undefined || value === null
                          ? []
                          : [[key, String(value)] as [string, string]],
                  ),
              );
    const serialized = params.toString();
    return serialized.length === 0 ? "" : `?${serialized}`;
}
