import type { APIBan } from "@lunibee/managers";
import type { REST, RESTFileAttachment } from "@lunibee/rest";
import type {
    APIApplicationCommand,
    APIAuditLog,
    APIChannel,
    APIEmoji,
    APIGuild,
    APIGuildMember,
    APIInvite,
    APIMessage,
    APIOverwrite,
    APIRole,
    APIThreadMember,
    APIWebhook,
    UserData,
} from "@lunibee/types";

/** What goes in a path where Discord wants an id: a snowflake, `"@me"`, an invite code, an emoji. */
export type RouteId = string | number | bigint;

/** Extra settings for one request. */
export interface RouteOptions {
    /** Appended to the URL: `{ limit: 50 }`. Undefined values are left out. */
    query?: Record<string, string | number | boolean | undefined>;
    /** The audit-log reason, sent as `X-Audit-Log-Reason`. */
    reason?: string;
    /** Cancels the request, and any wait for a rate limit. */
    signal?: AbortSignal;
    /** Files to upload; the body is sent as multipart. */
    files?: RESTFileAttachment[];
}

/** How a list is paged. Each route has its own defaults; set only what you need to change. */
export interface PageOptions<Item = unknown> extends Pick<
    RouteOptions,
    "signal"
> {
    /** Items per request. */
    limit?: number;
    /** Which end the next page starts from: after the last id, or before it. */
    cursor?: "after" | "before";
    /** Where to start: an id. */
    start?: string;
    /** Other query parameters sent with every page. */
    query?: RouteOptions["query"];
    /** How to read an item's id, when it is not `id` or `user.id`. */
    idOf?: (item: Item) => string;
}

/**
 * A place in Discord's REST API. Send a request with `get`, `post`, `put`,
 * `patch` or `delete`. `Read` is what `get` returns; `Write` is what `post`
 * and `patch` return (the same, except on a list, where posting makes one item).
 */
export interface Route<Read = unknown, Write = Read> {
    /** The path this route stands for, such as `/guilds/123/members`. */
    readonly path: string;
    get<R = Read>(options?: RouteOptions): Promise<R>;
    post<R = Write>(body?: unknown, options?: RouteOptions): Promise<R>;
    put<R = void>(body?: unknown, options?: RouteOptions): Promise<R>;
    patch<R = Write>(body?: unknown, options?: RouteOptions): Promise<R>;
    delete<R = void>(options?: RouteOptions): Promise<R>;
}

/** A route that lists things and can follow its pages. */
export interface ListRoute<Item> extends Route<Item[], Item> {
    /** Yields one page at a time, following the cursor until the list ends. */
    pages(options?: PageOptions<Item>): AsyncGenerator<Item[], void>;
    /**
     * Collects pages into one array.
     * @param options.max Stop after this many items (10,000 by default).
     */
    all(options?: PageOptions<Item> & { max?: number }): Promise<Item[]>;
}

type Pick1<N> = (id: RouteId) => N;

