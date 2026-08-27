/** Gateway intent bit flags supported by Discord. */
export const GatewayIntentBits = {
    /** Guild lifecycle events. */
    Guilds: 1 << 0,
    /** Guild member events. */
    GuildMembers: 1 << 1,
    /** Guild moderation events. */
    GuildModeration: 1 << 2,
    /** Guild expression events. */
    GuildExpressions: 1 << 3,
    /** Guild integration events. */
    GuildIntegrations: 1 << 4,
    /** Guild webhook events. */
    GuildWebhooks: 1 << 5,
    /** Guild invite events. */
    GuildInvites: 1 << 6,
    /** Guild voice state events. */
    GuildVoiceStates: 1 << 7,
    /** Guild presence events. */
    GuildPresences: 1 << 8,
    /** Guild message events. */
    GuildMessages: 1 << 9,
    /** Guild message reaction events. */
    GuildMessageReactions: 1 << 10,
    /** Guild message typing events. */
    GuildMessageTyping: 1 << 11,
    /** Direct message events. */
    DirectMessages: 1 << 12,
    /** Direct message reaction events. */
    DirectMessageReactions: 1 << 13,
    /** Direct message typing events. */
    DirectMessageTyping: 1 << 14,
    /** Message content intent. */
    MessageContent: 1 << 15,
    /** Scheduled event events. */
    GuildScheduledEvents: 1 << 16,
    /** Auto moderation configuration events. */
    AutoModerationConfiguration: 1 << 20,
    /** Auto moderation execution events. */
    AutoModerationExecution: 1 << 21,
    /** Guild message poll events. */
    GuildMessagePolls: 1 << 24,
    /** Direct message poll events. */
    DirectMessagePolls: 1 << 25
} as const;

/** Configuration shared by Lunibee clients. */
export interface ClientOptions {
    /** Discord bot token. */
    token: string;
    /** Gateway intents requested by the client. */
    intents: number;
    /** Gateway connection configuration. */
    gateway?: GatewayOptions;
    /** REST request configuration. */
    rest?: RESTOptions;
}

/** Gateway reconnection configuration. */
export interface GatewayOptions {
    /** Whether failed Gateway connections should reconnect automatically. @default true */
    reconnect?: boolean;
    /** Maximum number of reconnect attempts. @default Infinity */
    maxReconnectAttempts?: number;
    /** Initial reconnect delay in milliseconds. @default 1000 */
    reconnectBaseDelay?: number;
    /** Maximum reconnect delay in milliseconds. @default 30000 */
    reconnectMaxDelay?: number;
}

/** REST transport configuration. */
export interface RESTOptions {
    /** Request timeout in milliseconds. @default 15000 */
    timeout?: number;
    /** Maximum retry attempts for retryable failures. @default 2 */
    retries?: number;
}

/** Discord bot user returned by the current-user endpoint. */
export interface ClientUser {
    /** Discord user ID. */
    id: string;
    /** Discord username. */
    username: string;
    /** Legacy discriminator. */
    discriminator: string;
    /** Display name. */
    global_name?: string | null;
    /** Avatar hash. */
    avatar?: string | null;
    /** Whether Discord identifies this user as a bot. */
    bot?: boolean;
}

/** Discord Gateway payload envelope. */
export interface GatewayPayload<T = unknown> {
    /** Gateway operation code. */
    op: number;
    /** Gateway event data. */
    d: T | null;
    /** Gateway sequence number. */
    s: number | null;
    /** Gateway event name. */
    t: string | null;
}
