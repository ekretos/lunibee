import { Manager } from "./base.js";
import { Routes, type REST } from "@lunibee/rest";
import type {
    APIGuildScheduledEvent,
    APIStageInstance,
    UserData,
} from "@lunibee/types";

/** Raw Discord ban object. */
export interface APIBan {
    user: UserData;
    reason: string | null;
}

/** Options for {@link GuildBanManager.create}. */
export interface GuildBanCreateOptions {
    /** Seconds of message history to delete (0-604800). */
    deleteMessageSeconds?: number;
    /** Audit-log reason. */
    reason?: string;
}

/** Appends encoded query parameters to a route. */
function withQuery(path: string, params: Record<string, unknown>): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params))
        if (value !== undefined) query.set(key, String(value));
    const suffix = query.toString();
    return suffix ? `${path}?${suffix}` : path;
}

/** Manages a guild's bans, cached by user ID. Discord.js-familiar. */
export class GuildBanManager extends Manager<string, APIBan> {
    readonly #rest: REST;
    public readonly guildId: string;

    public constructor(rest: REST, guildId: string) {
        super();
        this.#rest = rest;
        this.guildId = guildId;
    }

    /** Fetches one ban. */
    public async fetch(userId: string): Promise<APIBan> {
        const ban = await this.#rest.get<APIBan>(
            Routes.guildBan(this.guildId, userId),
        );
        this.set(ban.user.id, ban);
        return ban;
    }

    /** Fetches a page of bans (`limit` 1-1000, `before`/`after` user-ID cursors). */
    public async fetchAll(
        options: { limit?: number; before?: string; after?: string } = {},
    ): Promise<APIBan[]> {
        const limit =
            options.limit === undefined
                ? undefined
                : Math.min(1000, Math.max(1, options.limit));
        const bans = await this.#rest.get<APIBan[]>(
            withQuery(Routes.guildBans(this.guildId), {
                limit,
                before: options.before,
                after: options.after,
            }),
        );
        for (const ban of bans) this.set(ban.user.id, ban);
        return bans;
    }

    /** Bans a user. */
    public async create(
        userId: string,
        options: GuildBanCreateOptions = {},
    ): Promise<void> {
        await this.#rest.put(
            Routes.guildBan(this.guildId, userId),
            { delete_message_seconds: options.deleteMessageSeconds },
            { reason: options.reason },
        );
    }

    /** Lifts a ban. */
    public async remove(userId: string, reason?: string): Promise<void> {
        await this.#rest.delete(Routes.guildBan(this.guildId, userId), {
            reason,
        });
        this.delete(userId);
    }
}

/** Fields accepted when creating or editing a scheduled event. */
export type GuildScheduledEventOptions = Partial<
    Omit<APIGuildScheduledEvent, "id" | "guild_id" | "creator" | "user_count">
> &
    Record<string, unknown>;

/** Manages a guild's scheduled events, cached by event ID. Discord.js-familiar. */
export class GuildScheduledEventManager extends Manager<
    string,
    APIGuildScheduledEvent
> {
    readonly #rest: REST;
    public readonly guildId: string;

    public constructor(rest: REST, guildId: string) {
        super();
        this.#rest = rest;
        this.guildId = guildId;
    }

    #store(event: APIGuildScheduledEvent): APIGuildScheduledEvent {
        this.set(event.id, event);
        return event;
    }

    /** Fetches one event. */
    public async fetch(
        eventId: string,
        options: { withUserCount?: boolean } = {},
    ): Promise<APIGuildScheduledEvent> {
        return this.#store(
            await this.#rest.get(
                withQuery(Routes.guildScheduledEvent(this.guildId, eventId), {
                    with_user_count: options.withUserCount,
                }),
            ),
        );
    }

    /** Fetches every event in the guild. */
    public async fetchAll(
        options: { withUserCount?: boolean } = {},
    ): Promise<APIGuildScheduledEvent[]> {
        const events = await this.#rest.get<APIGuildScheduledEvent[]>(
            withQuery(Routes.guildScheduledEvents(this.guildId), {
                with_user_count: options.withUserCount,
            }),
        );
        return events.map((event) => this.#store(event));
    }

    /** Creates an event. */
    public async create(
        options: GuildScheduledEventOptions,
        reason?: string,
    ): Promise<APIGuildScheduledEvent> {
        return this.#store(
            await this.#rest.post(
                Routes.guildScheduledEvents(this.guildId),
                options,
                { reason },
            ),
        );
    }

    /** Edits an event. */
    public async edit(
        eventId: string,
        options: GuildScheduledEventOptions,
        reason?: string,
    ): Promise<APIGuildScheduledEvent> {
        return this.#store(
            await this.#rest.patch(
                Routes.guildScheduledEvent(this.guildId, eventId),
                options,
                { reason },
            ),
        );
    }

    /** Deletes an event. */
    public async remove(eventId: string): Promise<void> {
        await this.#rest.delete(
            Routes.guildScheduledEvent(this.guildId, eventId),
        );
        this.delete(eventId);
    }

    /** Fetches users subscribed to an event (`limit` 1-100). */
    public async fetchSubscribers(
        eventId: string,
        options: {
            limit?: number;
            withMember?: boolean;
            before?: string;
            after?: string;
        } = {},
    ): Promise<{ guild_scheduled_event_id: string; user: UserData }[]> {
        const limit =
            options.limit === undefined
                ? undefined
                : Math.min(100, Math.max(1, options.limit));
        return this.#rest.get(
            withQuery(Routes.guildScheduledEventUsers(this.guildId, eventId), {
                limit,
                with_member: options.withMember,
                before: options.before,
                after: options.after,
            }),
        );
    }
}

