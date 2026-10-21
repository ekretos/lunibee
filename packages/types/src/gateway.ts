// ─── Gateway Intents ─────────────────────────────────────────────────────────

/** Gateway intent bit flags supported by Discord (PascalCase). */
export const GatewayIntentBits = {
    Guilds: 1 << 0,
    GuildMembers: 1 << 1,
    GuildModeration: 1 << 2,
    GuildExpressions: 1 << 3,
    GuildIntegrations: 1 << 4,
    GuildWebhooks: 1 << 5,
    GuildInvites: 1 << 6,
    GuildVoiceStates: 1 << 7,
    GuildPresences: 1 << 8,
    GuildMessages: 1 << 9,
    GuildMessageReactions: 1 << 10,
    GuildMessageTyping: 1 << 11,
    DirectMessages: 1 << 12,
    DirectMessageReactions: 1 << 13,
    DirectMessageTyping: 1 << 14,
    MessageContent: 1 << 15,
    GuildScheduledEvents: 1 << 16,
    AutoModerationConfiguration: 1 << 20,
    AutoModerationExecution: 1 << 21,
    GuildMessagePolls: 1 << 24,
    DirectMessagePolls: 1 << 25,
} as const;

/** Idiomatic camelCase Gateway intent bit flags supported by Discord. */
export const IntentBits = {
    guild: 1 << 0,
    guilds: 1 << 0,
    guildMembers: 1 << 1,
    guildModeration: 1 << 2,
    guildBans: 1 << 2,
    guildExpressions: 1 << 3,
    guildEmojis: 1 << 3,
    guildEmojisAndStickers: 1 << 3,
    guildIntegrations: 1 << 4,
    guildWebhooks: 1 << 5,
    guildInvites: 1 << 6,
    guildVoiceStates: 1 << 7,
    guildPresences: 1 << 8,
    guildMessages: 1 << 9,
    guildMessage: 1 << 9,
    guildMessageReactions: 1 << 10,
    guildMessageTyping: 1 << 11,
    directMessages: 1 << 12,
    directMessageReactions: 1 << 13,
    directMessageTyping: 1 << 14,
    messageContent: 1 << 15,
    guildScheduledEvents: 1 << 16,
    autoModerationConfiguration: 1 << 20,
    autoModerationExecution: 1 << 21,
    guildMessagePolls: 1 << 24,
    directMessagePolls: 1 << 25,
} as const;

/** Gateway intents: an array of intent bits or names, e.g. `[GatewayIntentBits.Guilds, "GuildMessages"]`. A single number, name or OR-ed bitfield is not accepted. */
export type GatewayIntentResolvable = readonly (
    number | keyof typeof GatewayIntentBits | keyof typeof IntentBits | string
)[];

/**
 * Resolves an array of intents into a raw bitfield integer.
 * @throws {TypeError} If `intents` is not an array (an OR-ed number, a single name or a bitfield object).
 */
export function resolveGatewayIntents(
    intents: GatewayIntentResolvable,
): number {
    if (!Array.isArray(intents))
        throw new TypeError(
            "Gateway intents must be an array, e.g. [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages].",
        );
    return intents.reduce<number>(
        (acc, intent) => acc | resolveIntent(intent),
        0,
    );
}

/** Resolves one intent: a bitfield, an intent name in either casing, or a numeric string. */
function resolveIntent(intent: number | string): number {
    if (typeof intent === "number") return intent;
    const bits: Record<string, number> = {
        ...IntentBits,
        ...GatewayIntentBits,
    };
    const lower = intent.charAt(0).toLowerCase() + intent.slice(1);
    if (Object.hasOwn(bits, intent)) return bits[intent]!;
    if (Object.hasOwn(bits, lower)) return bits[lower]!;
    const num = Number(intent);
    return Number.isNaN(num) ? 0 : num;
}

// ─── Gateway Config ───────────────────────────────────────────────────────────

/** Gateway connection properties (OS, browser, device). */
export interface GatewayProperties {
    os?: string;
    browser?: string;
    device?: string;
    [key: string]: string | undefined;
}
/** Gateway presence activity. */
export interface GatewayPresenceActivity {
    name: string;
    type?: number;
    url?: string;
    state?: string;
}
/** Gateway presence data. */
export interface GatewayPresence {
    status?: "online" | "dnd" | "idle" | "invisible" | "offline";
    activities?: GatewayPresenceActivity[];
    afk?: boolean;
    since?: number | null;
}
/** Client configuration. */
export interface ClientOptions {
    token: string;
    intents: GatewayIntentResolvable;
    gateway?: GatewayOptions;
    /**
     * zlib-stream transport compression for the Gateway connection, about a
     * tenth of the inbound bandwidth. Shorthand for `gateway: { compress }`,
     * which wins when both are set. Off by default.
     */
    compress?: boolean;
    rest?: RESTOptions;
    /** Opt-in bounded per-channel message cache. Messages are not cached by default. */
    messageCache?: { maxSize?: number; ttl?: number };
    /**
     * Which resources the client keeps from Gateway events. Everything is
     * cached by default; large bots can turn off what they do not read.
     * Events are still emitted either way.
     */
    cache?: {
        users?: boolean;
        members?: boolean;
        roles?: boolean;
        emojis?: boolean;
        /** Keep each member's latest presence (needs the `GuildPresences` intent). Off by default: it is a lot of data. */
        presences?: boolean;
        /** Most members kept per guild (least recently used leave first). Default: unbounded, so a big guild's member list stays whole. */
        maxMembers?: number;
        /** Most users kept in `client.users` (least recently used leave first). Default: unbounded. */
        maxUsers?: number;
    };
    /**
     * Default `allowed_mentions` for every message the client sends (channel
     * send/edit, replies, interaction replies, edits and follow-ups), e.g.
     * `{ parse: [] }` so nothing pings unless a message says so. A message's
     * own `allowed_mentions` always wins.
     */
    allowedMentions?: AllowedMentions;
}
/** Discord's `allowed_mentions` object. */
export interface AllowedMentions {
    parse?: ("users" | "roles" | "everyone")[];
    users?: string[];
    roles?: string[];
    replied_user?: boolean;
}
/** Gateway connection configuration. */
export interface GatewayOptions {
    intents?: GatewayIntentResolvable;
    /** zlib-stream transport compression; `ClientOptions.compress` is shorthand for this. */
    compress?: boolean;
    reconnect?: boolean;
    maxReconnectAttempts?: number;
    reconnectBaseDelay?: number;
    reconnectMaxDelay?: number;
    shardId?: number;
    shardCount?: number;
    properties?: GatewayProperties;
    presence?: GatewayPresence;
}

/** REST request configuration. */
export interface RESTOptions {
    timeout?: number;
    retries?: number;
    /** Where requests go. Must be `https:` (or `http:` on this machine) with no credentials, query or fragment. */
    baseURL?: string;
    /** Allow a cleartext `http://` `baseURL` on a network you trust, such as a REST proxy. Default false. */
    allowInsecureBaseURL?: boolean;
}
