import { Manager, ResourceManager, splitReason } from "./base.js";
export { Manager, ResourceManager } from "./base.js";
/** Discord.js-familiar alias for {@link ResourceManager}. */
export { ResourceManager as CachedManager } from "./base.js";
import { REST, Routes } from "@lunibee/rest";
import {
    Channel,
    createChannel,
    Message,
    User,
    type ResourceContext,
} from "@lunibee/structures";
import {
    MessageManager,
    toRequest,
    type MessageCacheOptions,
    type MessageCreateOptions as ManagerMessageCreateOptions,
} from "./message.js";
import { ThreadManager } from "./thread.js";

export { UserManager } from "./user.js";
export { GuildManager } from "./guild.js";
export type { AuditLogEntry, AuditLogResponse } from "./guild.js";
export { AuditLogEvent } from "./guild.js";

export type MessageCreateOptions = ManagerMessageCreateOptions;
export type MessageEditOptions = Record<string, unknown> & { content?: string };
/** Discord only bulk-deletes messages younger than two weeks. */
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60_000;
/** Creation time (ms) encoded in a snowflake. */
function snowflakeTime(id: string): number {
    return Number((BigInt(id) >> 22n) + 1_420_070_400_000n);
}
export interface MessageFetchOptions {
    cache?: boolean;
}
export interface MessageQueryOptions {
    before?: string;
    after?: string;
    around?: string;
    limit?: number;
}
export interface MessageThreadOptions {
    name: string;
    autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
    rateLimitPerUser?: number;
}
export interface ReactionFetchOptions {
    limit?: number;
    after?: string;
}

export interface ChannelCreateOptions extends Record<string, unknown> {
    /** Audit-log reason. */
    reason?: string;
    name: string;
    type: number;
    guild_id?: string;
    parent_id?: string | null;
}
export type ChannelEditOptions = Record<string, unknown> & {
    /** Audit-log reason. */
    reason?: string;
};

import { PermissionOverwriteManager } from "./guild-resources.js";

