/** Discord API snowflake identifier. */
export type Snowflake = string;

/** Gateway intent bit flags supported by Discord. */
export const GatewayIntentBits = {
    /** Guild lifecycle events. */ Guilds: 1 << 0,
    /** Guild member events. */ GuildMembers: 1 << 1,
    /** Guild moderation events. */ GuildModeration: 1 << 2,
    /** Guild expression events. */ GuildExpressions: 1 << 3,
    /** Guild integration events. */ GuildIntegrations: 1 << 4,
    /** Guild webhook events. */ GuildWebhooks: 1 << 5,
    /** Guild invite events. */ GuildInvites: 1 << 6,
    /** Guild voice state events. */ GuildVoiceStates: 1 << 7,
    /** Guild presence events. */ GuildPresences: 1 << 8,
    /** Guild message events. */ GuildMessages: 1 << 9,
    /** Guild message reaction events. */ GuildMessageReactions: 1 << 10,
    /** Guild message typing events. */ GuildMessageTyping: 1 << 11,
    /** Direct message events. */ DirectMessages: 1 << 12,
    /** Direct message reaction events. */ DirectMessageReactions: 1 << 13,
    /** Direct message typing events. */ DirectMessageTyping: 1 << 14,
    /** Message content intent. */ MessageContent: 1 << 15,
    /** Scheduled event events. */ GuildScheduledEvents: 1 << 16,
    /** Auto moderation configuration events. */ AutoModerationConfiguration: 1 << 20,
    /** Auto moderation execution events. */ AutoModerationExecution: 1 << 21,
    /** Guild message poll events. */ GuildMessagePolls: 1 << 24,
    /** Direct message poll events. */ DirectMessagePolls: 1 << 25
} as const;

/** Client configuration. */
export interface ClientOptions {
    /** Discord bot token. */ token: string;
    /** Gateway intents. */ intents: number;
    /** Gateway configuration. */ gateway?: GatewayOptions;
    /** REST configuration. */ rest?: RESTOptions;
}

/** Gateway connection configuration. */
export interface GatewayOptions {
    /** Enables automatic reconnects. @default true */ reconnect?: boolean;
    /** Maximum reconnect attempts. @default Infinity */ maxReconnectAttempts?: number;
    /** Initial reconnect delay. @default 1000 */ reconnectBaseDelay?: number;
    /** Maximum reconnect delay. @default 30000 */ reconnectMaxDelay?: number;
    /** Shard ID. @default 0 */ shardId?: number;
    /** Total shard count. @default 1 */ shardCount?: number;
}

/** REST request configuration. */
export interface RESTOptions {
    /** Request timeout in milliseconds. @default 15000 */ timeout?: number;
    /** Retry count for retryable failures. @default 2 */ retries?: number;
}

/** Discord user object. */
export interface UserData {
    /** User ID. */ id: Snowflake;
    /** Username. */ username: string;
    /** Legacy discriminator. */ discriminator: string;
    /** Global display name. */ global_name?: string | null;
    /** Avatar hash. */ avatar?: string | null;
    /** Whether this account is a bot. */ bot?: boolean;
}

/** Current authenticated bot user. */
export type ClientUser = UserData;

/** Discord Gateway payload envelope. */
export interface GatewayPayload<T = unknown> {
    /** Gateway operation code. */ op: number;
    /** Event data. */ d: T | null;
    /** Sequence number. */ s: number | null;
    /** Event name. */ t: string | null;
}
