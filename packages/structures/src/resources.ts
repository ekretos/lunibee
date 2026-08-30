import { BaseStructure, Channel, User } from "./base.js";
import { PermissionsBitField } from "./permissions.js";

/** A Discord guild member. */
export class GuildMember {
  /** User represented by the member. */ public readonly user: User;
  /** Guild containing the member. */ public readonly guildId: string;
  /** Nickname, if configured. */ public nickname: string | null;
  /** Role IDs assigned to the member. */ public readonly roleIds: string[];
  /** Whether the member is pending membership screening. */ public pending: boolean;
  /** Member join timestamp. */ public joinedAt?: Date;
  /** Raw effective permission bitfield supplied by Discord. */ public readonly permissions: PermissionsBitField;
  /** Creates a guild member from Discord data. @param data Discord guild-member payload. @throws {TypeError} If the guild ID is invalid. @throws {RangeError} If joined_at is invalid. */
  public constructor(data: {
    user: {
      id: string;
      username: string;
      global_name?: string | null;
      avatar?: string | null;
      bot?: boolean;
      system?: boolean;
      public_flags?: number;
    };
    guild_id: string;
    nick?: string | null;
    roles?: string[];
    pending?: boolean;
    joined_at?: string;
    permissions?: string;
  }) {
    this.user = new User(data.user);
    if (!/^\d{1,20}$/.test(data.guild_id))
      throw new TypeError("Member guild_id must be a valid snowflake.");
    this.guildId = data.guild_id;
    this.nickname = data.nick ?? null;
    this.roleIds = [...(data.roles ?? [])];
    this.pending = data.pending ?? false;
    this.joinedAt = data.joined_at ? new Date(data.joined_at) : undefined;
    if (this.joinedAt?.toString() === "Invalid Date")
      throw new RangeError("Member joined_at must be a valid date.");
    this.permissions = new PermissionsBitField(data.permissions ?? 0n);
  }
  /** Effective member display name. @returns Nickname or user display name. */ public get displayName(): string {
    return this.nickname ?? this.user.displayName;
  }
}

/** A Discord guild role. */
export class Role extends BaseStructure {
  /** Role name. */ public name: string;
  /** Role color. */ public color: number;
  /** Whether the role is hoisted. */ public hoist: boolean;
  /** Permission bitfield. */ public permissions: PermissionsBitField;
  /** Whether the role is managed. */ public managed: boolean;
  /** Whether the role is mentionable. */ public mentionable: boolean;
  /** Creates a role from Discord data. @param data Discord role payload. */
  public constructor(data: {
    id: string;
    name: string;
    color?: number;
    hoist?: boolean;
    permissions?: string;
    managed?: boolean;
    mentionable?: boolean;
  }) {
    super(data.id);
    if (!data.name) throw new TypeError("Role name cannot be empty.");
    this.name = data.name;
    this.color = data.color ?? 0;
    this.hoist = data.hoist ?? false;
    this.permissions = new PermissionsBitField(data.permissions ?? 0n);
    this.managed = data.managed ?? false;
    this.mentionable = data.mentionable ?? false;
  }
  /** Discord role mention string. @returns Role mention. */ public toString(): string {
    return `<@&${this.id}>`;
  }
}

/** A Discord text-capable channel. */
export class TextChannel extends Channel {
  /** Parent category ID. */ public parentId?: string | null;
  /** Creates a text channel from Discord data. @param data Discord channel payload. */
  public constructor(data: {
    id: string;
    type: number;
    name?: string;
    parent_id?: string | null;
    guild_id?: string;
  }) {
    super(data);
    this.parentId = data.parent_id;
  }
  /** Discord channel mention string. @returns Channel mention. */ public toString(): string {
    return `<#${this.id}>`;
  }
}