export class ChannelManager extends Manager<string, Channel> {
    readonly #rest: REST;
    readonly #context: ResourceContext;
    readonly #messageManagers = new Map<string, MessageManager>();
    readonly #messageCache?: MessageCacheOptions;
    readonly #allowedMentions?: unknown;
    /**
     * @param options.messageCache Enables a bounded per-channel message cache; messages are not cached by default.
     * @param options.allowedMentions Default `allowed_mentions` for sends and edits without their own.
     */
    public constructor(
        rest: REST,
        options: {
            messageCache?: MessageCacheOptions;
            allowedMentions?: unknown;
        } = {},
    ) {
        super();
        this.#rest = rest;
        this.#messageCache = options.messageCache;
        this.#allowedMentions = options.allowedMentions;
        this.#context = {
            sendMessage: (channelId, options) => this.send(channelId, options),
            editMessage: (channelId, messageId, options) =>
                this.editMessage(channelId, messageId, options),
            deleteMessage: (channelId, messageId, reason) =>
                this.deleteMessage(channelId, messageId, reason),
            crosspostMessage: (channelId, messageId) =>
                this.crosspostMessage(channelId, messageId),
            editChannel: (channelId, options) => this.edit(channelId, options),
            deleteChannel: (channelId, reason) =>
                this.remove(channelId, reason),
            addReaction: (channelId, messageId, emoji) =>
                this.addReaction(channelId, messageId, emoji),
            removeOwnReaction: (channelId, messageId, emoji) =>
                this.removeOwnReaction(channelId, messageId, emoji),
            removeReaction: (channelId, messageId, emoji, userId) =>
                this.removeReaction(channelId, messageId, emoji, userId),
            removeAllReactions: (channelId, messageId) =>
                this.removeAllReactions(channelId, messageId),
            pinMessage: (channelId, messageId, reason) =>
                this.pinMessage(channelId, messageId, reason),
            unpinMessage: (channelId, messageId, reason) =>
                this.unpinMessage(channelId, messageId, reason),
        };
    }
    public messages(channelId: string): MessageManager {
        let manager = this.#messageManagers.get(channelId);
        if (!manager) {
            manager = new MessageManager(
                this.#rest,
                this.#context,
                channelId,
                this.#messageCache,
                this.#allowedMentions,
            );
            this.#messageManagers.set(channelId, manager);
        }
        return manager;
    }
    /** Permission overwrite manager for a channel. */
    public permissionOverwrites(channelId: string): PermissionOverwriteManager {
        return new PermissionOverwriteManager(
            this.#rest,
            channelId,
            () => this.get(channelId)?.permissionOverwrites,
        );
    }
    public threads(channelId: string): ThreadManager {
        return new ThreadManager(this.#rest, this.#context, channelId);
    }
    /** Fetches a channel; concurrent fetches share a request and a stale result never overwrites newer state. */
    public fetch(channelId: string): Promise<Channel> {
        return this.fetchOnce(
            channelId,
            async () =>
                createChannel(
                    await this.#rest.get<
                        ConstructorParameters<typeof Channel>[0]
                    >(Routes.channel(channelId)),
                    this.#context,
                ),
            (channel) => this.#merge(channel),
        );
    }
    public async resolve(channelId: string): Promise<Channel> {
        return this.get(channelId) ?? this.fetch(channelId);
    }
    public upsert(data: ConstructorParameters<typeof Channel>[0]): Channel {
        return this.#merge(createChannel(data, this.#context));
    }
    /** Merges into the cached instance; a type change (e.g. text -> announcement) needs the new subclass. */
    #merge(channel: Channel): Channel {
        const existing = this.get(channel.id);
        if (existing && existing.type === channel.type) {
            Object.assign(existing, channel);
            return existing;
        }
        this.set(channel.id, channel);
        return channel;
    }
    public update(channel: Channel): this {
        return this.set(channel.id, channel);
    }
    /** Removes every cached channel that belongs to a guild. @returns Number removed. */
    public deleteGuildChannels(guildId: string): number {
        let removed = 0;
        for (const channel of this.values())
            if (channel.guildId === guildId && this.delete(channel.id))
                removed++;
        return removed;
    }
    /** Ends a poll now; returns the updated message. */
    public async endPoll(
        channelId: string,
        messageId: string,
    ): Promise<Message> {
        return this.messages(channelId).upsert(
            await this.#rest.post<ConstructorParameters<typeof Message>[0]>(
                Routes.pollExpire(channelId, messageId),
            ),
        );
    }
    /** Fetches users who voted for one poll answer. @param options.limit 1-100 (default 25). */
    public async fetchPollVoters(
        channelId: string,
        messageId: string,
        answerId: number,
        options: { after?: string; limit?: number } = {},
    ): Promise<User[]> {
        if (
            options.limit !== undefined &&
            (!Number.isInteger(options.limit) ||
                options.limit < 1 ||
                options.limit > 100)
        )
            throw new RangeError("Poll voter limit must be 1-100.");
        const params = new URLSearchParams();
        if (options.after) params.set("after", options.after);
        if (options.limit !== undefined)
            params.set("limit", String(options.limit));
        const suffix = params.toString();
        const { users } = await this.#rest.get<{
            users: ConstructorParameters<typeof User>[0][];
        }>(
            `${Routes.pollAnswerVoters(channelId, messageId, answerId)}${suffix ? `?${suffix}` : ""}`,
        );
        return users.map((user) => new User(user));
    }
    /** Plays a soundboard sound in a voice channel the bot is connected to. */
    public async sendSoundboardSound(
        channelId: string,
        options: { soundId: string; sourceGuildId?: string },
    ): Promise<void> {
        await this.#rest.post(Routes.sendSoundboardSound(channelId), {
            sound_id: options.soundId,
            source_guild_id: options.sourceGuildId,
        });
    }
    /** Returns the message manager for a channel only if one already exists. */
    public cachedMessages(channelId: string): MessageManager | undefined {
        return this.#messageManagers.get(channelId);
    }
    public async create(
        guildId: string,
        options: ChannelCreateOptions,
    ): Promise<Channel> {
        const [payload, reason] = splitReason(options);
        return this.upsert(
            await this.#rest.post<ConstructorParameters<typeof Channel>[0]>(
                Routes.guildChannels(guildId),
                payload,
                { reason },
            ),
        );
    }
    public async edit(
        channelId: string,
        options: ChannelEditOptions,
    ): Promise<Channel> {
        const [payload, reason] = splitReason(options);
        return this.upsert(
            await this.#rest.patch<ConstructorParameters<typeof Channel>[0]>(
                Routes.channel(channelId),
                payload,
                { reason },
            ),
        );
    }

    /** Deletes a channel (or closes a DM). @param reason Audit-log reason. */
    public async remove(channelId: string, reason?: string): Promise<void> {
        await this.#rest.delete(Routes.channel(channelId), { reason });
        this.delete(channelId);
    }
    /** @deprecated Use {@link ChannelManager.remove}, which also takes an audit-log reason. Removed in 0.3.0. */
    public deleteChannel(channelId: string): Promise<void> {
        return this.remove(channelId);
    }
    /** Evicts a channel, dropping its per-channel message manager with it.
     * Overrides {@link Manager.delete} so cache eviction driven by a Gateway
     * `CHANNEL_DELETE`/`THREAD_DELETE` — which calls `delete` rather than
     * {@link remove} — releases the message manager and its cached
     * messages too, instead of retaining them for the client's lifetime. */
    public override delete(channelId: string): boolean {
        this.#messageManagers.delete(channelId);
        return super.delete(channelId);
    }
    public send(
        channelId: string,
        options: MessageCreateOptions,
    ): Promise<Message> {
        return this.messages(channelId).send(options);
    }
    /** @deprecated Use {@link ChannelManager.send}. Removed in 0.3.0. */
    public sendMessage(
        channelId: string,
        options: MessageCreateOptions,
    ): Promise<Message> {
        return this.send(channelId, options);
    }
    public async fetchMessage(
        channelId: string,
        messageId: string,
        options: MessageFetchOptions = {},
    ): Promise<Message> {
        void options;
        return this.messages(channelId).fetch(messageId);
    }
    public fetchMessages(
        channelId: string,
        query: MessageQueryOptions | Iterable<string>,
    ): Promise<Message[]> {
        if (isMessageQuery(query)) {
            const params = new URLSearchParams();
            if (query.before) params.set("before", query.before);
            if (query.after) params.set("after", query.after);
            if (query.around) params.set("around", query.around);
            if (query.limit !== undefined)
                params.set("limit", String(query.limit));
            const suffix = params.toString();
            return this.#rest
                .get<ConstructorParameters<typeof Message>[0][]>(
                    `${Routes.channelMessages(channelId)}${suffix ? `?${suffix}` : ""}`,
                )
                .then((data) =>
                    data.map((item) => this.messages(channelId).upsert(item)),
                );
        }
        return this.messages(channelId).fetchMany(query);
    }
    public upsertMessage(
        data: ConstructorParameters<typeof Message>[0],
    ): Message {
        return this.messages(data.channel_id).upsert(data);
    }
    public async editMessage(
        channelId: string,
        messageId: string,
        options: MessageEditOptions,
    ): Promise<Message> {
        return this.messages(channelId).upsert(
            await this.#rest.patch<ConstructorParameters<typeof Message>[0]>(
                Routes.message(channelId, messageId),
                toRequest(options, this.#allowedMentions),
            ),
        );
    }
    /** Deletes a message. @param reason Audit-log reason (shown when deleting someone else's message). */
    public async deleteMessage(
        channelId: string,
        messageId: string,
        reason?: string,
    ): Promise<void> {
        await this.#rest.delete(Routes.message(channelId, messageId), {
            reason,
        });
        this.messages(channelId).delete(messageId);
    }
    public deleteCachedMessage(channelId: string, messageId: string): boolean {
        return this.messages(channelId).delete(messageId);
    }
    public async crosspostMessage(
        channelId: string,
        messageId: string,
    ): Promise<Message> {
        return this.messages(channelId).upsert(
            await this.#rest.post<ConstructorParameters<typeof Message>[0]>(
                Routes.crosspostMessage(channelId, messageId),
            ),
        );
    }
    /** Bulk-deletes messages in a channel. Duplicate IDs are ignored and a
     * single ID falls back to a normal delete.
     * @throws {RangeError} If no IDs or more than 100 are provided, or any
     * message is older than 14 days (Discord refuses to bulk-delete those). */
    public async bulkDeleteMessages(
        channelId: string,
        messageIds: Iterable<string>,
        reason?: string,
    ): Promise<void> {
        const ids = [...new Set(messageIds)];
        if (ids.length < 1 || ids.length > 100)
            throw new RangeError(
                "bulkDelete requires between 1 and 100 message IDs.",
            );
        if (ids.length === 1)
            return this.deleteMessage(channelId, ids[0]!, reason);
        const cutoff = Date.now() - BULK_DELETE_MAX_AGE_MS;
        const tooOld = ids.filter((id) => snowflakeTime(id) < cutoff);
        if (tooOld.length)
            throw new RangeError(
                `bulkDelete cannot delete messages older than 14 days: ${tooOld.join(", ")}`,
            );
        await this.#rest.post(
            Routes.channelBulkDelete(channelId),
            { messages: ids },
            { reason },
        );
        for (const id of ids) this.messages(channelId).delete(id);
    }
    /**
     * Iterates a channel's history newest-first, 100 messages per request,
     * starting before `before` (or the latest message) and stopping after
     * `limit` messages or at the start of the channel.
     */
    public async *iterateMessages(
        channelId: string,
        options: { before?: string; limit?: number } = {},
    ): AsyncGenerator<Message, void, undefined> {
        let before = options.before;
        let remaining = options.limit ?? Infinity;
        while (remaining > 0) {
            const page = await this.fetchMessages(channelId, {
                before,
                limit: Math.min(100, remaining),
            });
            for (const message of page) yield message;
            remaining -= page.length;
            if (page.length < 100) return;
            before = page.at(-1)!.id;
        }
    }
    public async addReaction(
        channelId: string,
        messageId: string,
        emoji: string,
    ): Promise<void> {
        // Discord's create-reaction endpoint is
        // PUT .../reactions/{emoji}/@me — the bare .../reactions/{emoji} path
        // is not a valid target for PUT.
        await this.#rest.put(
            `${Routes.messageReactions(channelId, messageId, emoji)}/@me`,
        );
    }
    public async fetchReactions(
        channelId: string,
        messageId: string,
        emoji: string,
        options: ReactionFetchOptions = {},
    ): Promise<User[]> {
        const params = new URLSearchParams();
        if (options.limit !== undefined)
            params.set("limit", String(options.limit));
        if (options.after) params.set("after", options.after);
        const suffix = params.toString();
        const data = await this.#rest.get<
            ConstructorParameters<typeof User>[0][]
        >(
            `${Routes.messageReactions(channelId, messageId, emoji)}${suffix ? `?${suffix}` : ""}`,
        );
        return data.map((user) => new User(user));
    }
    public async removeOwnReaction(
        channelId: string,
        messageId: string,
        emoji: string,
    ): Promise<void> {
        await this.#rest.delete(
            `${Routes.messageReactions(channelId, messageId, emoji)}/@me`,
        );
    }
    public async removeReaction(
        channelId: string,
        messageId: string,
        emoji: string,
        userId: string,
    ): Promise<void> {
        await this.#rest.delete(
            `${Routes.messageReactions(channelId, messageId, emoji)}/${userId}`,
        );
    }
    public async removeAllReactions(
        channelId: string,
        messageId: string,
    ): Promise<void> {
        await this.#rest.delete(
            Routes.messageReactionsAll(channelId, messageId),
        );
    }
    /** Fetches the newest pinned messages (one page, up to 50, like the endpoint it replaces). */
    public async fetchPinnedMessages(channelId: string): Promise<Message[]> {
        const data = await this.#rest.get<{
            items: { message: ConstructorParameters<typeof Message>[0] }[];
        }>(Routes.channelMessagesPins(channelId));
        return data.items.map((item) =>
            this.messages(channelId).upsert(item.message),
        );
    }
    /** Pins a message. @param reason Audit-log reason. */
    public async pinMessage(
        channelId: string,
        messageId: string,
        reason?: string,
    ): Promise<void> {
        await this.#rest.put(
            Routes.channelMessagesPin(channelId, messageId),
            undefined,
            { reason },
        );
    }
    /** Unpins a message. @param reason Audit-log reason. */
    public async unpinMessage(
        channelId: string,
        messageId: string,
        reason?: string,
    ): Promise<void> {
        await this.#rest.delete(
            Routes.channelMessagesPin(channelId, messageId),
            { reason },
        );
    }
    /** Creates a webhook in a channel. @param options Name, optional avatar data URI, and audit-log `reason`. */
    public async createWebhook(
        channelId: string,
        options: { name: string; avatar?: string | null; reason?: string },
    ): Promise<import("@lunibee/types").APIWebhook> {
        const [payload, reason] = splitReason(options);
        return this.#rest.post(Routes.channelWebhooks(channelId), payload, {
            reason,
        });
    }
    public createThreadFromMessage(
        channelId: string,
        messageId: string,
        options: MessageThreadOptions,
    ): Promise<Channel> {
        return this.threads(channelId).createFromMessage(messageId, options);
    }
    /**
     * Fetches a page of messages with cursor metadata.
     * @param channelId Channel to fetch from.
     * @param options Page options — `before`, `after`, `around`, and `limit` (max 100).
     * @returns `{ messages, before, after, hasMore }` — use `before` or `after` as cursors for the next page.
     */
    public async fetchPage(
        channelId: string,
        options: MessageQueryOptions = {},
    ): Promise<{
        messages: Message[];
        before?: string;
        after?: string;
        hasMore: boolean;
    }> {
        const limit = Math.min(100, Math.max(1, options.limit ?? 50));
        const messages = await this.fetchMessages(channelId, {
            ...options,
            limit,
        });
        return {
            messages,
            before: messages[0]?.id,
            after: messages[messages.length - 1]?.id,
            hasMore: messages.length === limit,
        };
    }
    /** @deprecated Use {@link ChannelManager.bulkDeleteMessages}, which also takes an audit-log reason. Removed in 0.3.0. */
    public bulkDelete(channelId: string, messageIds: string[]): Promise<void> {
        return this.bulkDeleteMessages(channelId, messageIds);
    }
    public override clear(): void {
        this.#messageManagers.clear();
        super.clear();
    }
}

