import { BaseStructure, Channel, User, CDN_BASE, cdnURL } from "./base.js";
import { PermissionsBitField } from "@lunibee/core";
import type { ImageURLOptions, ResourceContext } from "./base.js";

/** Parses a Discord ISO timestamp into a Date, returning null for absent or invalid values. */
function toDateOrNull(value?: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

// ─── GuildMember ───────────────────────────────────────────────────────────────

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
    /** Whether the member is pending membership screening. */
    public pending: boolean;
    /** Member join timestamp. */
    public joinedAt?: Date;
    /** Member-specific avatar hash, if set. */
    public avatarHash: string | null;
    /** When the member started boosting the guild. */
    public premiumSince: Date | null;
    /** When the member's timeout expires (null if not timed out). */
    public timedOutUntil: Date | null;
    /** Member flags bitfield. */
    public flags: number;
    /** Permissions Discord sent with the member (interactions only). */
    readonly #suppliedPermissions?: PermissionsBitField;
    readonly #context?: ResourceContext;

    /** Creates a guild member from Discord data. @param data Discord guild-member payload. @throws {TypeError} If the guild ID is invalid. @throws {RangeError} If joined_at is invalid. */
    public constructor(
        data: {
            user: {
                id: string;
                username: string;
                global_name?: string | null;
                avatar?: string | null;
                bot?: boolean;
                system?: boolean;
                public_flags?: number;
                discriminator?: string;
            };
            guild_id: string;
            nick?: string | null;
            roles?: string[];
            pending?: boolean;
            joined_at?: string;
            permissions?: string;
            avatar?: string | null;
            premium_since?: string | null;
            communication_disabled_until?: string | null;
            flags?: number;
        },
        context?: ResourceContext,
    ) {
        this.user = new User(data.user);
        this.#context = context;
        if (!/^\d{1,20}$/.test(data.guild_id))
            throw new TypeError("Member guild_id must be a valid snowflake.");
        this.guildId = data.guild_id;
        this.nickname = data.nick ?? null;
        this.roleIds = [...(data.roles ?? [])];
        this.pending = data.pending ?? false;
        this.joinedAt = data.joined_at ? new Date(data.joined_at) : undefined;
        if (this.joinedAt?.toString() === "Invalid Date")
            throw new RangeError("Member joined_at must be a valid date.");
        if (data.permissions !== undefined)
            this.#suppliedPermissions = new PermissionsBitField(
                data.permissions,
            );
        this.avatarHash = data.avatar ?? null;
        // Like joinedAt, coerce malformed timestamps to null instead of an Invalid Date.
        this.premiumSince = toDateOrNull(data.premium_since);
        this.timedOutUntil = toDateOrNull(data.communication_disabled_until);
        this.flags = data.flags ?? 0;
    }

    /**
     * The member's permissions. Discord sends them with interactions (already
     * resolved for the channel); anywhere else they are computed at guild
     * level from the cached roles each time they are read, so they follow role
     * changes. Empty when the guild's roles are not cached.
     */
    public get permissions(): PermissionsBitField {
        if (this.#suppliedPermissions) return this.#suppliedPermissions;
        return new PermissionsBitField(
            this.#context?.memberPermissions?.(
                this.guildId,
                this.user.id,
                this.roleIds,
                undefined,
                this.timedOutUntil,
            ) ?? 0n,
        );
    }

    /** The member's permissions in a channel, with its overwrites. Null when the channel or guild is not cached. @param channelId Channel ID. */
    public permissionsIn(channelId: string): PermissionsBitField | null {
        const computed = this.#context?.memberPermissions?.(
            this.guildId,
            this.user.id,
            this.roleIds,
            channelId,
            this.timedOutUntil,
        );
        return computed ? new PermissionsBitField(computed) : null;
    }

    #action<K extends keyof ResourceContext>(
        name: K,
    ): NonNullable<ResourceContext[K]> {
        const action = this.#context?.[name];
        if (!action)
            throw new Error("This member is not attached to a client.");
        return action as NonNullable<ResourceContext[K]>;
    }

    /** Kicks this member. @param reason Audit-log reason. */
    public kick(reason?: string): Promise<void> {
        return this.#action("kickMember")(this.guildId, this.user.id, reason);
    }

    /** Bans this member. @param options Audit-log reason and seconds of messages to delete. */
    public ban(
        options: { reason?: string; deleteMessageSeconds?: number } = {},
    ): Promise<void> {
        return this.#action("banMember")(this.guildId, this.user.id, options);
    }

    /** Edits this member (nickname, roles, voice state, timeout). @param options Discord member fields. @param reason Audit-log reason. */
    public edit(
        options: Record<string, unknown>,
        reason?: string,
    ): Promise<GuildMember> {
        return this.#action("editMember")(
            this.guildId,
            this.user.id,
            options,
            reason,
        );
    }

    /** Times this member out, or clears the timeout with null. @param milliseconds Timeout length (Discord allows up to 28 days). @param reason Audit-log reason. */
    public timeout(
        milliseconds: number | null,
        reason?: string,
    ): Promise<GuildMember> {
        if (milliseconds !== null && !(milliseconds > 0))
            throw new RangeError(
                "Timeout length must be a positive number of milliseconds.",
            );
        return this.edit(
            {
                communication_disabled_until:
                    milliseconds === null
                        ? null
                        : new Date(Date.now() + milliseconds).toISOString(),
            },
            reason,
        );
    }

    /** Sets or clears (null) this member's nickname. @param nickname New nickname. @param reason Audit-log reason. */
    public setNickname(
        nickname: string | null,
        reason?: string,
    ): Promise<GuildMember> {
        return this.edit({ nick: nickname }, reason);
    }

    /** Gives this member a role. @param roleId Role ID. @param reason Audit-log reason. */
    public addRole(roleId: string, reason?: string): Promise<void> {
        return this.#action("addMemberRole")(
            this.guildId,
            this.user.id,
            roleId,
            reason,
        );
    }

    /** Takes a role from this member. @param roleId Role ID. @param reason Audit-log reason. */
    public removeRole(roleId: string, reason?: string): Promise<void> {
        return this.#action("removeMemberRole")(
            this.guildId,
            this.user.id,
            roleId,
            reason,
        );
    }

    /** Effective member display name — nickname, falling back to user display name. */
    public get displayName(): string {
        return this.nickname ?? this.user.displayName;
    }

    /** Whether this member is currently timed out. */
    public get isTimedOut(): boolean {
        return this.timedOutUntil !== null && this.timedOutUntil > new Date();
    }

    /** Returns the member-specific avatar URL, falling back to the user's avatar, or null if none. */
    public avatarURL(options: ImageURLOptions = {}): string | null {
        if (this.avatarHash)
            return cdnURL(
                `/guilds/${this.guildId}/users/${this.user.id}/avatars`,
                this.avatarHash,
                options,
            );
        // User always exposes avatarURL(); returns null when the user has no avatar.
        return this.user.avatarURL(options);
    }

    /** Returns the resolved avatar URL — member avatar, user avatar, or default. */
    public displayAvatarURL(options: ImageURLOptions = {}): string {
        return this.avatarURL(options) ?? this.user.displayAvatarURL(options);
    }

    /** Returns the Discord user mention for this member. */
    public toString(): string {
        return this.user.toString();
    }
}

