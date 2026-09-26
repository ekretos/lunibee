import type {
    APIChannel,
    APIEmoji,
    APIGuildMember,
    APIPartialEmoji,
    APIPresenceUpdate,
    APIRole,
    APISticker,
    APIThreadMember,
    Snowflake,
    UserData,
} from "./index.js";

// ─── Gateway Events ───────────────────────────────────────────────────────────

/** Raw Discord READY event payload. */
export interface APIReadyEvent {
    v: number;
    user: UserData;
    guilds: Array<{ id: Snowflake; unavailable?: boolean }>;
    session_id: string;
    resume_gateway_url: string;
    shard?: [number, number];
    application?: { id: Snowflake; flags: number; [key: string]: unknown };
}

/** Raw Discord reaction event payload. */
export interface APIMessageReactionEvent {
    user_id: Snowflake;
    channel_id: Snowflake;
    message_id: Snowflake;
    guild_id?: Snowflake;
    member?: APIGuildMember;
    emoji: APIPartialEmoji;
    message_author_id?: Snowflake;
    burst?: boolean;
    type?: number;
}

/** Raw Discord reaction remove emoji event payload. */
export interface APIMessageReactionRemoveEmojiEvent {
    channel_id: Snowflake;
    guild_id?: Snowflake;
    message_id: Snowflake;
    emoji: APIPartialEmoji;
}

/** Raw Discord message deletion event payload. */
export interface APIMessageDeleteEvent {
    id: Snowflake;
    channel_id: Snowflake;
    guild_id?: Snowflake;
}

/** Raw Discord bulk message deletion event payload. */
export interface APIMessageDeleteBulkEvent {
    ids: Snowflake[];
    channel_id: Snowflake;
    guild_id?: Snowflake;
}

/** Raw Discord channel deletion event payload. */
export interface APIChannelDeleteEvent extends APIChannel {}

/** Raw Discord guild deletion event payload. */
export interface APIGuildDeleteEvent {
    id: Snowflake;
    unavailable?: boolean;
}

/** Raw Discord thread lifecycle payload. */
export interface APIThreadEvent extends APIChannel {
    guild_id: Snowflake;
    member?: APIThreadMember;
}

/** Raw Discord thread list sync event. */
export interface APIThreadListSync {
    guild_id: Snowflake;
    channel_ids?: Snowflake[];
    threads: APIChannel[];
    members: APIThreadMember[];
}

/** Raw Discord thread members update event. */
export interface APIThreadMembersUpdate {
    id: Snowflake;
    guild_id: Snowflake;
    member_count: number;
    added_members?: APIThreadMember[];
    removed_member_ids?: Snowflake[];
}

/** Raw Discord guild role event payload. */
export interface APIGuildRoleEvent {
    guild_id: Snowflake;
    role: APIRole;
}

/** Raw Discord guild role delete event payload. */
export interface APIGuildRoleDeleteEvent {
    guild_id: Snowflake;
    role_id: Snowflake;
}

/** Raw Discord guild ban event payload. */
export interface APIGuildBanEvent {
    guild_id: Snowflake;
    user: UserData;
}

/** Raw Discord guild emojis update event payload. */
export interface APIGuildEmojisUpdateEvent {
    guild_id: Snowflake;
    emojis: APIEmoji[];
}

/** Raw Discord guild stickers update event payload. */
export interface APIGuildStickersUpdateEvent {
    guild_id: Snowflake;
    stickers: APISticker[];
}

/** Raw Discord channel pins update event. */
export interface APIChannelPinsUpdate {
    guild_id?: Snowflake;
    channel_id: Snowflake;
    last_pin_timestamp?: string | null;
}

/** Raw Discord guild members chunk event. */
export interface APIGuildMembersChunk {
    guild_id: Snowflake;
    members: APIGuildMember[];
    chunk_index: number;
    chunk_count: number;
    not_found?: Snowflake[];
    presences?: APIPresenceUpdate[];
    nonce?: string;
}

/** Raw Discord guild scheduled event user add/remove event. */
export interface APIGuildScheduledEventUserEvent {
    guild_scheduled_event_id: Snowflake;
    user_id: Snowflake;
    guild_id: Snowflake;
}

/** Raw Discord message poll vote add/remove event. */
export interface APIMessagePollVoteEvent {
    user_id: Snowflake;
    channel_id: Snowflake;
    message_id: Snowflake;
    guild_id?: Snowflake;
    answer_id: number;
}
