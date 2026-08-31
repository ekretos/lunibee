/** Discord API snowflake identifier. */
export type Snowflake = string;

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

/** Alias for IntentBits. */
export const Intents = IntentBits;

/** Gateway intent resolvable value (single bitfield, enum key, or array of bitfields/strings). */
export type GatewayIntentResolvable =
  | number
  | keyof typeof GatewayIntentBits
  | keyof typeof IntentBits
  | (
      number | keyof typeof GatewayIntentBits | keyof typeof IntentBits | string
    )[];

/** Resolves any GatewayIntentResolvable into a raw bitfield integer. */
export function resolveGatewayIntents(
  intents: GatewayIntentResolvable,
): number {
  if (typeof intents === "number") return intents;
  if (Array.isArray(intents)) {
    return intents.reduce<number>((acc, intent) => {
      return acc | resolveGatewayIntents(intent as any);
    }, 0);
  }
  if (typeof intents === "string") {
    if (intents in GatewayIntentBits)
      return (GatewayIntentBits as Record<string, number>)[intents]!;
    if (intents in IntentBits)
      return (IntentBits as Record<string, number>)[intents]!;
    const lower = intents.charAt(0).toLowerCase() + intents.slice(1);
    if (lower in IntentBits)
      return (IntentBits as Record<string, number>)[lower]!;
    const num = Number(intents);
    if (!Number.isNaN(num)) return num;
  }
  return 0;
}

// ─── Gateway Config ───────────────────────────────────────────────────────────

/** Gateway connection properties (OS, browser, device). */
export interface GatewayProperties {
  os?: string;
  browser?: string;
  device?: string;
  [key: string]: unknown;
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
  rest?: RESTOptions;
}
/** Gateway connection configuration. */
export interface GatewayOptions {
  intents?: GatewayIntentResolvable;
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
  baseURL?: string;
}

// ─── Core Discord Objects ─────────────────────────────────────────────────────

/** Discord user object. */
export interface UserData {
  id: Snowflake;
  username: string;
  discriminator?: string;
  global_name?: string | null;
  avatar?: string | null;
  bot?: boolean;
  system?: boolean;
  public_flags?: number;
}
/** Current authenticated bot user. */
export type ClientUser = UserData;
/** Discord Gateway payload envelope. */
export interface GatewayPayload<T = unknown> {
  op: number;
  d: T | null;
  s: number | null;
  t: string | null;
}
/** Generic Discord API error payload. */
export interface APIError {
  code?: number;
  message?: string;
  errors?: Record<string, unknown>;
}

// ─── Discord Flags & Enums ────────────────────────────────────────────────────

/** Discord message flags. */
export const MessageFlags = {
  Crossposted: 1,
  IsCrosspost: 2,
  SuppressEmbeds: 4,
  SourceMessageDeleted: 8,
  Urgent: 16,
  HasThread: 32,
  Ephemeral: 64,
  Loading: 128,
  IsComponentsV2: 32768,
} as const;

/** Discord channel types. */
export const ChannelType = {
  GuildText: 0,
  DM: 1,
  GuildVoice: 2,
  GroupDM: 3,
  GuildCategory: 4,
  GuildAnnouncement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
  GuildStageVoice: 13,
  GuildDirectory: 14,
  GuildForum: 15,
  GuildMedia: 16,
} as const;

/** Discord component types. */
export const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  TextInput: 4,
  UserSelect: 5,
  RoleSelect: 6,
  MentionableSelect: 7,
  ChannelSelect: 8,
  Section: 9,
  TextDisplay: 10,
  Thumbnail: 11,
  MediaGallery: 12,
  File: 13,
  Separator: 14,
  ContentInventoryEntry: 16,
  Container: 17,
} as const;

/** Discord button style types. */
export const ButtonStyle = {
  Primary: 1,
  Secondary: 2,
  Success: 3,
  Danger: 4,
  Link: 5,
  Premium: 6,
} as const;

/** Discord text input style types. */
export const TextInputStyle = {
  Short: 1,
  Paragraph: 2,
} as const;

/** Discord interaction response types. */
export const InteractionResponseType = {
  Pong: 1,
  ChannelMessage: 4,
  DeferredChannelMessage: 5,
  DeferredMessageUpdate: 6,
  MessageUpdate: 7,
  Autocomplete: 8,
  Modal: 9,
} as const;

/** Discord sticker format types. */
export const StickerFormatType = {
  PNG: 1,
  APNG: 2,
  Lottie: 3,
  GIF: 4,
} as const;

