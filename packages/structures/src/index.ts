/** Provides structure-level actions without coupling resource models to HTTP. */
export interface ResourceContext {
    /** Sends a message through the owning channel manager. @param channelId Channel identifier. @param options Message payload. @returns The created message. @throws {Error} When the manager rejects the operation. */
    sendMessage(channelId: string, options: { content?: string }): Promise<Message>;
    /** Edits a message through the owning channel manager. @param channelId Channel identifier. @param messageId Message identifier. @param options Edit payload. @returns The updated message. @throws {Error} When the manager rejects the operation. */
    editMessage(channelId: string, messageId: string, options: { content?: string }): Promise<Message>;
    /** Deletes a message through the owning channel manager. @param channelId Channel identifier. @param messageId Message identifier. @returns A promise fulfilled after deletion. @throws {Error} When the manager rejects the operation. */
    deleteMessage(channelId: string, messageId: string): Promise<void>;
    /** Crossposts a message through the owning channel manager. @param channelId Channel identifier. @param messageId Message identifier. @returns The crossposted message. @throws {Error} When the manager rejects the operation. */
    crosspostMessage(channelId: string, messageId: string): Promise<Message>;
}

/** Common Discord snowflake-backed structure. */
export class BaseStructure {
    /** Discord resource ID. */ public readonly id: string;
    /** Creates a structure from an ID. @param id Discord snowflake identifier. @throws {TypeError} If the ID is invalid. */
    public constructor(id: string) { if (!/^\d{1,20}$/.test(id)) throw new TypeError("A Discord structure requires a valid snowflake ID."); this.id = id; }
    /** Returns the resource ID. @returns Discord snowflake identifier. */ public toString(): string { return this.id; }
}

