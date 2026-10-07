import type {
    APIEntitlement,
    APISoundboardSound,
    APISticker,
} from "@lunibee/types";
import type {
    APIAutoModerationActionExecution,
    APIAutoModerationRule,
    APIChannel,
    APIChannelPinsUpdate,
    APIGuild,
    APIGuildBanEvent,
    APIGuildEmojisUpdateEvent,
    APIGuildMember,
    APIGuildMembersChunk,
    APIGuildRoleDeleteEvent,
    APIGuildRoleEvent,
    APIGuildScheduledEvent,
    APIGuildScheduledEventUserEvent,
    APIGuildStickersUpdateEvent,
    APIInviteCreate,
    APIInviteDelete,
    APIMessageDeleteBulkEvent,
    APIMessageDeleteEvent,
    APIMessagePollVoteEvent,
    APIMessageReactionEvent,
    APIMessageReactionRemoveEmojiEvent,
    APIPresenceUpdate,
    APIStageInstance,
    APIThreadEvent,
    APIThreadListSync,
    APIThreadMember,
    APIThreadMembersUpdate,
    APITypingStart,
    APIVoiceServerUpdate,
    APIVoiceState,
    APIWebhooksUpdate,
    ClientUser,
} from "@lunibee/types";
import type {
    Channel,
    Emoji,
    Guild,
    GuildMember,
    Interaction,
    Message,
    Role,
} from "@lunibee/structures";
/** Names of events emitted by a Lunibee client. */
export enum ClientEvent {
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    Ready = "ready",
    Resumed = "resumed",
    InvalidSession = "invalidSession",
    Raw = "raw",
    Error = "error",
    Open = "open",
    Close = "close",
    // ── Messages ───────────────────────────────────────────────────────────────
    MessageCreate = "messageCreate",
    MessageUpdate = "messageUpdate",
    MessageDelete = "messageDelete",
    MessageDeleteBulk = "messageDeleteBulk",
    // ── Reactions ─────────────────────────────────────────────────────────────
    MessageReactionAdd = "messageReactionAdd",
    MessageReactionRemove = "messageReactionRemove",
    MessageReactionRemoveAll = "messageReactionRemoveAll",
    MessageReactionRemoveEmoji = "messageReactionRemoveEmoji",
    // ── Polls ─────────────────────────────────────────────────────────────────
    MessagePollVoteAdd = "messagePollVoteAdd",
    MessagePollVoteRemove = "messagePollVoteRemove",
    // ── Guilds ────────────────────────────────────────────────────────────────
    GuildCreate = "guildCreate",
    GuildUpdate = "guildUpdate",
    GuildDelete = "guildDelete",
    GuildAvailable = "guildAvailable",
    GuildUnavailable = "guildUnavailable",
    // ── Guild Members ──────────────────────────────────────────────────────────
    GuildMemberAdd = "guildMemberAdd",
    GuildMemberUpdate = "guildMemberUpdate",
    GuildMemberRemove = "guildMemberRemove",
    GuildMembersChunk = "guildMembersChunk",
    // ── Guild Bans ────────────────────────────────────────────────────────────
    GuildBanAdd = "guildBanAdd",
    GuildBanRemove = "guildBanRemove",
    // ── Guild Roles ───────────────────────────────────────────────────────────
    GuildRoleCreate = "guildRoleCreate",
    GuildRoleUpdate = "guildRoleUpdate",
    GuildRoleDelete = "guildRoleDelete",
    // ── Guild Emojis & Stickers ───────────────────────────────────────────────
    GuildEmojisUpdate = "guildEmojisUpdate",
    GuildStickersUpdate = "guildStickersUpdate",
    // ── Monetization ──────────────────────────────────────────────────────────
    EntitlementCreate = "entitlementCreate",
    EntitlementUpdate = "entitlementUpdate",
    EntitlementDelete = "entitlementDelete",
    // ── Soundboard ────────────────────────────────────────────────────────────
    SoundboardSoundCreate = "soundboardSoundCreate",
    SoundboardSoundUpdate = "soundboardSoundUpdate",
    SoundboardSoundDelete = "soundboardSoundDelete",
    SoundboardSoundsUpdate = "soundboardSoundsUpdate",
    // ── Guild Integrations ────────────────────────────────────────────────────
    GuildIntegrationsUpdate = "guildIntegrationsUpdate",
    // ── Guild Scheduled Events ────────────────────────────────────────────────
    GuildScheduledEventCreate = "guildScheduledEventCreate",
    GuildScheduledEventUpdate = "guildScheduledEventUpdate",
    GuildScheduledEventDelete = "guildScheduledEventDelete",
    GuildScheduledEventUserAdd = "guildScheduledEventUserAdd",
    GuildScheduledEventUserRemove = "guildScheduledEventUserRemove",
    // ── AutoMod ───────────────────────────────────────────────────────────────
    AutoModerationRuleCreate = "autoModerationRuleCreate",
    AutoModerationRuleUpdate = "autoModerationRuleUpdate",
    AutoModerationRuleDelete = "autoModerationRuleDelete",
    AutoModerationActionExecution = "autoModerationActionExecution",
    // ── Channels ──────────────────────────────────────────────────────────────
    ChannelCreate = "channelCreate",
    ChannelUpdate = "channelUpdate",
    ChannelDelete = "channelDelete",
    ChannelPinsUpdate = "channelPinsUpdate",
    // ── Threads ───────────────────────────────────────────────────────────────
    ThreadCreate = "threadCreate",
    ThreadUpdate = "threadUpdate",
    ThreadDelete = "threadDelete",
    ThreadListSync = "threadListSync",
    ThreadMembersUpdate = "threadMembersUpdate",
    ThreadMemberUpdate = "threadMemberUpdate",
    // ── Stage Instances ───────────────────────────────────────────────────────
    StageInstanceCreate = "stageInstanceCreate",
    StageInstanceUpdate = "stageInstanceUpdate",
    StageInstanceDelete = "stageInstanceDelete",
    // ── Invites ───────────────────────────────────────────────────────────────
    InviteCreate = "inviteCreate",
    InviteDelete = "inviteDelete",
    // ── Webhooks ──────────────────────────────────────────────────────────────
    WebhooksUpdate = "webhooksUpdate",
    // ── Voice ─────────────────────────────────────────────────────────────────
    VoiceStateUpdate = "voiceStateUpdate",
    VoiceServerUpdate = "voiceServerUpdate",
    // ── Presence & Typing ─────────────────────────────────────────────────────
    PresenceUpdate = "presenceUpdate",
    TypingStart = "typingStart",
    // ── Interactions ──────────────────────────────────────────────────────────
    InteractionCreate = "interactionCreate",
}

