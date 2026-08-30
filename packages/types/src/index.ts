/** Discord API snowflake identifier. */
export type Snowflake = string;

/** Gateway intent bit flags supported by Discord. */
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
  intents: number;
  gateway?: GatewayOptions;
  rest?: RESTOptions;
}
/** Gateway connection configuration. */
export interface GatewayOptions {
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

/** Raw Discord embed object. */
export interface APIEmbed {
  title?: string;
  type?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: Record<string, unknown>;
  image?: Record<string, unknown>;
  thumbnail?: Record<string, unknown>;
  video?: Record<string, unknown>;
  provider?: Record<string, unknown>;
  author?: Record<string, unknown>;
  fields?: Array<Record<string, unknown>>;
}
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
/** Raw Discord message component object. */
export interface APIMessageComponent {
  type: number;
  id?: number;
  custom_id?: string;
  style?: number;
  label?: string;
  disabled?: boolean;
  emoji?: Record<string, unknown>;
  url?: string;
  options?: Array<Record<string, unknown>>;
  components?: APIMessageComponent[];
}
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
  emoji: Record<string, unknown>;
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
  position?: number;
  role_subscription_data?: Record<string, unknown>;
  purchase_notification?: Record<string, unknown>;
  poll?: Record<string, unknown>;
  guild_id?: Snowflake;
}
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
  thread_metadata?: Record<string, unknown>;
  default_auto_archive_duration?: number;
  flags?: number;
  total_message_sent?: number;
  available_tags?: Array<Record<string, unknown>>;
  default_reaction_emoji?: Record<string, unknown> | null;
  default_thread_rate_limit_per_user?: number;
  default_sort_order?: number | null;
  default_forum_layout?: number;
}
/** Raw Discord guild object. */
export interface APIGuild {
  id: Snowflake;
  name: string;
  icon?: string | null;
  icon_hash?: string | null;
  splash?: string | null;
  discovery_splash?: string | null;
  owner_id?: Snowflake;
  afk_channel_id?: Snowflake | null;
  afk_timeout?: number;
  widget_enabled?: boolean;
  widget_channel_id?: Snowflake | null;
  verification_level?: number;
  default_message_notifications?: number;
  explicit_content_filter?: number;
  roles?: Array<Record<string, unknown>>;
  emojis?: Array<Record<string, unknown>>;
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
  preferred_locale?: string;
  public_updates_channel_id?: Snowflake | null;
  max_video_channel_users?: number;
  approximate_member_count?: number;
  approximate_presence_count?: number;
  nsfw_level?: number;
  safety_alerts_channel_id?: Snowflake | null;
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
/** Raw Discord reaction event payload. */
export interface APIMessageReactionEvent {
  user_id: Snowflake;
  channel_id: Snowflake;
  message_id: Snowflake;
  guild_id?: Snowflake;
  member?: APIGuildMember;
  emoji: Record<string, unknown>;
  message_author_id?: Snowflake;
  burst?: boolean;
  type?: number;
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
  member?: Record<string, unknown>;
}
/** Raw Discord READY event payload. */
export interface APIReadyEvent {
  v: number;
  user: UserData;
  guilds: Array<{ id: Snowflake; unavailable?: boolean }>;
  session_id: string;
  resume_gateway_url: string;
  shard?: [number, number];
  application?: Record<string, unknown>;
}
