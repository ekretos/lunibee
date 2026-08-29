/** Provides structure-level actions without coupling resource models to HTTP. */
export interface ResourceContext {
    /** Sends a message through the owning channel manager. @param channelId Channel identifier. @param options Message payload. @returns The created message. */
    sendMessage(channelId: string, options: { content?: string }): Promise<Message>;
    /** Edits a message through the owning channel manager. @param channelId Channel identifier. @param messageId Message identifier. @param options Edit payload. @returns The updated message. */
    editMessage(channelId: string, messageId: string, options: { content?: string }): Promise<Message>;
    /** Deletes a message through the owning channel manager. @param channelId Channel identifier. @param messageId Message identifier. @returns A promise fulfilled after deletion. */
    deleteMessage(channelId: string, messageId: string): Promise<void>;
    /** Crossposts a message through the owning channel manager. @param channelId Channel identifier. @param messageId Message identifier. @returns The crossposted message. */
    crosspostMessage(channelId: string, messageId: string): Promise<Message>;
}

/** Common Discord snowflake-backed structure. */
export class BaseStructure {
    /** Discord resource ID. */ public readonly id: string;
    /** Creates a structure from an ID. @param id Discord snowflake identifier. @throws {TypeError} If the ID is not a valid snowflake. */
    public constructor(id: string) { if (!/^\d{1,20}$/.test(id)) throw new TypeError("A Discord structure requires a valid snowflake ID."); this.id = id; }
    /** Returns the resource ID. @returns Discord snowflake identifier. */
    public toString(): string { return this.id; }
}