export interface MessageNode extends Route<APIMessage> {
    crosspost: Route<APIMessage>;
    /** `reactions(emoji)` lists who reacted; `reactions(emoji)("@me")` is the bot's own reaction. */
    reactions: ListRoute<UserData> &
        ((emoji: string) => ListRoute<UserData> & Pick1<Route>);
}
export interface MessagesRoute extends ListRoute<APIMessage> {
    (id: RouteId): MessageNode;
    bulkDelete: Route;
}
export interface ChannelNode extends Route<APIChannel> {
    messages: MessagesRoute;
    typing: Route;
    invites: ListRoute<APIInvite>;
    webhooks: ListRoute<APIWebhook>;
    /** Permission overwrites, by role or user id. */
    permissions: Pick1<Route<APIOverwrite>>;
    threadMembers: ListRoute<APIThreadMember> & Pick1<Route<APIThreadMember>>;
}
export interface MemberNode extends Route<APIGuildMember> {
    /** `roles(roleId).put()` adds the role; `.delete()` takes it away. */
    roles: Pick1<Route>;
}
export interface MembersRoute extends ListRoute<APIGuildMember> {
    (userId: RouteId): MemberNode;
    search: Route<APIGuildMember[]>;
}
export interface GuildNode extends Route<APIGuild> {
    channels: Route<APIChannel[], APIChannel>;
    members: MembersRoute;
    roles: ListRoute<APIRole> & Pick1<Route<APIRole>>;
    bans: ListRoute<APIBan> & Pick1<Route<APIBan>>;
    emojis: ListRoute<APIEmoji> & Pick1<Route<APIEmoji>>;
    invites: ListRoute<APIInvite>;
    webhooks: ListRoute<APIWebhook>;
    auditLogs: Route<APIAuditLog>;
    preview: Route;
}
export interface UserNode extends Route<UserData> {
    /** The guilds a user is in (`users("@me").guilds`); `guilds(id).delete()` leaves one. */
    guilds: ListRoute<APIGuild> & Pick1<Route>;
    /** `channels.post({ recipient_id })` opens a direct message. */
    channels: Route<APIChannel>;
}
export interface ApplicationNode extends Route {
    commands: ListRoute<APIApplicationCommand> &
        Pick1<Route<APIApplicationCommand>>;
    /** Commands of one guild. */
    guilds: Pick1<{
        commands: ListRoute<APIApplicationCommand> &
            Pick1<Route<APIApplicationCommand>>;
    }>;
}
/** `webhooks(id)` is the webhook; `webhooks(id)(token)` is its execute route, with `messages(id)` inside. */
export type WebhookNode = Route<APIWebhook> &
    ((token: string) => Route<APIMessage> & {
        messages: Pick1<Route<APIMessage>>;
    });

/**
 * Discord's REST API as a path you build by chaining: a name goes one level
 * down, a call with an id goes into that item, and a method sends. Names are
 * the route words in camelCase (`auditLogs` is `/audit-logs`).
 * @example await bot.api.guilds(guildId).members(userId).patch({ nick: "x" }, { reason: "rename" });
 * @example for await (const page of bot.api.guilds(guildId).members.pages()) { … }
 */
export interface Api {
    guilds: Pick1<GuildNode>;
    channels: Pick1<ChannelNode>;
    users: Pick1<UserNode>;
    applications: Pick1<ApplicationNode>;
    webhooks: Pick1<WebhookNode>;
    invites: Pick1<Route<APIInvite>>;
    /** Any route not listed above: `bot.api.to("stage-instances", id)`. */
    to(...segments: RouteId[]): Route;
}

// ─── Runtime ─────────────────────────────────────────────────────────────────

const SAFE_WORD = /^[a-z][a-zA-Z0-9]*$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_@.%-]+$/;

/** Page defaults of the routes whose lists Discord pages in its own way. */
const PAGING: Record<
    string,
    {
        limit: number;
        cursor: "after" | "before";
        idOf?: (item: never) => string;
    }
> = {
    members: {
        limit: 1000,
        cursor: "after",
        idOf: (member: APIGuildMember) => member.user.id,
    },
    bans: {
        limit: 1000,
        cursor: "after",
        idOf: (ban: APIBan) => ban.user.id,
    },
    messages: { limit: 100, cursor: "before" },
    guilds: { limit: 200, cursor: "after" },
};
const DEFAULT_PAGING = { limit: 100, cursor: "after" as const };
const DEFAULT_MAX = 10_000;

