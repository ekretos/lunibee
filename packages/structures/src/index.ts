/** Common Discord snowflake-backed structure. */
export class BaseStructure {
    /** Discord resource ID. */
    public readonly id: string;
    /** Creates a structure from an ID. */
    public constructor(id: string) { this.id = id; }
}

/** Represents a Discord user. */
export class User extends BaseStructure {
    /** User name. */ public username: string;
    /** Global display name. */ public globalName: string | null;
    /** Avatar hash. */ public avatar: string | null;
    /** Whether the user is a bot. */ public bot: boolean;
    /** Creates a user from Discord data. */
    public constructor(data: { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean }) {
        super(data.id); this.username = data.username; this.globalName = data.global_name ?? null; this.avatar = data.avatar ?? null; this.bot = data.bot ?? false;
    }
}

/** Represents a Discord guild. */
export class Guild extends BaseStructure {
    /** Guild name. */ public name: string;
    /** Creates a guild from Discord data. */
    public constructor(data: { id: string; name: string }) { super(data.id); this.name = data.name; }
}

/** Represents a Discord channel. */
export class Channel extends BaseStructure {
    /** Discord channel type. */ public type: number;
    /** Creates a channel from Discord data. */
    public constructor(data: { id: string; type: number }) { super(data.id); this.type = data.type; }
}

/** Represents a Discord message. */
export class Message extends BaseStructure {
    /** Message content. */ public content: string;
    /** Message author. */ public author: User;
    /** Channel containing the message. */ public channelId: string;
    /** Creates a message from Discord data. */
    public constructor(data: { id: string; content: string; author: User | { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean }; channel_id: string }) {
        super(data.id); this.content = data.content; this.author = data.author instanceof User ? data.author : new User(data.author); this.channelId = data.channel_id;
    }
}

export { GuildMember, Role, TextChannel } from "./resources.js";
