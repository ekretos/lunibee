import { ResourceManager } from "./base.js";
import { Guild, AutoModerationRule, GuildWelcomeScreen, GuildOnboarding } from "@lunibee/structures";
import { type REST, Routes } from "@lunibee/rest";
import {
    type APIChannel,
    type APIGuildPreview,
    type APIInvite,
    type APIWebhook,
    type APIAutoModerationRule,
    type APIGuildWelcomeScreen,
    type APIGuildOnboarding,
} from "@lunibee/types";

type GuildData = ConstructorParameters<typeof Guild>[0];

export interface GuildCreateOptions extends Record<string, unknown> {
    name: string;
}
export interface GuildEditOptions extends Record<string, unknown> {}

export class GuildManager extends ResourceManager<string, Guild> {
    readonly #rest: REST;
    public constructor(rest: REST) {
        super(
            async (id) =>
                new Guild(await rest.get<GuildData>(Routes.guild(id))),
            (guild) => guild.id,
        );
        this.#rest = rest;
    }

    /** Creates a new guild. (Bot must be in fewer than 10 guilds). */
    public async create(options: GuildCreateOptions): Promise<Guild> {
        const data = await this.#rest.post<GuildData>("/guilds", options);
        return this.upsert(new Guild(data));
    }

    /** Modifies a guild's settings. */
    public async edit(id: string, options: GuildEditOptions): Promise<Guild> {
        const data = await this.#rest.patch<GuildData>(
            Routes.guild(id),
            options,
        );
        return this.upsert(new Guild(data));
    }

    /** Deletes a guild permanently. User must be the owner. */
    public async deleteGuild(id: string): Promise<void> {
        await this.#rest.delete(Routes.guild(id));
    }

    /** Fetches a guild's preview (even if the bot is not in the guild). */
    public async fetchPreview(id: string): Promise<APIGuildPreview> {
        return this.#rest.get<APIGuildPreview>(Routes.guildPreview(id));
    }

    /** Fetches all active threads in the guild. */
    public async fetchActiveThreads(
        id: string,
    ): Promise<{ threads: APIChannel[]; members: unknown[] }> {
        return this.#rest.get<{ threads: APIChannel[]; members: unknown[] }>(
            Routes.guildActiveThreads(id),
        );
    }

    /** Fetches all webhooks in the guild. */
    public async fetchWebhooks(id: string): Promise<APIWebhook[]> {
        return this.#rest.get<APIWebhook[]>(Routes.guildWebhooks(id));
    }

    /** Fetches all invites in the guild. */
    public async fetchInvites(id: string): Promise<APIInvite[]> {
        return this.#rest.get<APIInvite[]>(Routes.guildInvites(id));
    }

    /**
     * Fetches audit log entries for a guild.
     * @param guildId Guild identifier.
     * @param options Filter options: userId (filter by actor), actionType (AuditLogEvent number), before (entry ID cursor), limit (1–100, default 50).
     * @returns Typed audit log response with `audit_log_entries` and related resources.
     */
    public async fetchAuditLog(
        guildId: string,
        options: {
            userId?: string;
            actionType?: number;
            before?: string;
            after?: string;
            limit?: number;
        } = {},
    ): Promise<AuditLogResponse> {
        const params = new URLSearchParams();
        if (options.userId) params.set("user_id", options.userId);
        if (options.actionType !== undefined)
            params.set("action_type", String(options.actionType));
        if (options.before) params.set("before", options.before);
        if (options.after) params.set("after", options.after);
        if (options.limit !== undefined)
            params.set(
                "limit",
                String(Math.min(100, Math.max(1, options.limit))),
            );
        const suffix = params.toString();
        return this.#rest.get<AuditLogResponse>(
            `${Routes.guildAuditLog(guildId)}${suffix ? `?${suffix}` : ""}`,
        );
    }

    /**
     * Fetches members from a guild (paginated).
     * @param guildId Guild identifier.
     * @param options Fetch options: limit (1–1000, default 100), after (member ID cursor).
     * @returns Array of raw member data payloads.
     */
    public async fetchMembers(
        guildId: string,
        options: { limit?: number; after?: string } = {},
    ): Promise<Record<string, unknown>[]> {
        const params = new URLSearchParams();
        if (options.limit !== undefined)
            params.set(
                "limit",
                String(Math.min(1000, Math.max(1, options.limit))),
            );
        if (options.after) params.set("after", options.after);
        const suffix = params.toString();
        return this.#rest.get<Record<string, unknown>[]>(
            `${Routes.guildMembers(guildId)}${suffix ? `?${suffix}` : ""}`,
        );
    }

    /** Fetches a list of all auto moderation rules currently configured for guild. */
    public async fetchAutoModerationRules(guildId: string): Promise<AutoModerationRule[]> {
        const rules = await this.#rest.get<APIAutoModerationRule[]>(Routes.guildAutoModerationRules(guildId));
        return rules.map((r) => new AutoModerationRule(r));
    }

    /** Fetches a single auto moderation rule. */
    public async fetchAutoModerationRule(guildId: string, ruleId: string): Promise<AutoModerationRule> {
        const rule = await this.#rest.get<APIAutoModerationRule>(Routes.guildAutoModerationRule(guildId, ruleId));
        return new AutoModerationRule(rule);
    }

    /** Creates a new auto moderation rule. */
    public async createAutoModerationRule(guildId: string, options: Record<string, unknown>): Promise<AutoModerationRule> {
        const rule = await this.#rest.post<APIAutoModerationRule>(Routes.guildAutoModerationRules(guildId), options);
        return new AutoModerationRule(rule);
    }

    /** Modifies an existing auto moderation rule. */
    public async editAutoModerationRule(guildId: string, ruleId: string, options: Record<string, unknown>): Promise<AutoModerationRule> {
        const rule = await this.#rest.patch<APIAutoModerationRule>(Routes.guildAutoModerationRule(guildId, ruleId), options);
        return new AutoModerationRule(rule);
    }

    /** Deletes an auto moderation rule. */
    public async deleteAutoModerationRule(guildId: string, ruleId: string): Promise<void> {
        await this.#rest.delete(Routes.guildAutoModerationRule(guildId, ruleId));
    }
}