// ─── Role ──────────────────────────────────────────────────────────────────────

/** A Discord guild role. */
export class Role extends BaseStructure {
    /** Role name. */
    public name: string;
    /** Role color as a 24-bit RGB integer. */
    public color: number;
    /** Whether the role is hoisted. */
    public hoist: boolean;
    /** Permission bitfield. */
    public permissions: PermissionsBitField;
    /** Whether the role is managed by an integration. */
    public managed: boolean;
    /** Whether the role is mentionable. */
    public mentionable: boolean;
    /** Role position in the hierarchy. */
    public position: number;
    /** Unicode emoji used as the role icon, if any. */
    public unicodeEmoji: string | null;
    /** Hash of the role's custom icon image, if any. */
    public iconHash: string | null;
    /** Role tags metadata (bot, premium subscriber, etc). */
    public tags: Record<string, unknown> | null;

    /** Creates a role from Discord data. @param data Discord role payload. */
    public constructor(data: {
        id: string;
        name: string;
        color?: number;
        hoist?: boolean;
        permissions?: string;
        managed?: boolean;
        mentionable?: boolean;
        position?: number;
        unicode_emoji?: string | null;
        icon?: string | null;
        tags?: Record<string, unknown> | null;
    }) {
        super(data.id);
        if (!data.name) throw new TypeError("Role name cannot be empty.");
        this.name = data.name;
        this.color = data.color ?? 0;
        this.hoist = data.hoist ?? false;
        this.permissions = new PermissionsBitField(data.permissions ?? 0n);
        this.managed = data.managed ?? false;
        this.mentionable = data.mentionable ?? false;
        this.position = data.position ?? 0;
        this.unicodeEmoji = data.unicode_emoji ?? null;
        this.iconHash = data.icon ?? null;
        this.tags = data.tags ?? null;
    }