function isMessageQuery(
    value: MessageQueryOptions | Iterable<string>,
): value is MessageQueryOptions {
    return (
        typeof value === "object" &&
        value !== null &&
        !(Symbol.iterator in value)
    );
}
export type CreateMessageOptions = MessageCreateOptions;
export {
    MessageManager,
    toRequest,
    type MessageCacheOptions,
    type MessageFile,
} from "./message.js";
export { ThreadManager } from "./thread.js";
export {
    RoleManager,
    type RoleCreateOptions,
    type RoleEditOptions,
} from "./role.js";
export {
    GuildMemberManager,
    type MemberEditOptions,
    type BanOptions,
} from "./member.js";
export { ApplicationCommandManager } from "./application.js";
export {
    GuildBanManager,
    GuildScheduledEventManager,
    StageInstanceManager,
    PermissionOverwriteManager,
    type APIBan,
    type GuildBanCreateOptions,
    type GuildScheduledEventOptions,
    type StageInstanceCreateOptions,
    type PermissionOverwriteOptions,
    type PermissionOverwriteTargetType,
    type PermissionOverwriteUpdate,
} from "./guild-resources.js";
export {
    EmojiManager,
    type EmojiCreateOptions,
    type EmojiEditOptions,
} from "./emoji.js";
export {
    GuildStickerManager,
    GuildSoundboardManager,
    MonetizationManager,
    type APIEntitlement,
    type APISKU,
    type APISoundboardSound,
    type APISubscription,
    type EntitlementQuery,
    type GuildStickerCreateOptions,
    type SoundboardSoundCreateOptions,
} from "./advanced.js";
