import { Manager, ResourceManager, splitReason } from "./base.js";
import { EmojiManager } from "./emoji.js";
import { GuildSoundboardManager, GuildStickerManager } from "./advanced.js";
import { GuildMemberManager } from "./member.js";
import { RoleManager } from "./role.js";
import {
    GuildBanManager,
    GuildScheduledEventManager,
} from "./guild-resources.js";
import {
    Guild,
    AutoModerationRule,
    type ResourceContext,
} from "@lunibee/structures";
import { type REST, Routes } from "@lunibee/rest";
import {
    type APIChannel,
    type APIGuildPreview,
    type APIInvite,
    type APIWebhook,
    type APIAutoModerationRule,
    type APIInviteCreate,
    type APIVoiceState,
    type APIPresenceUpdate,
    type APIWelcomeScreen,
    type APIWelcomeScreenChannel,
    type APIGuildOnboarding,
    type APIOnboardingPrompt,
} from "@lunibee/types";

type GuildData = ConstructorParameters<typeof Guild>[0];

/** Appends encoded query parameters to a `Routes`-generated path so query building
 * stays centralized and URL-encoded rather than hand-concatenated at each call site.
 * @param path Base path from a `Routes.*` helper. @param params Query parameters (empty → path unchanged). */
function withQuery(path: string, params: URLSearchParams): string {
    const suffix = params.toString();
    return suffix ? `${path}?${suffix}` : path;
}

export interface GuildCreateOptions extends Record<string, unknown> {
    name: string;
}
export interface GuildEditOptions extends Record<string, unknown> {
    /** Audit-log reason. */
    reason?: string;
}

export class GuildManager extends ResourceManager<string, Guild> {
    readonly #rest: REST;
    readonly #bans = new Map<string, GuildBanManager>();
    readonly #scheduledEvents = new Map<string, GuildScheduledEventManager>();
    readonly #members = new Map<string, GuildMemberManager>();
    readonly #roles = new Map<string, RoleManager>();
    readonly #emojis = new Map<string, EmojiManager>();
    readonly #stickers = new Map<string, GuildStickerManager>();
    readonly #soundboard = new Map<string, GuildSoundboardManager>();
    readonly #voiceStates = new Map<string, Manager<string, APIVoiceState>>();
    readonly #autoModerationRules = new Map<
        string,
        Manager<string, APIAutoModerationRule>
    >();
    readonly #presences = new Map<string, Manager<string, APIPresenceUpdate>>();
    readonly #invites = new Map<string, Manager<string, APIInviteCreate>>();
    #context?: ResourceContext;

    /** Lets members from this manager act through a client (`member.kick()`...). Called by the client. */
    public attachContext(context: ResourceContext): void {
        this.#context = context;
    }