/** Represents a Discord user. */
export class User extends BaseStructure {
    /** User name. */ public username: string;
    /** Global display name. */ public globalName: string | null;
    /** Avatar hash. */ public avatar: string | null;
    /** Whether the user is a bot. */ public bot: boolean;
    /** Whether the account is a Discord system user. */ public system: boolean;
    /** Public user flags. */ public flags: number;
    /** Creates a user from Discord API data. @param data User payload. @throws {TypeError} If required data is invalid. */
    public constructor(data: import("@lunibee/types").UserData) { super(data.id); if (!data.username) throw new TypeError("A Discord user requires a username."); this.username = data.username; this.globalName = data.global_name ?? null; this.avatar = data.avatar ?? null; this.bot = data.bot ?? false; this.system = data.system ?? false; this.flags = data.public_flags ?? 0; }
    /** Gets the effective display name. @returns Global display name or username. */ public get displayName(): string { return this.globalName ?? this.username; }
    /** Creates an avatar CDN URL. @param options URL format options. @returns Avatar URL, or null when no custom avatar exists. */ public avatarURL(options: { extension?: "png" | "jpg" | "webp" | "gif"; size?: number } = {}): string | null { if (!this.avatar) return null; const extension = options.extension ?? (this.avatar.startsWith("a_") ? "gif" : "png"); return `https://cdn.discordapp.com/avatars/${this.id}/${this.avatar}.${extension}${options.size ? `?size=${options.size}` : ""}`; }
    /** Creates the default avatar URL. @returns Discord default avatar URL. */ public defaultAvatarURL(): string { return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(this.id) % 5n)}.png`; }
    /** Creates an avatar URL with default fallback. @param options URL format options. @returns Avatar or default avatar URL. */ public displayAvatarURL(options: { extension?: "png" | "jpg" | "webp" | "gif"; size?: number } = {}): string { return this.avatarURL(options) ?? this.defaultAvatarURL(); }
}

/** Represents a Discord guild. */
export class Guild extends BaseStructure {
    /** Guild name. */ public name: string;
    /** Preferred guild locale. */ public preferredLocale?: string;
    /** Guild owner ID. */ public ownerId?: string;
    /** Creates a guild from Discord API data. @param data Guild payload. @throws {TypeError} If required data is invalid. */
    public constructor(data: { id: string; name: string; preferred_locale?: string; owner_id?: string }) { super(data.id); if (!data.name) throw new TypeError("A Discord guild requires a name."); this.name = data.name; this.preferredLocale = data.preferred_locale; this.ownerId = data.owner_id; }
}

/** Represents a Discord channel. */
export class Channel extends BaseStructure {
    /** Discord channel type. */ public type: number;
    /** Channel name. */ public name?: string | null;
    /** Guild containing the channel. */ public guildId?: string;
    readonly #context?: ResourceContext;
    /** Creates a channel from Discord API data. @param data Channel payload. @param context Optional owning resource context. @throws {TypeError|RangeError} If required channel data is invalid. */
    public constructor(data: import("@lunibee/types").APIChannel, context?: ResourceContext) { super(data.id); if (!Number.isInteger(data.type) || data.type < 0) throw new RangeError("A Discord channel requires a valid channel type."); this.type = data.type; this.name = data.name; this.guildId = data.guild_id; this.#context = context; }
    /** Sends a message through the owning manager. @param options Message payload. @returns The created message. @throws {Error} If this channel is detached from a client. */
    public sendMessage(options: { content?: string }): Promise<Message> { if (!this.#context) throw new Error("This channel is not attached to a client."); return this.#context.sendMessage(this.id, options); }
}

/** Represents a Discord message. */
export class Message extends BaseStructure {
    /** Message content. */ public content: string;
    /** Message author. */ public author: User;
    /** Channel ID containing the message. */ public channelId: string;
    /** Channel containing the message. */ public readonly channel: Channel;
    /** Guild ID containing the message. */ public guildId?: string;
    /** Message flags. */ public flags: number;
    /** Message creation time. */ public readonly createdAt: Date;
    /** Message attachments. */ public readonly attachments: import("@lunibee/types").APIAttachment[];
    /** Message embeds. */ public readonly embeds: import("@lunibee/types").APIEmbed[];
    /** Mentioned users. */ public readonly mentions: User[];
    /** Mentioned role IDs. */ public readonly mentionRoles: string[];
    /** Whether the message is pinned. */ public pinned: boolean;
    /** Whether the message mentions everyone. */ public mentionEveryone: boolean;
    /** Discord message type. */ public type: number;
    readonly #context?: ResourceContext;
    /** Creates a message from Discord API data. @param data Message payload. @param context Optional owning resource context. @throws {TypeError} If required message identifiers are invalid. */
    public constructor(data: import("@lunibee/types").APIMessage, context?: ResourceContext) { super(data.id); if (!/^\d{1,20}$/.test(data.channel_id)) throw new TypeError("Message channel_id must be a valid snowflake."); this.content = data.content ?? ""; this.author = new User(data.author); this.channelId = data.channel_id; this.guildId = data.guild_id; this.flags = data.flags ?? 0; this.createdAt = new Date(data.timestamp ?? Number((BigInt(this.id) >> 22n) + 1420070400000n)); this.attachments = data.attachments ?? []; this.embeds = data.embeds ?? []; this.mentions = (data.mentions ?? []).map(user => new User(user)); this.mentionRoles = data.mention_roles ?? []; this.pinned = data.pinned ?? false; this.mentionEveryone = data.mention_everyone ?? false; this.type = data.type ?? 0; this.#context = context; this.channel = new Channel({ id: data.channel_id, type: 0, guild_id: data.guild_id }, context); }
    /** Whether embeds are suppressed. @returns True when the suppress-embeds flag is set. */ public get embedsSuppressed(): boolean { return (this.flags & 4) !== 0; }
    /** Edits this message. @param options Edit payload. @returns Updated message. @throws {Error} If detached from a client. */ public edit(options: { content?: string }): Promise<Message> { if (!this.#context) throw new Error("This message is not attached to a client."); return this.#context.editMessage(this.channelId, this.id, options); }
    /** Deletes this message. @returns Nothing. @throws {Error} If detached from a client. */ public delete(): Promise<void> { if (!this.#context) throw new Error("This message is not attached to a client."); return this.#context.deleteMessage(this.channelId, this.id); }
    /** Crossposts this message. @returns Crossposted message. @throws {Error} If detached from a client. */ public crosspost(): Promise<Message> { if (!this.#context) throw new Error("This message is not attached to a client."); return this.#context.crosspostMessage(this.channelId, this.id); }
    /** Replies in this message's channel. @param options Message content or payload. @returns Created reply. @throws {Error} If detached from a client. */ public reply(options: string | { content?: string }): Promise<Message> { if (!this.#context) throw new Error("This message is not attached to a client."); return this.#context.sendMessage(this.channelId, typeof options === "string" ? { content: options } : options); }
}

export { GuildMember, Role, TextChannel } from "./resources.js";
export * from "./interactions.js";
