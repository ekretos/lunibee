/** Common Discord snowflake-backed structure. */
export class BaseStructure {
    /** Discord resource ID. */
    public readonly id: string;

    /** Creates a structure from an ID. */
    public constructor(id: string) {
        if (!id) throw new TypeError("A Discord structure requires a non-empty ID.");
        this.id = id;
    }
}

/** Represents a Discord user. */
export class User extends BaseStructure {
    /** User name. */
    public username: string;
    /** Global display name. */
    public globalName: string | null;
    /** Avatar hash. */
    public avatar: string | null;
    /** Whether the user is a bot. */
    public bot: boolean;

    /** Creates a user from Discord data. */
    public constructor(data: { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean }) {
        super(data.id);
        this.username = data.username;
        this.globalName = data.global_name ?? null;
        this.avatar = data.avatar ?? null;
        this.bot = data.bot ?? false;
    }

    /** Returns the user's effective display name. */
    public get displayName(): string {
        return this.globalName ?? this.username;
    }

    /** Returns a Discord CDN URL for the user's avatar, when available. */
    public avatarURL(options: { extension?: "png" | "jpg" | "webp" | "gif"; size?: number } = {}): string | null {
        if (!this.avatar) return null;
        const extension = options.extension ?? (this.avatar.startsWith("a_") ? "gif" : "png");
        const size = options.size;
        const query = size ? `?size=${size}` : "";
        return `https://cdn.discordapp.com/avatars/${this.id}/${this.avatar}.${extension}${query}`;
    }
}

/** Represents a Discord guild. */
export class Guild extends BaseStructure {
    /** Guild name. */
    public name: string;
    /** Preferred guild locale. */
    public preferredLocale?: string;
    /** Creates a guild from Discord data. */
    public constructor(data: { id: string; name: string; preferred_locale?: string }) {
        super(data.id);
        this.name = data.name;
        this.preferredLocale = data.preferred_locale;
    }
}

/** Represents a Discord channel. */
export class Channel extends BaseStructure {
    /** Discord channel type. */
    public type: number;
    /** Channel name. */
    public name?: string;
    /** Creates a channel from Discord data. */
    public constructor(data: { id: string; type: number; name?: string }) {
        super(data.id);
        this.type = data.type;
        this.name = data.name;
    }
}

/** Represents a Discord message. */
export class Message extends BaseStructure {
    /** Message content. */
    public content: string;
    /** Message author. */
    public author: User;
    /** Channel containing the message. */
    public channelId: string;
    /** Guild containing the message, when applicable. */
    public guildId?: string;

    /** Creates a message from Discord data. */
    public constructor(data: {
        id: string;
        content?: string;
        author: User | { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean };
        channel_id: string;
        guild_id?: string;
    }) {
        super(data.id);
        this.content = data.content ?? "";
        this.author = data.author instanceof User ? data.author : new User(data.author);
        this.channelId = data.channel_id;
        this.guildId = data.guild_id;
    }
}

export { GuildMember, Role, TextChannel } from "./resources.js";
export * from "./interactions.js";
