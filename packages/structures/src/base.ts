/** Common Discord snowflake-backed structure. */
export class BaseStructure {
  public readonly id: string;
  public constructor(id: string) {
    if (!/^\d{1,20}$/.test(id))
      throw new TypeError("A Discord structure requires a valid snowflake ID.");
    this.id = id;
  }
  /** Returns the snowflake ID as a string. */
  public toString(): string {
    return this.id;
  }
  /** Returns the timestamp this snowflake was created at. */
  public get createdAt(): Date {
    return new Date(Number((BigInt(this.id) >> 22n) + 1420070400000n));
  }
}

export interface ResourceContext {
  sendMessage(
    channelId: string,
    options: Record<string, unknown> & { content?: string },
  ): Promise<import("./index.js").Message>;
  editMessage(
    channelId: string,
    messageId: string,
    options: Record<string, unknown> & { content?: string },
  ): Promise<import("./index.js").Message>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  crosspostMessage(
    channelId: string,
    messageId: string,
  ): Promise<import("./index.js").Message>;
  editChannel?(
    channelId: string,
    options: Record<string, unknown>,
  ): Promise<import("./base.js").Channel>;
  deleteChannel?(channelId: string): Promise<void>;
  addReaction?(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void>;
  removeOwnReaction?(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void>;
  removeReaction?(
    channelId: string,
    messageId: string,
    emoji: string,
    userId: string,
  ): Promise<void>;
  removeAllReactions?(channelId: string, messageId: string): Promise<void>;
  pinMessage?(channelId: string, messageId: string): Promise<void>;
  unpinMessage?(channelId: string, messageId: string): Promise<void>;
}

// ─── CDN helpers ──────────────────────────────────────────────────────────────

const CDN_BASE = "https://cdn.discordapp.com";

/** Options for CDN image URLs. */
export interface ImageURLOptions {
  extension?: "png" | "jpg" | "webp" | "gif" | "jpeg";
  size?: 16 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | 4096;
  forceStatic?: boolean;
}

function cdnURL(
  path: string,
  hash: string,
  options: ImageURLOptions = {},
): string {
  const isAnimated = hash.startsWith("a_") && !options.forceStatic;
  const ext = options.extension ?? (isAnimated ? "gif" : "png");
  const size = options.size ? `?size=${options.size}` : "";
  return `${CDN_BASE}${path}/${hash}.${ext}${size}`;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export class User extends BaseStructure {
  public username: string;
  public globalName: string | null;
  public avatar: string | null;
  public bot: boolean;
  public system: boolean;
  public flags: number;
  public constructor(data: import("@lunibee/types").UserData) {
    super(data.id);
    if (!data.username)
      throw new TypeError("A Discord user requires a username.");
    this.username = data.username;
    this.globalName = data.global_name ?? null;
    this.avatar = data.avatar ?? null;
    this.bot = data.bot ?? false;
    this.system = data.system ?? false;
    this.flags = data.public_flags ?? 0;
  }
  /** Effective display name — global name, falling back to username. */
  public get displayName(): string {
    return this.globalName ?? this.username;
  }
  /** Returns the user's avatar URL, or null if they have no avatar. */
  public avatarURL(options: ImageURLOptions = {}): string | null {
    if (!this.avatar) return null;
    return cdnURL(`/avatars/${this.id}`, this.avatar, options);
  }
  /** Returns the default avatar URL based on the user's discriminator/snowflake. */
  public defaultAvatarURL(): string {
    return `${CDN_BASE}/embed/avatars/${Number(BigInt(this.id) % 5n)}.png`;
  }
  /** Returns the avatar URL if available, falling back to the default avatar URL. */
  public displayAvatarURL(options: ImageURLOptions = {}): string {
    return this.avatarURL(options) ?? this.defaultAvatarURL();
  }
  /** Returns the Discord mention string. Used automatically in template literals. */
  public override toString(): string {
    return `<@${this.id}>`;
  }
}

// ─── Channel ──────────────────────────────────────────────────────────────────

export class Channel extends BaseStructure {
  public type: number;
  public name?: string | null;
  public guildId?: string;
  public topic?: string | null;
  public parentId?: string | null;
  public nsfw?: boolean;
  public rateLimitPerUser?: number;
  public position?: number;
  readonly #context?: ResourceContext;

  /** Creates a channel structure from Discord channel data. */
  public constructor(
    data: import("@lunibee/types").APIChannel,
    context?: ResourceContext,
  ) {
    super(data.id);
    if (!Number.isInteger(data.type) || data.type < 0)
      throw new RangeError("A Discord channel requires a valid channel type.");
    this.type = data.type;
    this.name = data.name;
    this.guildId = data.guild_id;
    this.topic = data.topic;
    this.parentId = data.parent_id;
    this.nsfw = data.nsfw;
    this.rateLimitPerUser = data.rate_limit_per_user;
    this.position = data.position;
    this.#context = context;
  }

  /** Sends a message to this channel. @param options Message payload. @returns The created message. @throws {Error} If the channel is not attached to a client. */
  public sendMessage(
    options: Record<string, unknown> & { content?: string },
  ): Promise<import("./index.js").Message> {
    if (!this.#context)
      throw new Error("This channel is not attached to a client.");
    return this.#context.sendMessage(this.id, options);
  }

  /** Sends a message using Lunibee's concise channel API. @param options Message payload. @returns The created message. @throws {Error} If the channel is not attached to a client. */
  public send(
    options: Record<string, unknown> & { content?: string },
  ): Promise<import("./index.js").Message> {
    return this.sendMessage(options);
  }

  /** Edits this channel. @param options Channel fields to change. @returns The updated channel. @throws {Error} If the channel is not attached to a client. */
  public edit(options: Record<string, unknown>): Promise<Channel> {
    if (!this.#context?.editChannel)
      throw new Error("This channel is not attached to a client.");
    return this.#context.editChannel(this.id, options);
  }

  /** Changes only this channel's name. @param name New channel name. @returns The updated channel. @throws {TypeError} If the name is empty. @throws {Error} If the channel is not attached to a client. */
  public editName(name: string): Promise<Channel> {
    if (!name.trim()) throw new TypeError("Channel name cannot be empty.");
    return this.edit({ name });
  }

  /** Changes only this channel's topic. @param topic New topic, or null to clear it. @returns The updated channel. @throws {Error} If the channel is not attached to a client. */
  public editTopic(topic: string | null): Promise<Channel> {
    return this.edit({ topic });
  }

  /** Moves this channel to another parent category. @param parentId Parent category ID, or null to remove the parent. @returns The updated channel. @throws {Error} If the channel is not attached to a client. */
  public editParent(parentId: string | null): Promise<Channel> {
    return this.edit({ parent_id: parentId });
  }

  /** Deletes this channel. @returns A promise fulfilled when Discord confirms deletion. @throws {Error} If the channel is not attached to a client. */
  public delete(): Promise<void> {
    if (!this.#context?.deleteChannel)
      throw new Error("This channel is not attached to a client.");
    return this.#context.deleteChannel(this.id);
  }

  /** Updates this channel using the same resource operation as edit. @param options Channel fields to change. @returns The updated channel. @throws {Error} If the channel is not attached to a client. */
  public update(options: Record<string, unknown>): Promise<Channel> {
    return this.edit(options);
  }

  /** Returns the Discord channel mention string. Used automatically in template literals. */
  public override toString(): string {
    return `<#${this.id}>`;
  }
}

// ─── Guild ────────────────────────────────────────────────────────────────────

export class Guild extends BaseStructure {
  public name: string;
  public icon: string | null;
  public splash: string | null;
  public banner: string | null;
  public description: string | null;
  public preferredLocale: string;
  public ownerId?: string;
  public features: string[];
  public verificationLevel: number;
  public premiumTier: number;
  public premiumSubscriptionCount: number;
  public memberCount?: number;
  public approximateMemberCount?: number;
  public approximatePresenceCount?: number;
  public vanityUrlCode: string | null;
  public nsfwLevel: number;

  public constructor(data: import("@lunibee/types").APIGuild) {
    super(data.id);
    if (!data.name) throw new TypeError("A Discord guild requires a name.");
    this.name = data.name;
    this.icon = data.icon ?? null;
    this.splash = data.splash ?? null;
    this.banner = data.banner ?? null;
    this.description = data.description ?? null;
    this.preferredLocale = data.preferred_locale ?? "en-US";
    this.ownerId = data.owner_id;
    this.features = data.features ?? [];
    this.verificationLevel = data.verification_level ?? 0;
    this.premiumTier = data.premium_tier ?? 0;
    this.premiumSubscriptionCount = data.premium_subscription_count ?? 0;
    this.memberCount = data.member_count ?? data.approximate_member_count;
    this.approximateMemberCount = data.approximate_member_count;
    this.approximatePresenceCount = data.approximate_presence_count;
    this.vanityUrlCode = data.vanity_url_code ?? null;
    this.nsfwLevel = data.nsfw_level ?? 0;
  }

  /** Returns the guild icon URL, or null if no icon is set. */
  public iconURL(options: ImageURLOptions = {}): string | null {
    if (!this.icon) return null;
    return cdnURL(`/icons/${this.id}`, this.icon, options);
  }

  /** Returns the guild splash URL, or null if none. */
  public splashURL(options: ImageURLOptions = {}): string | null {
    if (!this.splash) return null;
    return cdnURL(`/splashes/${this.id}`, this.splash, options);
  }

  /** Returns the guild banner URL, or null if none. */
  public bannerURL(options: ImageURLOptions = {}): string | null {
    if (!this.banner) return null;
    return cdnURL(`/banners/${this.id}`, this.banner, options);
  }

  /** Returns the guild discovery splash URL, or null if none. */
  public discoverySplashURL(
    splash: string | null,
    options: ImageURLOptions = {},
  ): string | null {
    if (!splash) return null;
    return cdnURL(`/discovery-splashes/${this.id}`, splash, options);
  }

  /** Whether the guild has a given feature flag. @param feature Feature string, e.g. "COMMUNITY". */
  public hasFeature(feature: string): boolean {
    return this.features.includes(feature);
  }

  /** Whether the guild is a Community server. */
  public get isCommunity(): boolean {
    return this.hasFeature("COMMUNITY");
  }

  /** Whether the guild has a vanity URL. */
  public get hasVanityUrl(): boolean {
    return this.vanityUrlCode !== null;
  }

  /** Returns the guild's vanity invite URL, or null if none. */
  public get vanityURL(): string | null {
    return this.vanityUrlCode
      ? `https://discord.gg/${this.vanityUrlCode}`
      : null;
  }

  /** Returns a human-readable string representation. */
  public override toString(): string {
    return this.name;
  }
}