function kebab(word: string): string {
    return word.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function idSegment(id: unknown): string {
    if (
        typeof id !== "string" &&
        typeof id !== "number" &&
        typeof id !== "bigint"
    )
        throw new TypeError("A route id must be a string, number or bigint.");
    const text = String(id);
    if (text === "") throw new TypeError("A route id cannot be empty.");
    return encodeURIComponent(text).replace(/%40/g, "@");
}

function defaultId(item: unknown): string {
    const record = item as { id?: unknown; user?: { id?: unknown } };
    const id = record?.id ?? record?.user?.id;
    if (typeof id !== "string")
        throw new TypeError(
            "Cannot find an id on a page item; pass idOf to pages().",
        );
    return id;
}

function node(rest: REST, segments: readonly string[]): unknown {
    const path = `/${segments.join("/")}`;
    const send =
        (method: string, hasBody: boolean) =>
        (first?: unknown, second?: RouteOptions) =>
            rest.request(
                method,
                path,
                hasBody ? first : undefined,
                (hasBody ? second : (first as RouteOptions | undefined)) ?? {},
            );
    const last = segments[segments.length - 1] ?? "";
    const pages = async function* (
        options: PageOptions<unknown> = {},
    ): AsyncGenerator<unknown[], void> {
        const paging = { ...DEFAULT_PAGING, ...PAGING[last] };
        const cursorName = options.cursor ?? paging.cursor;
        const limit = options.limit ?? paging.limit;
        const idOf =
            options.idOf ??
            (paging.idOf as ((item: unknown) => string) | undefined) ??
            defaultId;
        let cursor = options.start;
        for (;;) {
            const batch = await rest.request<unknown[]>(
                "GET",
                path,
                undefined,
                {
                    signal: options.signal,
                    query: {
                        ...options.query,
                        limit,
                        ...(cursor === undefined
                            ? {}
                            : { [cursorName]: cursor }),
                    },
                },
            );
            if (!Array.isArray(batch) || batch.length === 0) return;
            yield batch;
            if (batch.length < limit) return;
            cursor = idOf(batch[batch.length - 1]);
        }
    };
    const all = async (
        options: PageOptions<unknown> & { max?: number } = {},
    ): Promise<unknown[]> => {
        const max = options.max ?? DEFAULT_MAX;
        const paging = { ...DEFAULT_PAGING, ...PAGING[last] };
        const items: unknown[] = [];
        if (max <= 0) return items;
        for await (const page of pages({
            ...options,
            limit: Math.min(options.limit ?? paging.limit, max),
        })) {
            items.push(...page);
            if (items.length >= max) break;
        }
        return items.slice(0, max);
    };
    const members: Record<string, unknown> = {
        path,
        get: send("GET", false),
        post: send("POST", true),
        put: send("PUT", true),
        patch: send("PATCH", true),
        delete: send("DELETE", false),
        pages,
        all,
        toString: () => path,
    };
    return new Proxy(function route() {}, {
        get(_target, property) {
            if (typeof property !== "string") return undefined;
            if (property in members) return members[property];
            // `then` stays undefined so awaiting a route cannot hang.
            if (property === "then" || !SAFE_WORD.test(property))
                return undefined;
            return node(rest, [...segments, kebab(property)]);
        },
        apply(_target, _this, args: unknown[]) {
            if (args.length !== 1)
                throw new TypeError(
                    `Call a route with exactly one id, e.g. ${path}(id).`,
                );
            return node(rest, [...segments, idSegment(args[0])]);
        },
    });
}

/** Builds `bot.api` over a REST client. */
export function createApi(rest: REST): Api {
    const root = node(rest, []) as Record<string, unknown>;
    return new Proxy(root, {
        get(target, property, receiver) {
            if (property === "to")
                return (...segments: RouteId[]): Route => {
                    if (segments.length === 0)
                        throw new TypeError("to() needs at least one segment.");
                    const cleaned = segments.map((segment) => {
                        const text = String(segment);
                        if (!SAFE_SEGMENT.test(text))
                            throw new TypeError(
                                `Invalid route segment: ${JSON.stringify(text)}.`,
                            );
                        return text;
                    });
                    return node(rest, cleaned) as Route;
                };
            return Reflect.get(target, property, receiver);
        },
    }) as unknown as Api;
}
