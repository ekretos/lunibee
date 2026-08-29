import { Collection } from "@lunibee/collection";
import { REST, Routes } from "@lunibee/rest";
import { Channel, Message, User, type ResourceContext } from "@lunibee/structures";

/** A cache manager for Lunibee resources. */
export class Manager<K, V> {
    /** Cached resources. */ public readonly cache = new Collection<K, V>();
    /** Returns a cached resource. */ public get(id: K): V | undefined { return this.cache.get(id); }
    /** Returns whether a resource is cached. */ public has(id: K): boolean { return this.cache.has(id); }
    /** Adds or replaces a resource in the cache. */ public set(id: K, value: V): this { this.cache.set(id, value); return this; }
    /** Removes a resource from the cache. */ public delete(id: K): boolean { return this.cache.delete(id); }
    /** Removes all cached resources. */ public clear(): void { this.cache.clear(); }
    /** Number of cached resources. */ public get size(): number { return this.cache.size; }
    /** Returns the first cached resource. */ public first(): V | undefined { return this.cache.first(); }
    /** Returns all cached resources. */ public values(): V[] { return this.cache.array(); }
    /** Finds the first cached resource matching a predicate. */ public find(predicate: (value: V, key: K) => boolean): V | undefined { return this.cache.find(predicate); }
    /** Iterates cached resources. */ public [Symbol.iterator](): IterableIterator<[K, V]> { return this.cache[Symbol.iterator](); }
}

