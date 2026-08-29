/** Common Discord snowflake-backed structure. */
export class BaseStructure {
    /** Discord resource ID. */ public readonly id: string;
    /** Creates a structure from an ID. */ public constructor(id: string) { if (!/^\d{1,20}$/.test(id)) throw new TypeError("A Discord structure requires a valid snowflake ID."); this.id = id; }
    /** Returns the resource ID. */ public toString(): string { return this.id; }
}

/** Represents a Discord user. */
export class User extends BaseStructure {
    /** User name. */ public username: string;
    /** Global display name. */ public globalName: string | null;
    /** Avatar hash. */ public avatar: string | null;
    /** Whether the user is a bot. */ public bot: boolean;
    /** Whether the account is a Discord system user. */ public system: boolean;
    /** Public user flags. */ public flags: number;
    /** Creates a user from Discord data. */
    public constructor(data: { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean; system?: boolean; public_flags?: number }) { super(data.id); if (!data.username) throw new TypeError("A Discord user requires a username."); this.username = data.username; this.globalName = data.global_name ?? null; this.avatar = data.avatar ?? null; this.bot = data.bot ?? false; this.system = data.system ?? false; this.flags = data.public_flags ?? 0; }
    /** Effective display name. */ public get displayName(): string { return this.globalName ?? this.username; }
    /** Creates a CDN URL for the avatar. */
    public avatarURL(options: { extension?: "png" | "jpg" | "webp" | "gif"; size?: number } = {}): string | null { if (!this.avatar) return null; const extension = options.extension ?? (this.avatar.startsWith("a_") ? "gif" : "png"); const size = options.size; return `https://cdn.discordapp.com/avatars/${this.id}/${this.avatar}.${extension}${size ? `?size=${size}` : ""}`; }
    /** Creates a CDN URL for the default avatar. */ public defaultAvatarURL(): string { return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(this.id) % 5n)}.png`; }
    /** Creates a CDN URL for this user's avatar or default avatar. */ public displayAvatarURL(options: { extension?: "png" | "jpg" | "webp" | "gif"; size?: number } = {}): string { return this.avatarURL(options) ?? this.defaultAvatarURL(); }
}

/** Represents a Discord guild. */
export class Guild extends BaseStructure {
    /** Guild name. */ public name: string;
    /** Preferred guild locale. */ public preferredLocale?: string;
    /** Guild owner ID. */ public ownerId?: string;
    /** Creates a guild from Discord data. */
    public constructor(data: { id: string; name: string; preferred_locale?: string; owner_id?: string }) { super(data.id); if (!data.name) throw new TypeError("A Discord guild requires a name."); this.name = data.name; this.preferredLocale = data.preferred_locale; this.ownerId = data.owner_id; }
}

/** Represents a Discord channel. */
export class Channel extends BaseStructure {
    /** Discord channel type. */ public type: number;
    /** Channel name. */ public name?: string;
    /** Guild containing the channel. */ public guildId?: string;
    /** Creates a channel from Discord data. */
    public constructor(data: { id: string; type: number; name?: string; guild_id?: string }) { super(data.id); if (!Number.isInteger(data.type) || data.type < 0) throw new RangeError("A Discord channel requires a valid channel type."); this.type = data.type; this.name = data.name; this.guildId = data.guild_id; }
}

/** Represents a Discord message. */
export class Message extends BaseStructure {
    /** Message content. */ public content: string;
    /** Message author. */ public author: User;
    /** Channel containing the message. */ public channelId: string;
    /** Guild containing the message. */ public guildId?: string;
    /** Message flags. */ public flags: number;
    /** Message creation time derived from its snowflake. */ public readonly createdAt: Date;
    /** Creates a message from Discord data. */
    public constructor(data: { id: string; content?: string; author: User | { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean; system?: boolean; public_flags?: number }; channel_id: string; guild_id?: string; flags?: number }) { super(data.id); this.content = data.content ?? ""; this.author = data.author instanceof User ? data.author : new User(data.author); if (!/^\d{1,20}$/.test(data.channel_id)) throw new TypeError("Message channel_id must be a valid snowflake."); this.channelId = data.channel_id; this.guildId = data.guild_id; this.flags = data.flags ?? 0; this.createdAt = new Date(Number((BigInt(this.id) >> 22n) + 1420070400000n)); }
    /** Whether the message has embeds suppressed. */ public get embedsSuppressed(): boolean { return (this.flags & 4) !== 0; }
}

export { GuildMember, Role, TextChannel } from "./resources.js";
export * from "./interactions.js";
