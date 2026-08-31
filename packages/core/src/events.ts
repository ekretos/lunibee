// Note: ClientEvents is defined in index.ts to avoid a circular import.
// ClientEventName and ClientListener are re-exported from there.

/** Names of events emitted by a Lunibee client. */
export enum ClientEvent {
  // ── Lifecycle ──────────────────────────────────────────────────────────────
  Ready = "ready",
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
export type ClientEventName = keyof import("./index.js").ClientEvents;

/** Listener signature for a Lunibee client event. */
export type ClientListener<K extends ClientEventName> = (
  ...args: import("./index.js").ClientEvents[K]
) => unknown;