/** Names of events emitted by a Lunibee client. */
export type ClientEventName = keyof ClientEvents;

/** Listener signature for a Lunibee client event. */
export type ClientListener<K extends ClientEventName> = (
    ...args: ClientEvents[K]
) => unknown;

// ─── ClientEvents type map ────────────────────────────────────────────────────
// Uses string literal keys so client.on("ready", ...) works without using
// the ClientEvent enum explicitly.

export type ClientEvents = {
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    ready: [user: ClientUser];
    resumed: [];
    invalidSession: [isRecoverable: boolean];
    raw: [data: { event: string; data: unknown }];
    error: [error: Error];
    open: [];
    close: [data: { code: number; action: string }];
    // ── Messages ───────────────────────────────────────────────────────────────
    messageCreate: [message: Message];
    /** `previous` is the cached version, or `null` unless `messageCache` is enabled and the message was cached. */
    messageUpdate: [message: Message, previous: Message | null];
    /** `message` is the cached message, available when `messageCache` is enabled. */
    messageDelete: [data: APIMessageDeleteEvent, message?: Message];
    /** `messages` are the cached messages that were deleted (empty without `messageCache`). */
    messageDeleteBulk: [data: APIMessageDeleteBulkEvent, messages: Message[]];
    // ── Reactions ─────────────────────────────────────────────────────────────
    messageReactionAdd: [data: APIMessageReactionEvent];
    messageReactionRemove: [data: APIMessageReactionEvent];
    messageReactionRemoveAll: [data: APIMessageDeleteEvent];
    messageReactionRemoveEmoji: [data: APIMessageReactionRemoveEmojiEvent];
    // ── Polls ─────────────────────────────────────────────────────────────────
    messagePollVoteAdd: [data: APIMessagePollVoteEvent];
    messagePollVoteRemove: [data: APIMessagePollVoteEvent];
    // ── Guilds ────────────────────────────────────────────────────────────────
    guildCreate: [data: APIGuild];
    /** `previous` is a copy of the cached guild before the update, or null when it was not cached. */
    guildUpdate: [data: APIGuild, previous: Guild | null];
    guildDelete: [data: { id: string; unavailable?: boolean }];
    guildAvailable: [data: APIGuild & { unavailable?: boolean }];
    guildUnavailable: [data: { id: string; unavailable?: boolean }];
    // ── Guild Members ──────────────────────────────────────────────────────────
    guildMemberAdd: [member: APIGuildMember];
    /** `previous` is a copy of the cached member before the update, or null when it was not cached. */
    guildMemberUpdate: [member: APIGuildMember, previous: GuildMember | null];
    guildMemberRemove: [member: APIGuildMember];
    guildMembersChunk: [data: APIGuildMembersChunk];
    // ── Guild Bans ────────────────────────────────────────────────────────────
    guildBanAdd: [data: APIGuildBanEvent];
    guildBanRemove: [data: APIGuildBanEvent];
    // ── Guild Roles ───────────────────────────────────────────────────────────
    guildRoleCreate: [data: APIGuildRoleEvent];
    /** `previous` is a copy of the cached role before the update, or null when it was not cached. */
    guildRoleUpdate: [data: APIGuildRoleEvent, previous: Role | null];
    /** `removed` is the role that was cached, or null. */
    guildRoleDelete: [data: APIGuildRoleDeleteEvent, removed: Role | null];
    // ── Guild Emojis & Stickers ───────────────────────────────────────────────
    /** `previous` is the cached emoji list before the update, or null without the emoji cache. */
    guildEmojisUpdate: [
        data: APIGuildEmojisUpdateEvent,
        previous: Emoji[] | null,
    ];
    /** `previous` is the cached sticker list before the update (empty when none were cached). */
    guildStickersUpdate: [
        data: APIGuildStickersUpdateEvent,
        previous: APISticker[],
    ];
    // ── Monetization ──────────────────────────────────────────────────────────
    entitlementCreate: [entitlement: APIEntitlement];
    entitlementUpdate: [entitlement: APIEntitlement];
    entitlementDelete: [entitlement: APIEntitlement];
    // ── Soundboard ────────────────────────────────────────────────────────────
    soundboardSoundCreate: [sound: APISoundboardSound];
    soundboardSoundUpdate: [sound: APISoundboardSound];
    soundboardSoundDelete: [data: { sound_id: string; guild_id: string }];
    soundboardSoundsUpdate: [
        data: { guild_id: string; soundboard_sounds: APISoundboardSound[] },
    ];
    // ── Guild Integrations ────────────────────────────────────────────────────
    guildIntegrationsUpdate: [data: { guild_id: string }];
    // ── Guild Scheduled Events ────────────────────────────────────────────────
    guildScheduledEventCreate: [data: APIGuildScheduledEvent];
    /** `previous` is the cached event, or `null` if it was not cached. */
    guildScheduledEventUpdate: [
        data: APIGuildScheduledEvent,
        previous: APIGuildScheduledEvent | null,
    ];
    guildScheduledEventDelete: [data: APIGuildScheduledEvent];
    guildScheduledEventUserAdd: [data: APIGuildScheduledEventUserEvent];
    guildScheduledEventUserRemove: [data: APIGuildScheduledEventUserEvent];
    // ── AutoMod ───────────────────────────────────────────────────────────────
    autoModerationRuleCreate: [data: APIAutoModerationRule];
    /** `previous` is the cached rule, or `null` if it was not cached. */
    autoModerationRuleUpdate: [
        data: APIAutoModerationRule,
        previous: APIAutoModerationRule | null,
    ];
    autoModerationRuleDelete: [data: APIAutoModerationRule];
    autoModerationActionExecution: [data: APIAutoModerationActionExecution];
    // ── Channels ──────────────────────────────────────────────────────────────
    channelCreate: [channel: Channel];
    /** `previous` is a copy of the cached channel before the update, or null when it was not cached. */
    channelUpdate: [channel: Channel, previous: Channel | null];
    /** `removed` is the channel that was cached, or null. */
    channelDelete: [data: APIChannel, removed: Channel | null];
    channelPinsUpdate: [data: APIChannelPinsUpdate];
    // ── Threads ───────────────────────────────────────────────────────────────
    threadCreate: [channel: Channel];
    /** `previous` is a copy of the cached thread before the update, or null when it was not cached. */
    threadUpdate: [channel: Channel, previous: Channel | null];
    /** `removed` is the thread that was cached, or null. */
    threadDelete: [data: APIThreadEvent, removed: Channel | null];
    threadListSync: [data: APIThreadListSync];
    threadMembersUpdate: [data: APIThreadMembersUpdate];
    threadMemberUpdate: [data: APIThreadMember];
    // ── Stage Instances ───────────────────────────────────────────────────────
    stageInstanceCreate: [data: APIStageInstance];
    /** `previous` is the cached stage instance, or `null` if it was not cached. */
    stageInstanceUpdate: [
        data: APIStageInstance,
        previous: APIStageInstance | null,
    ];
    stageInstanceDelete: [data: APIStageInstance];
    // ── Invites ───────────────────────────────────────────────────────────────
    inviteCreate: [data: APIInviteCreate];
    inviteDelete: [data: APIInviteDelete];
    // ── Webhooks ──────────────────────────────────────────────────────────────
    webhooksUpdate: [data: APIWebhooksUpdate];
    // ── Voice ─────────────────────────────────────────────────────────────────
    /** `previous` is the user's last known voice state in that guild, or `null` (first sighting, or not in a guild). */
    voiceStateUpdate: [data: APIVoiceState, previous: APIVoiceState | null];
    voiceServerUpdate: [data: APIVoiceServerUpdate];
    // ── Presence & Typing ─────────────────────────────────────────────────────
    /** `previous` is the last presence seen, available with `cache: { presences: true }`; otherwise `null`. */
    presenceUpdate: [
        data: APIPresenceUpdate,
        previous: APIPresenceUpdate | null,
    ];
    typingStart: [data: APITypingStart];
    // ── Interactions ──────────────────────────────────────────────────────────
    interactionCreate: [interaction: Interaction];
};