    /** Returns the per-guild entry of `map`, creating it on first use. */
    #perGuild<M>(map: Map<string, M>, guildId: string, create: () => M): M {
        let manager = map.get(guildId);
        if (!manager) map.set(guildId, (manager = create()));
        return manager;
    }
    public constructor(rest: REST) {
        super(
            async (id) =>
                new Guild(await rest.get<GuildData>(Routes.guild(id))),
            (guild) => guild.id,
        );
        this.#rest = rest;
    }

    /** Ban manager for a guild (one instance per guild). */
    public bans(guildId: string): GuildBanManager {
        let manager = this.#bans.get(guildId);
        if (!manager)
            this.#bans.set(
                guildId,
                (manager = new GuildBanManager(this.#rest, guildId)),
            );
        return manager;
    }

    /** Scheduled-event manager for a guild (one instance per guild). */
    public scheduledEvents(guildId: string): GuildScheduledEventManager {
        let manager = this.#scheduledEvents.get(guildId);
        if (!manager)
            this.#scheduledEvents.set(
                guildId,
                (manager = new GuildScheduledEventManager(this.#rest, guildId)),
            );
        return manager;
    }

    /** Member manager for a guild (one instance per guild, kept in sync by the Gateway). */
    public members(guildId: string): GuildMemberManager {
        let manager = this.#members.get(guildId);
        if (!manager)
            this.#members.set(
                guildId,
                (manager = new GuildMemberManager(
                    guildId,
                    this.#rest,
                    () => this.#context,
                )),
            );
        return manager;
    }

    /** Role manager for a guild (one instance per guild, kept in sync by the Gateway). */
    public roles(guildId: string): RoleManager {
        let manager = this.#roles.get(guildId);
        if (!manager)
            this.#roles.set(
                guildId,
                (manager = new RoleManager(guildId, this.#rest)),
            );
        return manager;
    }

    /** Emoji manager for a guild (one instance per guild, kept in sync by the Gateway). */
    public emojis(guildId: string): EmojiManager {
        let manager = this.#emojis.get(guildId);
        if (!manager)
            this.#emojis.set(
                guildId,
                (manager = new EmojiManager(this.#rest, guildId)),
            );
        return manager;
    }

    /** Sticker manager for a guild (one instance per guild, kept in sync by the Gateway). */
    public stickers(guildId: string): GuildStickerManager {
        let manager = this.#stickers.get(guildId);
        if (!manager)
            this.#stickers.set(
                guildId,
                (manager = new GuildStickerManager(this.#rest, guildId)),
            );
        return manager;
    }

    /** Soundboard manager for a guild (one instance per guild, kept in sync by the Gateway). */
    public soundboard(guildId: string): GuildSoundboardManager {
        let manager = this.#soundboard.get(guildId);
        if (!manager)
            this.#soundboard.set(
                guildId,
                (manager = new GuildSoundboardManager(this.#rest, guildId)),
            );
        return manager;
    }

    /** Voice states by user ID for a guild, kept in sync by `GUILD_CREATE` and `VOICE_STATE_UPDATE`. */
    public voiceStates(guildId: string): Manager<string, APIVoiceState> {
        return this.#perGuild(this.#voiceStates, guildId, () => new Manager());
    }

    /** Latest presence by user ID for a guild; filled only when `cache.presences` is on. */
    public presences(guildId: string): Manager<string, APIPresenceUpdate> {
        return this.#perGuild(this.#presences, guildId, () => new Manager());
    }

    /** Auto-moderation rules by ID for a guild, kept in sync by `AUTO_MODERATION_RULE_*` events. */
    public autoModerationRules(
        guildId: string,
    ): Manager<string, APIAutoModerationRule> {
        return this.#perGuild(
            this.#autoModerationRules,
            guildId,
            () => new Manager(),
        );
    }

    /** Invites by code for a guild, kept in sync by `INVITE_CREATE` / `INVITE_DELETE`. */
    public invites(guildId: string): Manager<string, APIInviteCreate> {
        return this.#perGuild(this.#invites, guildId, () => new Manager());
    }

    /** Merges a guild payload into the cached instance, keeping object identity. */
    public patch(data: GuildData): Guild {
        const guild = new Guild(data);
        const existing = this.get(guild.id);
        if (!existing) return this.upsert(guild);
        // Partial payloads (e.g. GUILD_UPDATE has no member_count) leave
        // optional fields undefined; those must not erase known values.
        for (const [key, value] of Object.entries(guild))
            if (value !== undefined)
                (existing as unknown as Record<string, unknown>)[key] = value;
        return existing;
    }

    /** Removes a guild and every per-guild manager that belongs to it. */
    public override delete(id: string): boolean {
        this.#bans.delete(id);
        this.#scheduledEvents.delete(id);
        this.#members.delete(id);
        this.#roles.delete(id);
        this.#emojis.delete(id);
        this.#stickers.delete(id);
        this.#soundboard.delete(id);
        this.#voiceStates.delete(id);
        this.#presences.delete(id);
        this.#autoModerationRules.delete(id);
        this.#invites.delete(id);
        return super.delete(id);
    }

    /** Creates a new guild. (Bot must be in fewer than 10 guilds). */
    public async create(options: GuildCreateOptions): Promise<Guild> {
        const data = await this.#rest.post<GuildData>("/guilds", options);
        return this.upsert(new Guild(data));
    }

    /** Modifies a guild's settings. */
    public async edit(id: string, options: GuildEditOptions): Promise<Guild> {
        const [payload, reason] = splitReason(options);
        const data = await this.#rest.patch<GuildData>(
            Routes.guild(id),
            payload,
            { reason },
        );
        return this.upsert(new Guild(data));
    }

    /** Deletes a guild permanently. The bot must own it. */
    public async remove(id: string): Promise<void> {
        await this.#rest.delete(Routes.guild(id));
    }

    /** Fetches a guild's preview (even if the bot is not in the guild). */
    public async fetchPreview(id: string): Promise<APIGuildPreview> {
        return this.#rest.get<APIGuildPreview>(Routes.guildPreview(id));
    }

    /** Fetches the welcome screen of a community guild. */
    public async fetchWelcomeScreen(id: string): Promise<APIWelcomeScreen> {
        return this.#rest.get<APIWelcomeScreen>(Routes.guildWelcomeScreen(id));
    }

    /** Edits the welcome screen (needs Manage Guild and the Community feature). */
    public async editWelcomeScreen(
        id: string,
        options: {
            enabled?: boolean;
            description?: string | null;
            welcomeChannels?: APIWelcomeScreenChannel[] | null;
            reason?: string;
        },
    ): Promise<APIWelcomeScreen> {
        const { reason, welcomeChannels, ...rest } = options;
        return this.#rest.patch<APIWelcomeScreen>(
            Routes.guildWelcomeScreen(id),
            { ...rest, welcome_channels: welcomeChannels },
            { reason },
        );
    }

    /** Fetches a guild's onboarding: prompts, default channels and mode. */
    public async fetchOnboarding(id: string): Promise<APIGuildOnboarding> {
        return this.#rest.get<APIGuildOnboarding>(Routes.guildOnboarding(id));
    }

    /** Replaces parts of a guild's onboarding (needs Manage Guild and Manage Roles). */
    public async editOnboarding(
        id: string,
        options: {
            prompts?: APIOnboardingPrompt[];
            defaultChannelIds?: string[];
            enabled?: boolean;
            mode?: number;
            reason?: string;
        },
    ): Promise<APIGuildOnboarding> {
        const { reason, defaultChannelIds, ...rest } = options;
        return this.#rest.put<APIGuildOnboarding>(
            Routes.guildOnboarding(id),
            { ...rest, default_channel_ids: defaultChannelIds },
            { reason },
        );
    }

    /**
     * Edits a voice state in a stage channel: unsuppress the bot to speak, or
     * move a speaker back to the audience. `userId` may be `"@me"`.
     */
    public async editVoiceState(
        id: string,
        userId: string,
        options: {
            channelId: string;
            suppress?: boolean;
            requestToSpeakTimestamp?: string | null;
        },
    ): Promise<void> {
        await this.#rest.patch(Routes.guildVoiceState(id, userId), {
            channel_id: options.channelId,
            suppress: options.suppress,
            request_to_speak_timestamp: options.requestToSpeakTimestamp,
        });
    }

    /** Removes an integration (and the bot or role it created) from a guild. */
    public async removeIntegration(
        id: string,
        integrationId: string,
        reason?: string,
    ): Promise<void> {
        await this.#rest.delete(Routes.guildIntegration(id, integrationId), {
            reason,
        });
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
        return this.#rest.get<AuditLogResponse>(
            withQuery(Routes.guildAuditLog(guildId), params),
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
        return this.#rest.get<Record<string, unknown>[]>(
            withQuery(Routes.guildMembers(guildId), params),
        );
    }

    /** Fetches a list of all auto moderation rules currently configured for guild. */
    public async fetchAutoModerationRules(
        guildId: string,
    ): Promise<AutoModerationRule[]> {
        const rules = await this.#rest.get<APIAutoModerationRule[]>(
            Routes.guildAutoModerationRules(guildId),
        );
        return rules.map((r) => new AutoModerationRule(r));
    }

    /** Fetches a single auto moderation rule. */
    public async fetchAutoModerationRule(
        guildId: string,
        ruleId: string,
    ): Promise<AutoModerationRule> {
        const rule = await this.#rest.get<APIAutoModerationRule>(
            Routes.guildAutoModerationRule(guildId, ruleId),
        );
        return new AutoModerationRule(rule);
    }

    /** Creates a new auto moderation rule. */
    public async createAutoModerationRule(
        guildId: string,
        options: Record<string, unknown> & { reason?: string },
    ): Promise<AutoModerationRule> {
        const [payload, reason] = splitReason(options);
        const rule = await this.#rest.post<APIAutoModerationRule>(
            Routes.guildAutoModerationRules(guildId),
            payload,
            { reason },
        );
        return new AutoModerationRule(rule);
    }

    /** Modifies an existing auto moderation rule. */
    public async editAutoModerationRule(
        guildId: string,
        ruleId: string,
        options: Record<string, unknown> & { reason?: string },
    ): Promise<AutoModerationRule> {
        const [payload, reason] = splitReason(options);
        const rule = await this.#rest.patch<APIAutoModerationRule>(
            Routes.guildAutoModerationRule(guildId, ruleId),
            payload,
            { reason },
        );
        return new AutoModerationRule(rule);
    }

    /** Deletes an auto moderation rule. @param reason Audit-log reason. */
    public async deleteAutoModerationRule(
        guildId: string,
        ruleId: string,
        reason?: string,
    ): Promise<void> {
        await this.#rest.delete(
            Routes.guildAutoModerationRule(guildId, ruleId),
            { reason },
        );
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