/** Represents a Discord user. */
export class User extends BaseStructure {
    /** User name. */ public username: string;
    /** Global display name. */ public globalName: string | null;
    /** Avatar hash. */ public avatar: string | null;
    /** Whether the user is a bot. */ public bot: boolean;
    /** Whether the account is a Discord system user. */ public system: boolean;
    /** Public user flags. */ public flags: number;
    /** Creates a user from Discord data. @param data Discord user payload. @throws {TypeError} If required user data is invalid. */
    public constructor(data: { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean; system?: boolean; public_flags?: number }) { super(data.id); if (!data.username) throw new TypeError("A Discord user requires a username."); this.username = data.username; this.globalName = data.global_name ?? null; this.avatar = data.avatar ?? null; this.bot = data.bot ?? false; this.system = data.system ?? false; this.flags = data.public_flags ?? 0; }
    /** Gets the effective display name. @returns Global display name or username. */ public get displayName(): string { return this.globalName ?? this.username; }
    /** Creates a CDN avatar URL. @param options URL format options. @returns Avatar URL, or null when no custom avatar exists. */ public avatarURL(options: { extension?: "png" | "jpg" | "webp" | "gif"; size?: number } = {}): string | null { if (!this.avatar) return null; const extension = options.extension ?? (this.avatar.startsWith("a_") ? "gif" : "png"); const size = options.size; return `https://cdn.discordapp.com/avatars/${this.id}/${this.avatar}.${extension}${size ? `?size=${size}` : ""}`; }
    /** Creates the default avatar URL. @returns Discord default avatar URL. */ public defaultAvatarURL(): string { return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(this.id) % 5n)}.png`; }
    /** Creates an avatar URL with default fallback. @param options URL format options. @returns Avatar or default avatar URL. */ public displayAvatarURL(options: { extension?: "png" | "jpg" | "webp" | "gif"; size?: number } = {}): string { return this.avatarURL(options) ?? this.defaultAvatarURL(); }
}

/** Represents a Discord guild. */
export class Guild extends BaseStructure {
    /** Guild name. */ public name: string;
    /** Preferred guild locale. */ public preferredLocale?: string;
    /** Guild owner ID. */ public ownerId?: string;
    /** Creates a guild from Discord data. @param data Discord guild payload. @throws {TypeError} If required guild data is invalid. */
    public constructor(data: { id: string; name: string; preferred_locale?: string; owner_id?: string }) { super(data.id); if (!data.name) throw new TypeError("A Discord guild requires a name."); this.name = data.name; this.preferredLocale = data.preferred_locale; this.ownerId = data.owner_id; }
}

/** Represents a Discord channel. */
export class Channel extends BaseStructure {
    /** Discord channel type. */ public type: number;
    /** Channel name. */ public name?: string;
    /** Guild containing the channel. */ public guildId?: string;
    readonly #context?: ResourceContext;
    /** Creates a channel from Discord data. @param data Discord channel payload. @param context Optional owning resource context. @throws {TypeError|RangeError} If the channel ID or type is invalid. */
    public constructor(data: { id: string; type: number; name?: string; guild_id?: string }, context?: ResourceContext) { super(data.id); if (!Number.isInteger(data.type) || data.type < 0) throw new RangeError("A Discord channel requires a valid channel type."); this.type = data.type; this.name = data.name; this.guildId = data.guild_id; this.#context = context; }
    /** Sends a message through the owning manager. @param options Message payload. @returns The created message. @throws {Error} If this channel is detached from a client. */
    public sendMessage(options: { content?: string }): Promise<Message> { if (!this.#context) throw new Error("This channel is not attached to a client."); return this.#context.sendMessage(this.id, options); }
}

/** Represents a Discord message. */
export class Message extends BaseStructure {
    /** Message content. */ public content: string;
    /** Message author. */ public author: User;
    /** Channel containing the message. */ public channelId: string;
    /** Channel containing the message. */ public readonly channel: Channel;
    /** Guild containing the message. */ public guildId?: string;
    /** Message flags. */ public flags: number;
    /** Message creation time derived from its snowflake. */ public readonly createdAt: Date;
    readonly #context?: ResourceContext;
    /** Creates a message from Discord data. @param data Discord message payload. @param context Optional owning resource context. @throws {TypeError} If required message identifiers are invalid. */
    public constructor(data: { id: string; content?: string; author: User | { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean; system?: boolean; public_flags?: number }; channel_id: string; guild_id?: string; flags?: number }, context?: ResourceContext) { super(data.id); this.content = data.content ?? ""; this.author = data.author instanceof User ? data.author : new User(data.author); if (!/^\d{1,20}$/.test(data.channel_id)) throw new TypeError("Message channel_id must be a valid snowflake."); this.channelId = data.channel_id; this.guildId = data.guild_id; this.flags = data.flags ?? 0; this.createdAt = new Date(Number((BigInt(this.id) >> 22n) + 1420070400000n)); this.#context = context; this.channel = new Channel({ id: data.channel_id, type: 0, guild_id: data.guild_id }, context); }
    /** Whether the message has embeds suppressed. @returns True when the suppress-embeds flag is set. */ public get embedsSuppressed(): boolean { return (this.flags & 4) !== 0; }
    /** Edits this message through its owning manager. @param options Edit payload. @returns The updated message. @throws {Error} If this message is detached from a client. */
    public edit(options: { content?: string }): Promise<Message> { if (!this.#context) throw new Error("This message is not attached to a client."); return this.#context.editMessage(this.channelId, this.id, options); }
    /** Deletes this message through its owning manager. @returns A promise fulfilled after deletion. @throws {Error} If this message is detached from a client. */
    public delete(): Promise<void> { if (!this.#context) throw new Error("This message is not attached to a client."); return this.#context.deleteMessage(this.channelId, this.id); }
    /** Crossposts this message through its owning manager. @returns The crossposted message. @throws {Error} If this message is detached from a client. */
    public crosspost(): Promise<Message> { if (!this.#context) throw new Error("This message is not attached to a client."); return this.#context.crosspostMessage(this.channelId, this.id); }
    /** Replies to this message through its owning manager. @param options Reply content or payload. @returns The created reply. @throws {Error} If this message is detached from a client. */
    public reply(options: string | { content?: string }): Promise<Message> { if (!this.#context) throw new Error("This message is not attached to a client."); return this.#context.sendMessage(this.channelId, typeof options === "string" ? { content: options } : options); }
}

export { GuildMember, Role, TextChannel } from "./resources.js";
export * from "./interactions.js";
