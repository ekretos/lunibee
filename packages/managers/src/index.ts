import { Manager, ResourceManager } from "./base.js";
export { Manager, ResourceManager } from "./base.js";
import { Collection } from "@lunibee/collection";
import { REST, Routes } from "@lunibee/rest";
import {
    Channel,
    Message,
    User,
    Guild,
    type ResourceContext,
} from "@lunibee/structures";
import {
    MessageManager,
    type MessageCreateOptions as ManagerMessageCreateOptions,
} from "./message.js";
import { ThreadManager } from "./thread.js";

export { UserManager } from "./user.js";
export { GuildManager } from "./guild.js";
export type { AuditLogEntry, AuditLogResponse } from "./guild.js";
export { AuditLogEvent } from "./guild.js";

export type MessageCreateOptions = ManagerMessageCreateOptions;
export type MessageEditOptions = Record<string, unknown> & { content?: string };
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
    name: string;
    type: number;
    guild_id?: string;
    parent_id?: string | null;
}
export type ChannelEditOptions = Record<string, unknown>;

export class ChannelManager extends Manager<string, Channel> {
    readonly #rest: REST;
    readonly #context: ResourceContext;
    readonly #messageManagers = new Map<string, MessageManager>();
    public constructor(rest: REST) {
        super();
        this.#rest = rest;
        this.#context = {
            sendMessage: (channelId, options) => this.send(channelId, options),
            editMessage: (channelId, messageId, options) =>
                this.editMessage(channelId, messageId, options),
            deleteMessage: (channelId, messageId) =>
                this.deleteMessage(channelId, messageId),
            crosspostMessage: (channelId, messageId) =>
                this.crosspostMessage(channelId, messageId),
            editChannel: (channelId, options) => this.edit(channelId, options),
            deleteChannel: (channelId) => this.deleteChannel(channelId),
            addReaction: (channelId, messageId, emoji) =>
                this.addReaction(channelId, messageId, emoji),
            removeOwnReaction: (channelId, messageId, emoji) =>
                this.removeOwnReaction(channelId, messageId, emoji),
            removeReaction: (channelId, messageId, emoji, userId) =>
                this.removeReaction(channelId, messageId, emoji, userId),
            removeAllReactions: (channelId, messageId) =>
                this.removeAllReactions(channelId, messageId),
            pinMessage: (channelId, messageId) =>
                this.pinMessage(channelId, messageId),
            unpinMessage: (channelId, messageId) =>
                this.unpinMessage(channelId, messageId),
        };
    }
    public messages(channelId: string): MessageManager {
        let manager = this.#messageManagers.get(channelId);
        if (!manager) {
            manager = new MessageManager(this.#rest, this.#context, channelId);
            this.#messageManagers.set(channelId, manager);
        }
        return manager;
    }
    public threads(channelId: string): ThreadManager {
        return new ThreadManager(this.#rest, this.#context, channelId);
    }
    public async fetch(channelId: string): Promise<Channel> {
        return this.upsert(
            await this.#rest.get<ConstructorParameters<typeof Channel>[0]>(
                Routes.channel(channelId),
            ),
        );
    }
    public async resolve(channelId: string): Promise<Channel> {
        return this.get(channelId) ?? this.fetch(channelId);
    }
    public upsert(data: ConstructorParameters<typeof Channel>[0]): Channel {
        const existing = this.get(data.id);
        const channel = new Channel(data, this.#context);
        if (existing) {
            Object.assign(existing, channel);
            return existing;
        }
        this.set(channel.id, channel);
        return channel;
    }
    public update(channel: Channel): this {
        return this.set(channel.id, channel);
    }
    public async create(
        guildId: string,
        options: ChannelCreateOptions,
    ): Promise<Channel> {
        return this.upsert(
            await this.#rest.post<ConstructorParameters<typeof Channel>[0]>(
                Routes.guildChannels(guildId),
                options,
            ),
        );
    }
    public async edit(
        channelId: string,
        options: ChannelEditOptions,
    ): Promise<Channel> {
        return this.upsert(
            await this.#rest.patch<ConstructorParameters<typeof Channel>[0]>(
                Routes.channel(channelId),
                options,
            ),
        );
    }

    public async deleteChannel(channelId: string): Promise<void> {
        await this.#rest.delete(Routes.channel(channelId));
        this.#messageManagers.delete(channelId);
        super.delete(channelId);
    }
    public send(
        channelId: string,
        options: MessageCreateOptions,
    ): Promise<Message> {
        return this.messages(channelId).send(options);
    }
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
                options,
            ),
        );
    }
    public async deleteMessage(
        channelId: string,
        messageId: string,
    ): Promise<void> {
        await this.#rest.delete(Routes.message(channelId, messageId));
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
    public async bulkDeleteMessages(
        channelId: string,
        messageIds: Iterable<string>,
    ): Promise<void> {
        const ids = [...messageIds];
        await this.#rest.post(Routes.channelBulkDelete(channelId), {
            messages: ids,
        });
        for (const id of ids) this.messages(channelId).delete(id);
    }
    public async addReaction(
        channelId: string,
        messageId: string,
        emoji: string,
    ): Promise<void> {
        await this.#rest.put(
            Routes.messageReactions(channelId, messageId, emoji),
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
    public async fetchPinnedMessages(channelId: string): Promise<Message[]> {
        const data = await this.#rest.get<
            ConstructorParameters<typeof Message>[0][]
        >(Routes.channelPins(channelId));
        return data.map((item) => this.messages(channelId).upsert(item));
    }
    public async pinMessage(
        channelId: string,
        messageId: string,
    ): Promise<void> {
        await this.#rest.put(Routes.channelPin(channelId, messageId));
    }
    public async unpinMessage(
        channelId: string,
        messageId: string,
    ): Promise<void> {
        await this.#rest.delete(Routes.channelPin(channelId, messageId));
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
    /**
     * Bulk-deletes 2–100 messages from a channel.
     * Only messages younger than 14 days are accepted by Discord.
     * @param channelId Channel to delete from.
     * @param messageIds Array of message IDs to delete.
     * @throws {RangeError} If fewer than 2 or more than 100 IDs are provided.
     */
    public async bulkDelete(
        channelId: string,
        messageIds: string[],
    ): Promise<void> {
        if (messageIds.length < 2 || messageIds.length > 100)
            throw new RangeError(
                "bulkDelete requires between 2 and 100 message IDs.",
            );
        return this.bulkDeleteMessages(channelId, messageIds);
    }
    public delete(channelId: string): boolean {
        this.#messageManagers.delete(channelId);
        return super.delete(channelId);
    }
    public clear(): void {
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
export { MessageManager } from "./message.js";
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
export { EmojiManager, type EmojiCreateOptions, type EmojiEditOptions } from "./emoji.js";
