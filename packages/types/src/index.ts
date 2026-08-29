/** Discord API snowflake identifier. */
export type Snowflake = string;

/** Gateway intent bit flags supported by Discord. */
export const GatewayIntentBits = {
    Guilds: 1 << 0, GuildMembers: 1 << 1, GuildModeration: 1 << 2, GuildExpressions: 1 << 3, GuildIntegrations: 1 << 4,
    GuildWebhooks: 1 << 5, GuildInvites: 1 << 6, GuildVoiceStates: 1 << 7, GuildPresences: 1 << 8, GuildMessages: 1 << 9,
    GuildMessageReactions: 1 << 10, GuildMessageTyping: 1 << 11, DirectMessages: 1 << 12, DirectMessageReactions: 1 << 13,
    DirectMessageTyping: 1 << 14, MessageContent: 1 << 15, GuildScheduledEvents: 1 << 16,
    AutoModerationConfiguration: 1 << 20, AutoModerationExecution: 1 << 21, GuildMessagePolls: 1 << 24, DirectMessagePolls: 1 << 25
} as const;

/** Client configuration. */
export interface ClientOptions { token: string; intents: number; gateway?: GatewayOptions; rest?: RESTOptions; }
/** Gateway connection configuration. */
export interface GatewayOptions { reconnect?: boolean; maxReconnectAttempts?: number; reconnectBaseDelay?: number; reconnectMaxDelay?: number; shardId?: number; shardCount?: number; }
/** REST request configuration. */
export interface RESTOptions { timeout?: number; retries?: number; baseURL?: string; }
/** Discord user object. */
export interface UserData { id: Snowflake; username: string; discriminator?: string; global_name?: string | null; avatar?: string | null; bot?: boolean; system?: boolean; public_flags?: number; }
/** Discord API channel object. */
export interface APIChannel { id: Snowflake; type: number; name?: string | null; guild_id?: Snowflake; position?: number; topic?: string | null; last_message_id?: Snowflake | null; parent_id?: Snowflake | null; permission_overwrites?: unknown[]; nsfw?: boolean; rate_limit_per_user?: number; }
/** Discord API attachment object. */
export interface APIAttachment { id: Snowflake; filename: string; description?: string | null; content_type?: string; size: number; url: string; proxy_url: string; height?: number | null; width?: number | null; ephemeral?: boolean; duration_secs?: number; waveform?: string; }
/** Discord API embed object. */
export interface APIEmbed { title?: string; type?: string; description?: string; url?: string; timestamp?: string; color?: number; footer?: Record<string, unknown>; image?: Record<string, unknown>; thumbnail?: Record<string, unknown>; video?: Record<string, unknown>; provider?: Record<string, unknown>; author?: Record<string, unknown>; fields?: Array<Record<string, unknown>>; }
/** Discord API message object. */
export interface APIMessage { id: Snowflake; channel_id: Snowflake; author: UserData; content: string; timestamp?: string; edited_timestamp?: string | null; tts?: boolean; mention_everyone?: boolean; mentions?: UserData[]; mention_roles?: Snowflake[]; attachments?: APIAttachment[]; embeds?: APIEmbed[]; reactions?: unknown[]; nonce?: string | number | null; pinned?: boolean; webhook_id?: Snowflake; type?: number; activity?: unknown; application?: unknown; application_id?: Snowflake; message_reference?: Record<string, unknown>; flags?: number; referenced_message?: APIMessage | null; interaction_metadata?: Record<string, unknown>; thread?: APIChannel; components?: unknown[]; sticker_items?: unknown[]; stickers?: unknown[]; position?: number; role_subscription_data?: Record<string, unknown>; purchase_notification?: Record<string, unknown>; poll?: unknown; call?: unknown; }
/** Current authenticated bot user. */
export type ClientUser = UserData;
/** Discord Gateway payload envelope. */
export interface GatewayPayload<T = unknown> { op: number; d: T | null; s: number | null; t: string | null; }
/** Generic Discord API error payload. */
export interface APIError { code?: number; message?: string; errors?: Record<string, unknown>; }
/** Discord message flags. */
export const MessageFlags = { Crossposted: 1, IsCrosspost: 2, SuppressEmbeds: 4, SourceMessageDeleted: 8, Urgent: 16, HasThread: 32, Ephemeral: 64, Loading: 128, IsComponentsV2: 32768 } as const;
/** Discord channel types. */
export const ChannelType = { GuildText: 0, DM: 1, GuildVoice: 2, GroupDM: 3, GuildCategory: 4, GuildAnnouncement: 5, AnnouncementThread: 10, PublicThread: 11, PrivateThread: 12, GuildStageVoice: 13, GuildDirectory: 14, GuildForum: 15, GuildMedia: 16 } as const;
