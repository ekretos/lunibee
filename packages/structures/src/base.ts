/** Common Discord snowflake-backed structure. */
export class BaseStructure {
  public readonly id: string;
  public constructor(id: string) {
    if (!/^\d{1,20}$/.test(id)) throw new TypeError("A Discord structure requires a valid snowflake ID.");
    this.id = id;
  }
  public toString(): string { return this.id; }
}

export interface ResourceContext {
  sendMessage(channelId: string, options: Record<string, unknown> & { content?: string }): Promise<import("./index.js").Message>;
  editMessage(channelId: string, messageId: string, options: Record<string, unknown> & { content?: string }): Promise<import("./index.js").Message>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  crosspostMessage(channelId: string, messageId: string): Promise<import("./index.js").Message>;
  editChannel?(channelId: string, options: Record<string, unknown>): Promise<import("./base.js").Channel>;
  deleteChannel?(channelId: string): Promise<void>;
  addReaction?(channelId: string, messageId: string, emoji: string): Promise<void>;
  removeOwnReaction?(channelId: string, messageId: string, emoji: string): Promise<void>;
  removeReaction?(channelId: string, messageId: string, emoji: string, userId: string): Promise<void>;
  removeAllReactions?(channelId: string, messageId: string): Promise<void>;
  pinMessage?(channelId: string, messageId: string): Promise<void>;
  unpinMessage?(channelId: string, messageId: string): Promise<void>;
}

export class User extends BaseStructure {
  public username: string;
  public globalName: string | null;
  public avatar: string | null;
  public bot: boolean;
  public system: boolean;
  public flags: number;
  public constructor(data: import("@lunibee/types").UserData) {
    super(data.id);
    if (!data.username) throw new TypeError("A Discord user requires a username.");
    this.username = data.username;
    this.globalName = data.global_name ?? null;
    this.avatar = data.avatar ?? null;
    this.bot = data.bot ?? false;
    this.system = data.system ?? false;
    this.flags = data.public_flags ?? 0;
  }
  public get displayName(): string { return this.globalName ?? this.username; }
  public avatarURL(options: { extension?: "png" | "jpg" | "webp" | "gif"; size?: number } = {}): string | null {
    if (!this.avatar) return null;
    const extension = options.extension ?? (this.avatar.startsWith("a_") ? "gif" : "png");
    return `https://cdn.discordapp.com/avatars/${this.id}/${this.avatar}.${extension}${options.size ? `?size=${options.size}` : ""}`;
  }
  public defaultAvatarURL(): string { return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(this.id) % 5n)}.png`; }
  public displayAvatarURL(options: { extension?: "png" | "jpg" | "webp" | "gif"; size?: number } = {}): string { return this.avatarURL(options) ?? this.defaultAvatarURL(); }
}

export class Channel extends BaseStructure {
  public type: number;
  public name?: string | null;
  public guildId?: string;
  public topic?: string | null;
  public parentId?: string | null;
  readonly #context?: ResourceContext;

  /** Creates a channel structure from Discord channel data. */
  public constructor(data: import("@lunibee/types").APIChannel, context?: ResourceContext) {
    super(data.id);
    if (!Number.isInteger(data.type) || data.type < 0) throw new RangeError("A Discord channel requires a valid channel type.");
    this.type = data.type;
    this.name = data.name;
    this.guildId = data.guild_id;
    this.topic = data.topic;
    this.parentId = data.parent_id;
    this.#context = context;
  }

  /** Sends a message to this channel. @param options Message payload. @returns The created message. @throws {Error} If the channel is not attached to a client. */
  public sendMessage(options: Record<string, unknown> & { content?: string }): Promise<import("./index.js").Message> {
    if (!this.#context) throw new Error("This channel is not attached to a client.");
    return this.#context.sendMessage(this.id, options);
  }

  /** Sends a message using Lunibee's concise channel API. @param options Message payload. @returns The created message. @throws {Error} If the channel is not attached to a client. */
  public send(options: Record<string, unknown> & { content?: string }): Promise<import("./index.js").Message> {
    return this.sendMessage(options);
  }

  /** Edits this channel. @param options Channel fields to change. @returns The updated channel. @throws {Error} If the channel is not attached to a client. */
  public edit(options: Record<string, unknown>): Promise<Channel> {
    if (!this.#context?.editChannel) throw new Error("This channel is not attached to a client.");
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
    if (!this.#context?.deleteChannel) throw new Error("This channel is not attached to a client.");
    return this.#context.deleteChannel(this.id);
  }

  /** Updates this channel using the same resource operation as edit. @param options Channel fields to change. @returns The updated channel. @throws {Error} If the channel is not attached to a client. */
  public update(options: Record<string, unknown>): Promise<Channel> {
    return this.edit(options);
  }
}

export class Guild extends BaseStructure {
  public name: string;
  public preferredLocale?: string;
  public ownerId?: string;
  public constructor(data: { id: string; name: string; preferred_locale?: string; owner_id?: string }) {
    super(data.id);
    if (!data.name) throw new TypeError("A Discord guild requires a name.");
    this.name = data.name;
    this.preferredLocale = data.preferred_locale;
    this.ownerId = data.owner_id;
  }
}
