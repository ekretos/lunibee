/** A Discord guild member. */
export class GuildMember {
    /** User represented by the member. */
    public readonly user: User;
    /** Guild containing the member. */
    public readonly guildId: string;
    /** Nickname, if configured. */
    public nickname: string | null;
    /** Role IDs assigned to the member. */
    public readonly roleIds: string[];

    /** Creates a guild member from Discord data. */
    public constructor(data: { user: { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean }; guild_id: string; nick?: string | null; roles?: string[] }) {
        this.user = new User(data.user);
        this.guildId = data.guild_id;
        this.nickname = data.nick ?? null;
        this.roleIds = data.roles ?? [];
    }
}

/** A Discord guild role. */
export class Role extends BaseStructure {
    /** Role name. */
    public name: string;
    /** Role color. */
    public color: number;
    /** Whether the role is hoisted. */
    public hoist: boolean;
    /** Permission bitfield. */
    public permissions: string;
    /** Whether the role is managed by an integration. */
    public managed: boolean;

    /** Creates a role from Discord data. */
    public constructor(data: { id: string; name: string; color?: number; hoist?: boolean; permissions?: string; managed?: boolean }) {
        super(data.id);
        this.name = data.name;
        this.color = data.color ?? 0;
        this.hoist = data.hoist ?? false;
        this.permissions = data.permissions ?? "0";
        this.managed = data.managed ?? false;
    }
}

/** A Discord text-capable channel. */
export class TextChannel extends Channel {
    /** Channel name. */
    public name?: string;
    /** Parent category ID. */
    public parentId?: string | null;

    /** Creates a text channel from Discord data. */
    public constructor(data: { id: string; type: number; name?: string; parent_id?: string | null }) {
        super(data);
        this.name = data.name;
        this.parentId = data.parent_id;
    }
}