    /** Returns the role's color as a `#RRGGBB` hex string. Returns `#000000` for colorless roles. */
    public get colorHex(): string {
        return `#${this.color.toString(16).padStart(6, "0").toUpperCase()}`;
    }

    /** Returns the role's custom icon URL, or null if the role has no icon. */
    public iconURL(options: ImageURLOptions = {}): string | null {
        if (!this.iconHash) return null;
        return cdnURL(`/role-icons/${this.id}`, this.iconHash, options);
    }

    /** Whether this is the `@everyone` base role (its ID equals the guild ID). */
    public isEveryone(guildId: string): boolean {
        return this.id === guildId;
    }

    /** Discord role mention string. Used automatically in template literals. */
    public override toString(): string {
        return `<@&${this.id}>`;
    }
}

// ─── TextChannel ──────────────────────────────────────────────────────────────

/** A Discord text-capable channel. */
export class TextChannel extends Channel {
    /** Creates a text channel from Discord data. @param data Discord channel payload. */
    public constructor(
        data: {
            id: string;
            type: number;
            name?: string | null;
            parent_id?: string | null;
            guild_id?: string;
        } & Partial<import("@lunibee/types").APIChannel>,
        context?: import("./base.js").ResourceContext,
    ) {
        super(data, context);
    }
    /** Discord channel mention string. Used automatically in template literals. */
    public override toString(): string {
        return `<#${this.id}>`;
    }
}

// ─── Invite ───────────────────────────────────────────────────────────────────

/** A Discord invite link and its metadata. */
export class Invite {
    /** Invite code (the unique part of the URL). */
    public readonly code: string;
    /** Guild this invite belongs to, if any. */
    public readonly guildId: string | null;
    /** Channel this invite points to, if any. */
    public readonly channelId: string | null;
    /** User who created the invite, if available. */
    public readonly inviter: User | null;
    /** Number of times the invite has been used. */
    public uses: number;
    /** Maximum number of uses (0 = unlimited). */
    public maxUses: number;
    /** Duration in seconds until the invite expires (0 = never). */
    public maxAge: number;
    /** Whether the invite is temporary (kicks uninducted members on disconnect). */
    public temporary: boolean;
    /** When the invite was created. */
    public readonly createdAt: Date | null;
    /** When the invite expires, or null if it never expires. */
    public readonly expiresAt: Date | null;

    /** Creates an invite from Discord data. */
    public constructor(data: {
        code: string;
        guild?: { id: string } | null;
        channel?: { id: string } | null;
        inviter?: {
            id: string;
            username: string;
            global_name?: string | null;
            avatar?: string | null;
            bot?: boolean;
            system?: boolean;
            public_flags?: number;
            discriminator?: string;
        } | null;
        uses?: number;
        max_uses?: number;
        max_age?: number;
        temporary?: boolean;
        created_at?: string | null;
        expires_at?: string | null;
    }) {
        if (!data.code) throw new TypeError("An invite requires a code.");
        this.code = data.code;
        this.guildId = data.guild?.id ?? null;
        this.channelId = data.channel?.id ?? null;
        this.inviter = data.inviter ? new User(data.inviter) : null;
        this.uses = data.uses ?? 0;
        this.maxUses = data.max_uses ?? 0;
        this.maxAge = data.max_age ?? 0;
        this.temporary = data.temporary ?? false;
        this.createdAt = data.created_at ? new Date(data.created_at) : null;
        this.expiresAt = data.expires_at ? new Date(data.expires_at) : null;
    }

    /** The full invite URL. */
    public get url(): string {
        return `https://discord.gg/${this.code}`;
    }