/** Discord sticker types. */
export const StickerType = {
  Standard: 1,
  Guild: 2,
} as const;

/** Discord verification levels. */
export const VerificationLevel = {
  None: 0,
  Low: 1,
  Medium: 2,
  High: 3,
  VeryHigh: 4,
} as const;

/** Discord premium tiers. */
export const PremiumTier = {
  None: 0,
  Tier1: 1,
  Tier2: 2,
  Tier3: 3,
} as const;

// ─── Embeds ───────────────────────────────────────────────────────────────────

/** Raw Discord embed footer object. */
export interface APIEmbedFooter {
  text: string;
  icon_url?: string;
  proxy_icon_url?: string;
}
/** Raw Discord embed image/thumbnail/video object. */
export interface APIEmbedMedia {
  url: string;
  proxy_url?: string;
  height?: number;
  width?: number;
}
/** Raw Discord embed provider object. */
export interface APIEmbedProvider {
  name?: string;
  url?: string;
}
/** Raw Discord embed author object. */
export interface APIEmbedAuthor {
  name: string;
  url?: string;
  icon_url?: string;
  proxy_icon_url?: string;
}
/** Raw Discord embed field object. */
export interface APIEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}
/** Raw Discord embed object. */
export interface APIEmbed {
  title?: string;
  type?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: APIEmbedFooter;
  image?: APIEmbedMedia;
  thumbnail?: APIEmbedMedia;
  video?: APIEmbedMedia;
  provider?: APIEmbedProvider;
  author?: APIEmbedAuthor;
  fields?: APIEmbedField[];
}

// ─── Message Components ───────────────────────────────────────────────────────

/** Raw Discord select menu option. */
export interface APISelectMenuOption {
  label: string;
  value: string;
  description?: string;
  emoji?: APIPartialEmoji;
  default?: boolean;
}
/** Raw Discord emoji (partial, as used in components). */
export interface APIPartialEmoji {
  id?: Snowflake | null;
  name?: string | null;
  animated?: boolean;
}
/** Raw Discord button component. */
export interface APIButtonComponent {
  type: 2;
  style: number;
  label?: string;
  emoji?: APIPartialEmoji;
  custom_id?: string;
  url?: string;
  sku_id?: string;
  disabled?: boolean;
}
/** Raw Discord select menu component. */
export interface APISelectMenuComponent {
  type: 3 | 5 | 6 | 7 | 8;
  custom_id: string;
  options?: APISelectMenuOption[];
  channel_types?: number[];
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  disabled?: boolean;
}
/** Raw Discord text input component. */
export interface APITextInputComponent {
  type: 4;
  custom_id: string;
  style: number;
  label: string;
  min_length?: number;
  max_length?: number;
  required?: boolean;
  value?: string;
  placeholder?: string;
}
/** Union of all raw message component types. */
export type APIMessageActionRowComponent =
  APIButtonComponent | APISelectMenuComponent | APITextInputComponent;
/** Raw Discord action row component. */
export interface APIActionRowComponent {
  type: 1;
  id?: number;
  components: APIMessageActionRowComponent[];
}
/** Union including action rows and V2 components. */
export type APIMessageComponent = APIActionRowComponent | { type: Exclude<number, 1>; [key: string]: any };

// ─── Attachments ─────────────────────────────────────────────────────────────

/** Raw Discord attachment object. */
export interface APIAttachment {
  id: Snowflake;
  filename: string;
  description?: string | null;
  content_type?: string;
  size: number;
  url: string;
  proxy_url: string;
  height?: number | null;
  width?: number | null;
  ephemeral?: boolean;
  duration_secs?: number;
  waveform?: string;
  flags?: number;
}

// ─── Stickers ────────────────────────────────────────────────────────────────