/** Options for creating a stage instance. */
export interface StageInstanceCreateOptions {
    topic: string;
    privacyLevel?: number;
    sendStartNotification?: boolean;
    guildScheduledEventId?: string;
}

/** Manages stage instances, cached by stage channel ID. Discord.js-familiar. */
export class StageInstanceManager extends Manager<string, APIStageInstance> {
    readonly #rest: REST;

    public constructor(rest: REST) {
        super();
        this.#rest = rest;
    }

    #store(stage: APIStageInstance): APIStageInstance {
        this.set(stage.channel_id, stage);
        return stage;
    }

    /** Starts a stage instance in a stage channel. */
    public async create(
        channelId: string,
        options: StageInstanceCreateOptions,
        reason?: string,
    ): Promise<APIStageInstance> {
        return this.#store(
            await this.#rest.post(
                Routes.stageInstances(),
                {
                    channel_id: channelId,
                    topic: options.topic,
                    privacy_level: options.privacyLevel,
                    send_start_notification: options.sendStartNotification,
                    guild_scheduled_event_id: options.guildScheduledEventId,
                },
                { reason },
            ),
        );
    }

    /** Fetches the stage instance of a stage channel. */
    public async fetch(channelId: string): Promise<APIStageInstance> {
        return this.#store(
            await this.#rest.get(Routes.stageInstanceByChannel(channelId)),
        );
    }

    /** Edits a stage instance's topic or privacy level. */
    public async edit(
        channelId: string,
        options: { topic?: string; privacyLevel?: number },
        reason?: string,
    ): Promise<APIStageInstance> {
        return this.#store(
            await this.#rest.patch(
                Routes.stageInstanceByChannel(channelId),
                { topic: options.topic, privacy_level: options.privacyLevel },
                { reason },
            ),
        );
    }

    /** Ends a stage instance. */
    public async remove(channelId: string, reason?: string): Promise<void> {
        await this.#rest.delete(Routes.stageInstanceByChannel(channelId), {
            reason,
        });
        this.delete(channelId);
    }
}

/** Overwrite target type: 0 = role, 1 = member. */
export type PermissionOverwriteTargetType = 0 | 1;

/** Permission values accepted by {@link PermissionOverwriteManager.edit}. */
export interface PermissionOverwriteOptions {
    /** Target type: 0 = role, 1 = member. */
    type: PermissionOverwriteTargetType;
    /** Allowed permission bits. */
    allow?: bigint | number | string;
    /** Denied permission bits. */
    deny?: bigint | number | string;
}

/** Manages a channel's permission overwrites. Discord.js-familiar. */
export class PermissionOverwriteManager {
    readonly #rest: REST;
    public readonly channelId: string;

    public constructor(rest: REST, channelId: string) {
        this.#rest = rest;
        this.channelId = channelId;
    }

    /** Creates or replaces the overwrite for a role or member. */
    public async edit(
        overwriteId: string,
        options: PermissionOverwriteOptions,
        reason?: string,
    ): Promise<void> {
        await this.#rest.put(
            Routes.channelPermission(this.channelId, overwriteId),
            {
                type: options.type,
                allow: BigInt(options.allow ?? 0).toString(),
                deny: BigInt(options.deny ?? 0).toString(),
            },
            { reason },
        );
    }

    /** Deletes the overwrite for a role or member. */
    public async remove(overwriteId: string, reason?: string): Promise<void> {
        await this.#rest.delete(
            Routes.channelPermission(this.channelId, overwriteId),
            { reason },
        );
    }
}