    /** Returns the invite URL. Used automatically in template literals. */
    public toString(): string {
        return this.url;
    }
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

/** Webhook type constants. */
export const WebhookEnum = {
    Incoming: 1,
    ChannelFollower: 2,
    Application: 3,
} as const;
/** One {@link WebhookEnum} value, usable as a type. */
export type WebhookEnum = (typeof WebhookEnum)[keyof typeof WebhookEnum];

/** A Discord webhook — an HTTP endpoint that can post messages to a channel. */
export class Webhook extends BaseStructure {
    /** Webhook type. */
    public readonly type: number;
    /** Webhook display name. */
    public name: string | null;
    /** Webhook avatar hash. */
    public avatarHash: string | null;
    /** Channel this webhook posts to. */
    public readonly channelId: string | null;
    /** Guild this webhook belongs to. */
    public readonly guildId: string | null;
    /** Application that created this webhook, if any. */
    public readonly applicationId: string | null;
    /** Webhook token (only present for incoming webhooks). */
    public readonly token: string | null;

    /** Creates a webhook from Discord data. */
    public constructor(data: {
        id: string;
        type?: number;
        name?: string | null;
        avatar?: string | null;
        channel_id?: string | null;
        guild_id?: string | null;
        application_id?: string | null;
        token?: string;
    }) {
        super(data.id);
        this.type = data.type ?? WebhookEnum.Incoming;
        this.name = data.name ?? null;
        this.avatarHash = data.avatar ?? null;
        this.channelId = data.channel_id ?? null;
        this.guildId = data.guild_id ?? null;
        this.applicationId = data.application_id ?? null;
        this.token = data.token ?? null;
    }

    /** Returns the webhook avatar URL, or null if no avatar is set. */
    public avatarURL(options: ImageURLOptions = {}): string | null {
        if (!this.avatarHash) return null;
        return cdnURL(`/avatars/${this.id}`, this.avatarHash, options);
    }

    /** Returns the webhook execution URL, or null if no token is set. */
    public get url(): string | null {
        return this.token
            ? `https://discord.com/api/webhooks/${this.id}/${this.token}`
            : null;
    }

    /** Returns the webhook URL or its ID as a string. */
    public override toString(): string {
        return this.url ?? this.id;
    }
}

// ─── Emoji ────────────────────────────────────────────────────────────────────

/** A Discord emoji. */
export class Emoji extends BaseStructure {
    /** Emoji name. */
    public name: string | null;
    /** Roles allowed to use this emoji. */
    public roleIds: string[];
    /** User that created this emoji. */
    public user: User | null;
    /** Whether this emoji must be wrapped in colons. */
    public requireColons: boolean;
    /** Whether this emoji is managed. */
    public managed: boolean;
    /** Whether this emoji is animated. */
    public animated: boolean;
    /** Whether this emoji can be used, may be false due to loss of Server Boosts. */
    public available: boolean;

    /** Creates an emoji from Discord data. */
    public constructor(data: {
        id: string | null;
        name: string | null;
        roles?: string[];
        user?: import("@lunibee/types").UserData;
        require_colons?: boolean;
        managed?: boolean;
        animated?: boolean;
        available?: boolean;
    }) {
        // Unicode emoji have no snowflake: pass the base check with a
        // placeholder, then expose the documented "unicode" sentinel id.
        super(data.id ?? "0");
        if (data.id === null) (this as { id: string }).id = "unicode";
        this.name = data.name;
        this.roleIds = data.roles ?? [];
        this.user = data.user ? new User(data.user) : null;
        this.requireColons = data.require_colons ?? false;
        this.managed = data.managed ?? false;
        this.animated = data.animated ?? false;
        this.available = data.available ?? true;
    }

    /** Returns the URL for this emoji if it is custom, or null for unicode emojis. */
    public url(options: ImageURLOptions = {}): string | null {
        if (!this.id || this.id === "unicode") return null;
        const ext = options.extension ?? (this.animated ? "gif" : "png");
        const size = options.size ? `?size=${options.size}` : "";
        return `${CDN_BASE}/emojis/${this.id}.${ext}${size}`;
    }