/** Compact sticker item as included in messages. */
export interface APIStickerItem {
  id: Snowflake;
  name: string;
  format_type: number;
}
/** Full Discord sticker object. */
export interface APISticker {
  id: Snowflake;
  pack_id?: Snowflake;
  name: string;
  description?: string | null;
  tags?: string;
  type: number;
  format_type: number;
  available?: boolean;
  guild_id?: Snowflake;
  user?: UserData;
  sort_value?: number;
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** Raw Discord message reference. */
export interface APIMessageReference {
  type?: number;
  message_id?: Snowflake;
  channel_id?: Snowflake;
  guild_id?: Snowflake;
  fail_if_not_exists?: boolean;
}
/** Raw Discord message reaction. */
export interface APIMessageReaction {
  count: number;
  count_details?: Record<string, number>;
  me?: boolean;
  me_burst?: boolean;
  emoji: APIPartialEmoji;
  burst_colors?: string[];
}
/** Raw Discord message object. */
export interface APIMessage {
  id: Snowflake;
  channel_id: Snowflake;
  author: UserData;
  content: string;
  timestamp?: string;
  edited_timestamp?: string | null;
  tts?: boolean;
  mention_everyone?: boolean;
  mentions?: UserData[];
  mention_roles?: Snowflake[];
  mention_channels?: Array<Record<string, unknown>>;
  attachments?: APIAttachment[];
  embeds?: APIEmbed[];
  reactions?: APIMessageReaction[];
  nonce?: string | number | null;
  pinned?: boolean;
  webhook_id?: Snowflake;
  type?: number;
  activity?: Record<string, unknown>;
  application?: Record<string, unknown>;
  application_id?: Snowflake;
  message_reference?: APIMessageReference;
  flags?: number;
  referenced_message?: APIMessage | null;
  interaction_metadata?: Record<string, unknown>;
  thread?: Record<string, unknown>;
  components?: APIMessageComponent[];
  sticker_items?: APIStickerItem[];
  stickers?: APISticker[];
  position?: number;
  role_subscription_data?: Record<string, unknown>;
  purchase_notification?: Record<string, unknown>;
  poll?: Record<string, unknown>;
  guild_id?: Snowflake;
}

// ─── Channels ────────────────────────────────────────────────────────────────

/** Raw Discord channel object. */
export interface APIChannel {
  id: Snowflake;
  type: number;
  guild_id?: Snowflake;
  position?: number;
  permission_overwrites?: Array<Record<string, unknown>>;
  name?: string | null;
  topic?: string | null;
  nsfw?: boolean;
  last_message_id?: Snowflake | null;
  bitrate?: number;
  user_limit?: number;
  rate_limit_per_user?: number;
  recipients?: UserData[];
  icon?: string | null;
  owner_id?: Snowflake;
  application_id?: Snowflake;
  parent_id?: Snowflake | null;
  last_pin_timestamp?: string | null;
  rtc_region?: string | null;
  video_quality_mode?: number;
  message_count?: number;
  member_count?: number;
  thread_metadata?: APIThreadMetadata;
  default_auto_archive_duration?: number;
  flags?: number;
  total_message_sent?: number;
  available_tags?: APIForumTag[];
  default_reaction_emoji?: APIPartialEmoji | null;
  default_thread_rate_limit_per_user?: number;
  default_sort_order?: number | null;
  default_forum_layout?: number;
}

/** Raw Discord thread metadata. */
export interface APIThreadMetadata {
  archived: boolean;
  auto_archive_duration: number;
  archive_timestamp: string;
  locked: boolean;
  invitable?: boolean;
  create_timestamp?: string | null;
}

/** Raw Discord forum tag. */
export interface APIForumTag {
  id: Snowflake;
  name: string;
  moderated: boolean;
  emoji_id?: Snowflake | null;
  emoji_name?: string | null;
}

/** Raw Discord thread member. */
export interface APIThreadMember {
  id?: Snowflake;
  user_id?: Snowflake;
  join_timestamp: string;
  flags: number;
  member?: APIGuildMember;
}

// ─── Roles ────────────────────────────────────────────────────────────────────

/** Raw Discord role object. */
export interface APIRole {
  id: Snowflake;
  name: string;
  color: number;
  hoist: boolean;
  icon?: string | null;
  unicode_emoji?: string | null;
  position: number;
  permissions: string;
  managed: boolean;
  mentionable: boolean;
  tags?: Record<string, unknown>;
  flags?: number;
}

// ─── Emoji ────────────────────────────────────────────────────────────────────

/** Raw Discord emoji object. */
export interface APIEmoji {
  id: Snowflake | null;
  name: string | null;
  roles?: Snowflake[];
  user?: UserData;
  require_colons?: boolean;
  managed?: boolean;
  animated?: boolean;
  available?: boolean;
}

// ─── Guilds ───────────────────────────────────────────────────────────────────

/** Raw Discord guild object. */
export interface APIGuild {
  id: Snowflake;
  name: string;
  icon?: string | null;
  icon_hash?: string | null;
  splash?: string | null;
  discovery_splash?: string | null;
  owner?: boolean;
  owner_id?: Snowflake;
  permissions?: string;
  afk_channel_id?: Snowflake | null;
  afk_timeout?: number;
  widget_enabled?: boolean;
  widget_channel_id?: Snowflake | null;
  verification_level?: number;
  default_message_notifications?: number;
  explicit_content_filter?: number;
  roles?: APIRole[];
  emojis?: APIEmoji[];
  stickers?: APISticker[];
  features?: string[];
  mfa_level?: number;
  application_id?: Snowflake | null;
  system_channel_id?: Snowflake | null;
  system_channel_flags?: number;
  rules_channel_id?: Snowflake | null;
  max_presences?: number | null;
  max_members?: number;
  vanity_url_code?: string | null;
  description?: string | null;
  banner?: string | null;
  premium_tier?: number;
  premium_subscription_count?: number;
  preferred_locale?: string;
  public_updates_channel_id?: Snowflake | null;
  max_video_channel_users?: number;
  approximate_member_count?: number;
  approximate_presence_count?: number;
  nsfw_level?: number;
  safety_alerts_channel_id?: Snowflake | null;
  member_count?: number;
}

/** Raw Discord guild member object. */
export interface APIGuildMember {
  user: UserData;
  nick?: string | null;
  avatar?: string | null;
  roles: Snowflake[];
  joined_at: string;
  premium_since?: string | null;
  deaf?: boolean;
  mute?: boolean;
  flags?: number;
  pending?: boolean;
  permissions?: string;
  communication_disabled_until?: string | null;
  guild_id?: Snowflake;
}

// ─── Voice ────────────────────────────────────────────────────────────────────

/** Raw Discord voice state object. */
export interface APIVoiceState {
  guild_id?: Snowflake;
  channel_id?: Snowflake | null;
  user_id: Snowflake;
  member?: APIGuildMember;
  session_id: string;
  deaf: boolean;
  mute: boolean;
  self_deaf: boolean;
  self_mute: boolean;
  self_stream?: boolean;
  self_video: boolean;
  suppress: boolean;
  request_to_speak_timestamp?: string | null;
}

/** Raw Discord voice server update event. */
export interface APIVoiceServerUpdate {
  token: string;
  guild_id: Snowflake;
  endpoint?: string | null;
}

// ─── Presence ────────────────────────────────────────────────────────────────

/** Raw Discord activity object. */
export interface APIActivity {
  name: string;
  type: number;
  url?: string | null;
  created_at: number;
  state?: string | null;
  details?: string | null;
  emoji?: APIPartialEmoji | null;
}

/** Raw Discord presence update event. */
export interface APIPresenceUpdate {
  user: { id: Snowflake } & Partial<UserData>;
  guild_id: Snowflake;
  status: string;
  activities: APIActivity[];
  client_status: { desktop?: string; mobile?: string; web?: string };
}

// ─── Typing ───────────────────────────────────────────────────────────────────

/** Raw Discord typing start event. */
export interface APITypingStart {
  channel_id: Snowflake;
  guild_id?: Snowflake;
  user_id: Snowflake;
  timestamp: number;
  member?: APIGuildMember;
}

// ─── Guilds ──────────────────────────────────────────────────────────────────

/** Raw Discord guild preview. */
export interface APIGuildPreview {
  id: Snowflake;
  name: string;
  icon: string | null;
  splash: string | null;
  discovery_splash: string | null;
  emojis: unknown[];
  features: string[];
  approximate_member_count: number;
  approximate_presence_count: number;
  description: string | null;
  stickers: unknown[];
}

// ─── Invites ─────────────────────────────────────────────────────────────────

/** Raw Discord invite. */
export interface APIInvite {
  code: string;
  guild?: Partial<APIGuild>;
  channel: Partial<APIChannel>;
  inviter?: UserData;
  target_type?: number;
  target_user?: UserData;
  approximate_presence_count?: number;
  approximate_member_count?: number;
}

/** Raw Discord invite create event. */
export interface APIInviteCreate {
  channel_id: Snowflake;
  code: string;
  created_at: string;
  guild_id?: Snowflake;
  inviter?: UserData;
  max_age: number;
  max_uses: number;
  target_type?: number;
  target_user?: UserData;
  temporary: boolean;
  uses: number;
}

/** Raw Discord invite delete event. */
export interface APIInviteDelete {
  channel_id: Snowflake;
  guild_id?: Snowflake;
  code: string;
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

/** Raw Discord webhooks update event. */
export interface APIWebhooksUpdate {
  guild_id: Snowflake;
  channel_id: Snowflake;
}

/** Raw Discord webhook object. */
export interface APIWebhook {
  id: Snowflake;
  type: number;
  guild_id?: Snowflake | null;
  channel_id?: Snowflake | null;
  user?: UserData;
  name?: string | null;
  avatar?: string | null;
  token?: string;
  application_id?: Snowflake | null;
  url?: string;
}

// ─── AutoMod ─────────────────────────────────────────────────────────────────

/** Raw Discord AutoMod action. */
export interface APIAutoModerationAction {
  type: number;
  metadata?: {
    channel_id?: Snowflake;
    duration_seconds?: number;
    custom_message?: string;
  };
}

/** Raw Discord AutoMod rule object. */
export interface APIAutoModerationRule {
  id: Snowflake;
  guild_id: Snowflake;
  name: string;
  creator_id: Snowflake;
  event_type: number;
  trigger_type: number;
  trigger_metadata: Record<string, unknown>;
  actions: APIAutoModerationAction[];
  enabled: boolean;
  exempt_roles: Snowflake[];
  exempt_channels: Snowflake[];
}

/** Raw Discord AutoMod action execution event. */
export interface APIAutoModerationActionExecution {
  guild_id: Snowflake;
  action: APIAutoModerationAction;
  rule_id: Snowflake;
  rule_trigger_type: number;
  user_id: Snowflake;
  channel_id?: Snowflake;
  message_id?: Snowflake;
  alert_system_message_id?: Snowflake;
  content: string;
  matched_keyword?: string | null;
  matched_content?: string | null;
}

// ─── Scheduled Events ─────────────────────────────────────────────────────────

/** Raw Discord guild scheduled event entity metadata. */
export interface APIGuildScheduledEventEntityMetadata {
  location?: string;
}

/** Raw Discord guild scheduled event object. */
export interface APIGuildScheduledEvent {
  id: Snowflake;
  guild_id: Snowflake;
  channel_id?: Snowflake | null;
  creator_id?: Snowflake | null;
  name: string;
  description?: string | null;
  scheduled_start_time: string;
  scheduled_end_time?: string | null;
  privacy_level: number;
  status: number;
  entity_type: number;
  entity_id?: Snowflake | null;
  entity_metadata?: APIGuildScheduledEventEntityMetadata | null;
  creator?: UserData;
  user_count?: number;
  image?: string | null;
}

// ─── Stage Instances ─────────────────────────────────────────────────────────

/** Raw Discord stage instance object. */
export interface APIStageInstance {
  id: Snowflake;
  guild_id: Snowflake;
  channel_id: Snowflake;
  topic: string;
  privacy_level: number;
  discoverable_disabled?: boolean;
  guild_scheduled_event_id?: Snowflake | null;
}

// ─── Application Commands ─────────────────────────────────────────────────────

/** Discord application command option types. */
export const ApplicationCommandOptionType = {
  SubCommand: 1,
  SubCommandGroup: 2,
  String: 3,
  Integer: 4,
  Boolean: 5,
  User: 6,
  Channel: 7,
  Role: 8,
  Mentionable: 9,
  Number: 10,
  Attachment: 11,
} as const;

/** Discord application command types. */
export const ApplicationCommandType = {
  ChatInput: 1,
  User: 2,
  Message: 3,
} as const;

/** Raw Discord application command option. */
export interface APIApplicationCommandOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  choices?: Array<{ name: string; value: string | number }>;
  options?: APIApplicationCommandOption[];
  min_value?: number;
  max_value?: number;
  min_length?: number;
  max_length?: number;
  autocomplete?: boolean;
  channel_types?: number[];
}

/** Raw Discord application command object (from API). */
export interface APIApplicationCommand {
  id: Snowflake;
  type?: number;
  application_id: Snowflake;
  guild_id?: Snowflake;
  name: string;
  description: string;
  options?: APIApplicationCommandOption[];
  default_member_permissions?: string | null;
  dm_permission?: boolean;
  nsfw?: boolean;
  version: Snowflake;
}

/** Data for creating/overwriting an application command. */
export interface ApplicationCommandData {
  name: string;
  description: string;
  type?: number;
  options?: APIApplicationCommandOption[];
  default_member_permissions?: string | null;
  dm_permission?: boolean;
  nsfw?: boolean;
}

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
