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
import type { Channel, Interaction, Message } from "@lunibee/structures";
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
    messageUpdate: [message: Message];
    messageDelete: [data: APIMessageDeleteEvent];
    messageDeleteBulk: [data: APIMessageDeleteBulkEvent];
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
    guildUpdate: [data: APIGuild];
    guildDelete: [data: { id: string; unavailable?: boolean }];
    guildAvailable: [data: APIGuild & { unavailable?: boolean }];
    guildUnavailable: [data: { id: string; unavailable?: boolean }];
    // ── Guild Members ──────────────────────────────────────────────────────────
    guildMemberAdd: [member: APIGuildMember];
    guildMemberUpdate: [member: APIGuildMember];
    guildMemberRemove: [member: APIGuildMember];
    guildMembersChunk: [data: APIGuildMembersChunk];
    // ── Guild Bans ────────────────────────────────────────────────────────────
    guildBanAdd: [data: APIGuildBanEvent];
    guildBanRemove: [data: APIGuildBanEvent];
    // ── Guild Roles ───────────────────────────────────────────────────────────
    guildRoleCreate: [data: APIGuildRoleEvent];
    guildRoleUpdate: [data: APIGuildRoleEvent];
    guildRoleDelete: [data: APIGuildRoleDeleteEvent];
    // ── Guild Emojis & Stickers ───────────────────────────────────────────────
    guildEmojisUpdate: [data: APIGuildEmojisUpdateEvent];
    guildStickersUpdate: [data: APIGuildStickersUpdateEvent];
    // ── Guild Integrations ────────────────────────────────────────────────────
    guildIntegrationsUpdate: [data: { guild_id: string }];
    // ── Guild Scheduled Events ────────────────────────────────────────────────
    guildScheduledEventCreate: [data: APIGuildScheduledEvent];
    guildScheduledEventUpdate: [data: APIGuildScheduledEvent];
    guildScheduledEventDelete: [data: APIGuildScheduledEvent];
    guildScheduledEventUserAdd: [data: APIGuildScheduledEventUserEvent];
    guildScheduledEventUserRemove: [data: APIGuildScheduledEventUserEvent];
    // ── AutoMod ───────────────────────────────────────────────────────────────
    autoModerationRuleCreate: [data: APIAutoModerationRule];
    autoModerationRuleUpdate: [data: APIAutoModerationRule];
    autoModerationRuleDelete: [data: APIAutoModerationRule];
    autoModerationActionExecution: [data: APIAutoModerationActionExecution];
    // ── Channels ──────────────────────────────────────────────────────────────
    channelCreate: [channel: Channel];
    channelUpdate: [channel: Channel];
    channelDelete: [data: APIChannel];
    channelPinsUpdate: [data: APIChannelPinsUpdate];
    // ── Threads ───────────────────────────────────────────────────────────────
    threadCreate: [channel: Channel];
    threadUpdate: [channel: Channel];
    threadDelete: [data: APIThreadEvent];
    threadListSync: [data: APIThreadListSync];
    threadMembersUpdate: [data: APIThreadMembersUpdate];
    threadMemberUpdate: [data: APIThreadMember];
    // ── Stage Instances ───────────────────────────────────────────────────────
    stageInstanceCreate: [data: APIStageInstance];
    stageInstanceUpdate: [data: APIStageInstance];
    stageInstanceDelete: [data: APIStageInstance];
    // ── Invites ───────────────────────────────────────────────────────────────
    inviteCreate: [data: APIInviteCreate];
    inviteDelete: [data: APIInviteDelete];
    // ── Webhooks ──────────────────────────────────────────────────────────────
    webhooksUpdate: [data: APIWebhooksUpdate];
    // ── Voice ─────────────────────────────────────────────────────────────────
    voiceStateUpdate: [data: APIVoiceState];
    voiceServerUpdate: [data: APIVoiceServerUpdate];
    // ── Presence & Typing ─────────────────────────────────────────────────────
    presenceUpdate: [data: APIPresenceUpdate];
    typingStart: [data: APITypingStart];
    // ── Interactions ──────────────────────────────────────────────────────────
    interactionCreate: [interaction: Interaction];
};