/** REST-backed manager that keeps fetched resources synchronized with its local cache. */
export class ResourceManager<K, V> extends Manager<K, V> {
    readonly #fetch: (id: K) => Promise<V>; readonly #key: (value: V) => K;
    public constructor(fetch: (id: K) => Promise<V>, key: (value: V) => K) { super(); this.#fetch = fetch; this.#key = key; }
    public async resolve(id: K): Promise<V> { const cached = this.get(id); return cached !== undefined ? cached : this.fetch(id); }
    public async fetch(id: K): Promise<V> { const value = await this.#fetch(id); this.set(this.#key(value), value); return value; }
    public async fetchMany(ids: Iterable<K>): Promise<V[]> { return Promise.all([...ids].map(id => this.fetch(id))); }
}

/** Payload accepted by Discord's Create Message endpoint. */
export interface MessageCreateOptions { /** Message text. */ content?: string; }
/** Payload accepted by Discord's Edit Message endpoint. */
export interface MessageEditOptions { /** Replacement message text. */ content?: string; }
/** Query parameters accepted by Discord's Get Channel Messages endpoint. */
export interface MessageFetchOptions { before?: string; after?: string; around?: string; limit?: number; }
/** Options for creating a thread from an existing message. */
export interface MessageThreadOptions { name: string; autoArchiveDuration?: 60 | 1440 | 4320 | 10080; rateLimitPerUser?: number; }
/** Options for retrieving users who reacted to a message. */
export interface ReactionFetchOptions { after?: string; limit?: number; }

/** High-level REST-backed channel and message manager. */
export class ChannelManager extends Manager<string, Channel> {
    readonly #rest: REST;
    readonly #context: ResourceContext;

    /** Creates a channel manager backed by the client's REST transport. */
    public constructor(rest: REST) {
        super();
        this.#rest = rest;
        this.#context = {
            sendMessage: (channelId, options) => this.send(channelId, options),
            editMessage: (channelId, messageId, options) => this.editMessage(channelId, messageId, options),
            deleteMessage: (channelId, messageId) => this.deleteMessage(channelId, messageId),
            crosspostMessage: (channelId, messageId) => this.crosspostMessage(channelId, messageId),
        };
    }

    /** Sends a message. @see https://discord.com/developers/docs/resources/message#create-message */
    public async send(channelId: string, options: MessageCreateOptions): Promise<Message> {
        const data = await this.#rest.post<ConstructorParameters<typeof Message>[0]>(Routes.channelMessages(channelId), options);
        return new Message(data, this.#context);
    }
    /** @deprecated Use send(). */
    public sendMessage(channelId: string, options: MessageCreateOptions): Promise<Message> { return this.send(channelId, options); }
    /** Fetches messages. @see https://discord.com/developers/docs/resources/message#get-channel-messages */
    public async fetchMessages(channelId: string, options: MessageFetchOptions = {}): Promise<Message[]> {
        const query = new URLSearchParams();
        if (options.before !== undefined) query.set("before", options.before); if (options.after !== undefined) query.set("after", options.after); if (options.around !== undefined) query.set("around", options.around); if (options.limit !== undefined) query.set("limit", String(options.limit));
        const data = await this.#rest.get<ConstructorParameters<typeof Message>[0][]>(`${Routes.channelMessages(channelId)}${query.size ? `?${query}` : ""}`);
        return data.map(message => new Message(message, this.#context));
    }
    /** Fetches a message. @see https://discord.com/developers/docs/resources/message#get-channel-message */
    public async fetchMessage(channelId: string, messageId: string): Promise<Message> { const data = await this.#rest.get<ConstructorParameters<typeof Message>[0]>(Routes.message(channelId, messageId)); return new Message(data, this.#context); }
    /** Edits a message. @see https://discord.com/developers/docs/resources/message#edit-message */
    public async editMessage(channelId: string, messageId: string, options: MessageEditOptions): Promise<Message> { const data = await this.#rest.patch<ConstructorParameters<typeof Message>[0]>(Routes.message(channelId, messageId), options); return new Message(data, this.#context); }
    /** Deletes a message. @see https://discord.com/developers/docs/resources/message#delete-message */
    public async deleteMessage(channelId: string, messageId: string): Promise<void> { await this.#rest.delete(Routes.message(channelId, messageId)); }
    /** Crossposts a message. @see https://discord.com/developers/docs/resources/message#crosspost-message */
    public async crosspostMessage(channelId: string, messageId: string): Promise<Message> { const data = await this.#rest.post<ConstructorParameters<typeof Message>[0]>(Routes.crosspostMessage(channelId, messageId)); return new Message(data, this.#context); }
    /** Bulk deletes messages. @see https://discord.com/developers/docs/resources/message#bulk-delete-messages */
    public async bulkDeleteMessages(channelId: string, messageIds: Iterable<string>): Promise<void> { await this.#rest.post(Routes.channelBulkDelete(channelId), { messages: [...messageIds] }); }
    /** Adds a reaction. @see https://discord.com/developers/docs/resources/message#create-reaction */
    public async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> { await this.#rest.put(Routes.messageReactions(channelId, messageId, emoji)); }
    /** Removes the current bot user's reaction. @see https://discord.com/developers/docs/resources/message#delete-own-reaction */
    public async removeOwnReaction(channelId: string, messageId: string, emoji: string): Promise<void> { await this.#rest.delete(`${Routes.messageReactions(channelId, messageId, emoji)}/@me`); }
    /** Removes a specific user's reaction. @see https://discord.com/developers/docs/resources/message#delete-user-reaction */
    public async removeReaction(channelId: string, messageId: string, emoji: string, userId: string): Promise<void> { await this.#rest.delete(`${Routes.messageReactions(channelId, messageId, emoji)}/${userId}`); }
    /** Gets users who reacted. @see https://discord.com/developers/docs/resources/message#get-reactions */
    public async fetchReactions(channelId: string, messageId: string, emoji: string, options: ReactionFetchOptions = {}): Promise<User[]> { const query = new URLSearchParams(); if (options.after !== undefined) query.set("after", options.after); if (options.limit !== undefined) query.set("limit", String(options.limit)); const data = await this.#rest.get<ConstructorParameters<typeof User>[0][]>(`${Routes.messageReactions(channelId, messageId, emoji)}${query.size ? `?${query}` : ""}`); return data.map(user => new User(user)); }
    /** Removes all reactions. @see https://discord.com/developers/docs/resources/message#delete-all-reactions */
    public async removeAllReactions(channelId: string, messageId: string): Promise<void> { await this.#rest.delete(Routes.messageReactionsAll(channelId, messageId)); }
    /** Gets pinned messages. @see https://discord.com/developers/docs/resources/channel#get-pinned-messages */
    public async fetchPinnedMessages(channelId: string): Promise<Message[]> { const data = await this.#rest.get<ConstructorParameters<typeof Message>[0][]>(Routes.channelPins(channelId)); return data.map(message => new Message(message, this.#context)); }
    /** Pins a message. @see https://discord.com/developers/docs/resources/channel#pin-message */
    public async pinMessage(channelId: string, messageId: string): Promise<void> { await this.#rest.put(Routes.channelPin(channelId, messageId)); }
    /** Unpins a message. @see https://discord.com/developers/docs/resources/channel#unpin-message */
    public async unpinMessage(channelId: string, messageId: string): Promise<void> { await this.#rest.delete(Routes.channelPin(channelId, messageId)); }
    /** Creates a thread from a message. @see https://discord.com/developers/docs/resources/channel#start-thread-with-message */
    public async createThreadFromMessage(channelId: string, messageId: string, options: MessageThreadOptions): Promise<Channel> { const data = await this.#rest.post<ConstructorParameters<typeof Channel>[0]>(Routes.messageThread(channelId, messageId), { name: options.name, auto_archive_duration: options.autoArchiveDuration, rate_limit_per_user: options.rateLimitPerUser }); return new Channel(data, this.#context); }
}

export type { MessageCreateOptions as CreateMessageOptions };