// ─── Audit Log Types ──────────────────────────────────────────────────────────

/** A single audit log entry as returned by the Discord API. */
export interface AuditLogEntry {
    id: string;
    action_type: number;
    user_id: string | null;
    target_id: string | null;
    reason?: string;
    changes?: Array<{ key: string; old_value?: unknown; new_value?: unknown }>;
    options?: Record<string, unknown>;
}

/** Discord API audit log response payload. */
export interface AuditLogResponse {
    audit_log_entries: AuditLogEntry[];
    users: Record<string, unknown>[];
    integrations: Record<string, unknown>[];
    webhooks: Record<string, unknown>[];
    guild_scheduled_events: Record<string, unknown>[];
    threads: Record<string, unknown>[];
    application_commands: Record<string, unknown>[];
}

/** Known Discord audit log event type numbers. */
export const AuditLogEvent = {
    GuildUpdate: 1,
    ChannelCreate: 10,
    ChannelUpdate: 11,
    ChannelDelete: 12,
    ChannelOverwriteCreate: 13,
    ChannelOverwriteUpdate: 14,
    ChannelOverwriteDelete: 15,
    MemberKick: 20,
    MemberPrune: 21,
    MemberBanAdd: 22,
    MemberBanRemove: 23,
    MemberUpdate: 24,
    MemberRoleUpdate: 25,
    MemberMove: 26,
    MemberDisconnect: 27,
    BotAdd: 28,
    RoleCreate: 30,
    RoleUpdate: 31,
    RoleDelete: 32,
    InviteCreate: 40,
    InviteUpdate: 41,
    InviteDelete: 42,
    WebhookCreate: 50,
    WebhookUpdate: 51,
    WebhookDelete: 52,
    EmojiCreate: 60,
    EmojiUpdate: 61,
    EmojiDelete: 62,
    MessageDelete: 72,
    MessageBulkDelete: 73,
    MessagePin: 74,
    MessageUnpin: 75,
    IntegrationCreate: 80,
    IntegrationUpdate: 81,
    IntegrationDelete: 82,
    StageInstanceCreate: 83,
    StageInstanceUpdate: 84,
    StageInstanceDelete: 85,
    StickerCreate: 90,
    StickerUpdate: 91,
    StickerDelete: 92,
    ScheduledEventCreate: 100,
    ScheduledEventUpdate: 101,
    ScheduledEventDelete: 102,
    ThreadCreate: 110,
    ThreadUpdate: 111,
    ThreadDelete: 112,
    AutoModerationRuleCreate: 140,
    AutoModerationRuleUpdate: 141,
    AutoModerationRuleDelete: 142,
    AutoModerationBlockMessage: 143,
} as const;