    /** Returns the text required to render this emoji in Discord. */
    public override toString(): string {
        return this.id !== "unicode"
            ? `<${this.animated ? "a" : ""}:${this.name}:${this.id}>`
            : (this.name ?? "");
    }
}

// --- AutoModerationRule --------------------------------------------------------

/** A Discord AutoModeration Rule. */
export class AutoModerationRule extends BaseStructure {
    public guildId: string;
    public name: string;
    public creatorId: string;
    public eventType: number;
    public triggerType: number;
    public triggerMetadata: Record<string, unknown>;
    public actions: import("@lunibee/types").APIAutoModerationAction[];
    public enabled: boolean;
    public exemptRoles: string[];
    public exemptChannels: string[];

    /** Creates an auto moderation rule from Discord data. */
    public constructor(data: import("@lunibee/types").APIAutoModerationRule) {
        super(data.id);
        if (!/^\d{1,20}$/.test(data.guild_id))
            throw new TypeError(
                "AutoModerationRule guild_id must be a valid snowflake.",
            );
        this.guildId = data.guild_id;
        this.name = data.name;
        this.creatorId = data.creator_id;
        this.eventType = data.event_type;
        this.triggerType = data.trigger_type;
        this.triggerMetadata = data.trigger_metadata;
        this.actions = data.actions;
        this.enabled = data.enabled;
        this.exemptRoles = data.exempt_roles;
        this.exemptChannels = data.exempt_channels;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this.id,
            guildId: this.guildId,
            name: this.name,
            creatorId: this.creatorId,
            eventType: this.eventType,
            triggerType: this.triggerType,
            triggerMetadata: this.triggerMetadata,
            actions: this.actions,
            enabled: this.enabled,
            exemptRoles: this.exemptRoles,
            exemptChannels: this.exemptChannels,
        };
    }
}

// --- Welcome Screen -----------------------------------------------------------

/** A channel listed in a guild's Welcome Screen. */
export class WelcomeScreenChannel {
    public channelId: string;
    public description: string;
    public emojiId: string | null;
    public emojiName: string | null;

    public constructor(data: import("@lunibee/types").APIWelcomeScreenChannel) {
        this.channelId = data.channel_id;
        this.description = data.description;
        this.emojiId = data.emoji_id;
        this.emojiName = data.emoji_name;
    }
}

/** A Discord Guild Welcome Screen. */
export class GuildWelcomeScreen {
    public description: string | null;
    public channels: WelcomeScreenChannel[];

    public constructor(data: import("@lunibee/types").APIGuildWelcomeScreen) {
        this.description = data.description;
        this.channels = data.welcome_channels.map(
            (c) => new WelcomeScreenChannel(c),
        );
    }
}

// --- Guild Onboarding ---------------------------------------------------------

/** An option within a Guild Onboarding Prompt. */
export class OnboardingPromptOption extends BaseStructure {
    public channelIds: string[];
    public roleIds: string[];
    public emoji: import("@lunibee/types").APIPartialEmoji | undefined;
    public title: string;
    public description: string | null;

    public constructor(
        data: import("@lunibee/types").APIOnboardingPromptOption,
    ) {
        super(data.id);
        this.channelIds = data.channel_ids;
        this.roleIds = data.role_ids;
        this.emoji = data.emoji;
        this.title = data.title;
        this.description = data.description;
    }
}

/** A prompt shown during Guild Onboarding. */
export class OnboardingPrompt extends BaseStructure {
    public type: number;
    public options: OnboardingPromptOption[];
    public title: string;
    public singleSelect: boolean;
    public required: boolean;
    public inOnboarding: boolean;

    public constructor(data: import("@lunibee/types").APIOnboardingPrompt) {
        super(data.id);
        this.type = data.type;
        this.options = data.options.map((o) => new OnboardingPromptOption(o));
        this.title = data.title;
        this.singleSelect = data.single_select;
        this.required = data.required;
        this.inOnboarding = data.in_onboarding;
    }
}

/** A Discord Guild Onboarding setup. */
export class GuildOnboarding extends BaseStructure {
    public prompts: OnboardingPrompt[];
    public defaultChannelIds: string[];
    public enabled: boolean;
    public mode: number;

    public constructor(data: import("@lunibee/types").APIGuildOnboarding) {
        super(data.guild_id);
        this.prompts = data.prompts.map((p) => new OnboardingPrompt(p));
        this.defaultChannelIds = data.default_channel_ids;
        this.enabled = data.enabled;
        this.mode = data.mode;
    }
}
