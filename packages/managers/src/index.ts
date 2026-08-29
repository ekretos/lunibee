import { Collection } from "@lunibee/collection";
import { REST, Routes } from "@lunibee/rest";
import { Channel, Message, User, Guild, type ResourceContext } from "@lunibee/structures";

/** Stores Discord resources by stable identifier. */
export class Manager<K, V> {
    /** Cached resources. */
    public readonly cache = new Collection<K, V>();
    /** Returns a cached resource. @param id Resource identifier. @returns Cached resource or undefined. */
    public get(id: K): V | undefined { return this.cache.get(id); }
    /** Checks whether an identifier is cached. @param id Resource identifier. @returns True when cached. */
    public has(id: K): boolean { return this.cache.has(id); }
    /** Inserts or replaces a resource. @param id Resource identifier. @param value Resource instance. @returns This manager. */
    public set(id: K, value: V): this { this.cache.set(id, value); return this; }
    /** Removes a resource. @param id Resource identifier. @returns True when removed. */
    public delete(id: K): boolean { return this.cache.delete(id); }
    /** Clears the cache. @returns Nothing. */
    public clear(): void { this.cache.clear(); }
    /** Gets cache size. @returns Number of cached resources. */
    public get size(): number { return this.cache.size; }
    /** Returns the first cached resource. @returns First resource or undefined. */
    public first(): V | undefined { return this.cache.first(); }
    /** Returns a snapshot of cached resources. @returns Cached resources. */
    public values(): V[] { return this.cache.array(); }
    /** Finds a cached resource. @param predicate Matching predicate. @returns Matching resource or undefined. */
    public find(predicate: (value: V, key: K) => boolean): V | undefined { return this.cache.find(predicate); }
    /** Iterates over cached resources. @returns Resource entries iterator. */
    public [Symbol.iterator](): IterableIterator<[K, V]> { return this.cache[Symbol.iterator](); }
}

/** Provides a consistent cache-first lifecycle for REST-backed resources. */
export class ResourceManager<K, V> extends Manager<K, V> {
    readonly #fetcher: (id: K) => Promise<V>;
    readonly #key: (value: V) => K;
    /** Creates a resource manager. @param fetcher REST/resource fetcher. @param key Cache-key extractor. @throws {TypeError} If callbacks are not functions. */
    public constructor(fetcher: (id: K) => Promise<V>, key: (value: V) => K) { super(); if (typeof fetcher !== "function" || typeof key !== "function") throw new TypeError("ResourceManager requires fetcher and key functions."); this.#fetcher = fetcher; this.#key = key; }
    /** Resolves from cache or fetches from REST. @param id Resource identifier. @returns Cached or fetched resource. */
    public async resolve(id: K): Promise<V> { return this.get(id) ?? this.fetch(id); }
    /** Fetches and caches a resource. @param id Resource identifier. @returns Fetched resource. @throws {Error} If the fetch operation fails. */
    public async fetch(id: K): Promise<V> { const value = await this.#fetcher(id); this.update(value); return value; }
    /** Fetches several resources. @param ids Resource identifiers. @returns Resources in input order. @throws {Error} If any fetch fails. */
    public async fetchMany(ids: Iterable<K>): Promise<V[]> { return Promise.all([...ids].map(id => this.fetch(id))); }
    /** Inserts or replaces a resource using its intrinsic identifier. @param value Resource instance. @returns This manager. */
    public update(value: V): this { this.set(this.#key(value), value); return this; }
}

/** Manages users with cache and REST synchronization. */
export class UserManager extends ResourceManager<string, User> {
    /** Creates a user manager. @param rest REST transport. */
    public constructor(rest: REST) { super(async id => new User(await rest.get<ConstructorParameters<typeof User>[0]>(Routes.userById(id))), user => user.id); }
}

/** Manages guilds with cache and REST synchronization. */
export class GuildManager extends ResourceManager<string, Guild> {
    /** Creates a guild manager. @param rest REST transport. */
    public constructor(rest: REST) { super(async id => new Guild(await rest.get<ConstructorParameters<typeof Guild>[0]>(Routes.guild(id))), guild => guild.id); }
}

/** Payload accepted by Discord's Create Message endpoint. */
export interface MessageCreateOptions { /** Message content. */ content?: string; }
/** Payload accepted by Discord's Edit Message endpoint. */
export interface MessageEditOptions { /** Replacement message content. */ content?: string; }
/** Query parameters accepted by Discord's Get Channel Messages endpoint. */
export interface MessageFetchOptions { /** Messages before this ID. */ before?: string; /** Messages after this ID. */ after?: string; /** Messages around this ID. */ around?: string; /** Maximum number of messages. */ limit?: number; }
/** Options for creating a thread from a message. */
export interface MessageThreadOptions { /** Thread name. */ name: string; /** Auto-archive duration. */ autoArchiveDuration?: 60 | 1440 | 4320 | 10080; /** Per-user slowmode in seconds. */ rateLimitPerUser?: number; }
/** Options for retrieving message reactions. */
export interface ReactionFetchOptions { /** Users after this ID. */ after?: string; /** Maximum users. */ limit?: number; }

/** Manages channels and message operations through the shared REST transport. */
export class ChannelManager extends Manager<string, Channel> {
    readonly #rest: REST;
    readonly #context: ResourceContext;
    /** Creates a channel manager. @param rest REST transport. */
    public constructor(rest: REST) { super(); this.#rest = rest; this.#context = { sendMessage: (channelId, options) => this.send(channelId, options), editMessage: (channelId, messageId, options) => this.editMessage(channelId, messageId, options), deleteMessage: (channelId, messageId) => this.deleteMessage(channelId, messageId), crosspostMessage: (channelId, messageId) => this.crosspostMessage(channelId, messageId) }; }
    /** Fetches a channel and updates its cache. @param channelId Channel identifier. @returns Hydrated channel. @throws {Error} If REST rejects the request. */
    public async fetch(channelId: string): Promise<Channel> { const data = await this.#rest.get<ConstructorParameters<typeof Channel>[0]>(Routes.channel(channelId)); const channel = new Channel(data, this.#context); this.update(channel); return channel; }
    /** Resolves a channel from cache or REST. @param channelId Channel identifier. @returns Cached or fetched channel. @throws {Error} If REST rejects the request. */
    public async resolve(channelId: string): Promise<Channel> { return this.get(channelId) ?? this.fetch(channelId); }
    /** Inserts a channel into cache with its existing context. @param channel Channel resource. @returns This manager. */
    public update(channel: Channel): this { return this.set(channel.id, channel); }
    /** Sends a message. @param channelId Channel identifier. @param options Message payload. @returns Created message. @throws {Error} If REST rejects the request. */
    public async send(channelId: string, options: MessageCreateOptions): Promise<Message> { const data = await this.#rest.post<ConstructorParameters<typeof Message>[0]>(Routes.channelMessages(channelId), options); return new Message(data, this.#context); }
    /** Sends a message using the legacy name. @param channelId Channel identifier. @param options Message payload. @returns Created message. */
    public sendMessage(channelId: string, options: MessageCreateOptions): Promise<Message> { return this.send(channelId, options); }
    /** Fetches messages in a channel. @param channelId Channel identifier. @param options Message query. @returns Hydrated messages. @throws {Error} If REST rejects the request. */
    public async fetchMessages(channelId: string, options: MessageFetchOptions = {}): Promise<Message[]> { const query = new URLSearchParams(); for (const key of ["before", "after", "around"] as const) if (options[key] !== undefined) query.set(key, options[key]!); if (options.limit !== undefined) query.set("limit", String(options.limit)); const suffix = query.size ? `?${query}` : ""; const data = await this.#rest.get<ConstructorParameters<typeof Message>[0][]>(`${Routes.channelMessages(channelId)}${suffix}`); return data.map(item => new Message(item, this.#context)); }
    /** Fetches one message. @param channelId Channel identifier. @param messageId Message identifier. @returns Hydrated message. @throws {Error} If REST rejects the request. */
    public async fetchMessage(channelId: string, messageId: string): Promise<Message> { return new Message(await this.#rest.get<ConstructorParameters<typeof Message>[0]>(Routes.message(channelId, messageId)), this.#context); }
    /** Edits one message. @param channelId Channel identifier. @param messageId Message identifier. @param options Edit payload. @returns Updated message. @throws {Error} If REST rejects the request. */
    public async editMessage(channelId: string, messageId: string, options: MessageEditOptions): Promise<Message> { return new Message(await this.#rest.patch<ConstructorParameters<typeof Message>[0]>(Routes.message(channelId, messageId), options), this.#context); }
    /** Deletes one message. @param channelId Channel identifier. @param messageId Message identifier. @returns Nothing. @throws {Error} If REST rejects the request. */
    public async deleteMessage(channelId: string, messageId: string): Promise<void> { await this.#rest.delete(Routes.message(channelId, messageId)); }
    /** Crossposts one message. @param channelId Channel identifier. @param messageId Message identifier. @returns Crossposted message. @throws {Error} If REST rejects the request. */
    public async crosspostMessage(channelId: string, messageId: string): Promise<Message> { return new Message(await this.#rest.post<ConstructorParameters<typeof Message>[0]>(Routes.crosspostMessage(channelId, messageId)), this.#context); }
    /** Bulk deletes messages. @param channelId Channel identifier. @param messageIds Message identifiers. @returns Nothing. @throws {Error} If REST rejects the request. */
    public async bulkDeleteMessages(channelId: string, messageIds: Iterable<string>): Promise<void> { await this.#rest.post(Routes.channelBulkDelete(channelId), { messages: [...messageIds] }); }
    /** Adds a reaction. @param channelId Channel identifier. @param messageId Message identifier. @param emoji Emoji identifier. @returns Nothing. @throws {Error} If REST rejects the request. */
    public async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> { await this.#rest.put(Routes.messageReactions(channelId, messageId, emoji)); }
    /** Removes the current user's reaction. @param channelId Channel identifier. @param messageId Message identifier. @param emoji Emoji identifier. @returns Nothing. @throws {Error} If REST rejects the request. */
    public async removeOwnReaction(channelId: string, messageId: string, emoji: string): Promise<void> { await this.#rest.delete(`${Routes.messageReactions(channelId, messageId, emoji)}/@me`); }
    /** Removes a user's reaction. @param channelId Channel identifier. @param messageId Message identifier. @param emoji Emoji identifier. @param userId User identifier. @returns Nothing. @throws {Error} If REST rejects the request. */
    public async removeReaction(channelId: string, messageId: string, emoji: string, userId: string): Promise<void> { await this.#rest.delete(`${Routes.messageReactions(channelId, messageId, emoji)}/${userId}`); }
    /** Fetches users who reacted. @param channelId Channel identifier. @param messageId Message identifier. @param emoji Emoji identifier. @param options Reaction query. @returns Hydrated users. @throws {Error} If REST rejects the request. */
    public async fetchReactions(channelId: string, messageId: string, emoji: string, options: ReactionFetchOptions = {}): Promise<User[]> { const query = new URLSearchParams(); if (options.after !== undefined) query.set("after", options.after); if (options.limit !== undefined) query.set("limit", String(options.limit)); const suffix = query.size ? `?${query}` : ""; const data = await this.#rest.get<ConstructorParameters<typeof User>[0][]>(`${Routes.messageReactions(channelId, messageId, emoji)}${suffix}`); return data.map(item => new User(item)); }
    /** Removes all reactions. @param channelId Channel identifier. @param messageId Message identifier. @returns Nothing. @throws {Error} If REST rejects the request. */
    public async removeAllReactions(channelId: string, messageId: string): Promise<void> { await this.#rest.delete(Routes.messageReactionsAll(channelId, messageId)); }
    /** Fetches pinned messages. @param channelId Channel identifier. @returns Hydrated messages. @throws {Error} If REST rejects the request. */
    public async fetchPinnedMessages(channelId: string): Promise<Message[]> { const data = await this.#rest.get<ConstructorParameters<typeof Message>[0][]>(Routes.channelPins(channelId)); return data.map(item => new Message(item, this.#context)); }
    /** Pins a message. @param channelId Channel identifier. @param messageId Message identifier. @returns Nothing. @throws {Error} If REST rejects the request. */
    public async pinMessage(channelId: string, messageId: string): Promise<void> { await this.#rest.put(Routes.channelPin(channelId, messageId)); }
    /** Unpins a message. @param channelId Channel identifier. @param messageId Message identifier. @returns Nothing. @throws {Error} If REST rejects the request. */
    public async unpinMessage(channelId: string, messageId: string): Promise<void> { await this.#rest.delete(Routes.channelPin(channelId, messageId)); }
    /** Creates a thread from a message. @param channelId Channel identifier. @param messageId Message identifier. @param options Thread options. @returns Created thread channel. @throws {Error} If REST rejects the request. */
    public async createThreadFromMessage(channelId: string, messageId: string, options: MessageThreadOptions): Promise<Channel> { const data = await this.#rest.post<ConstructorParameters<typeof Channel>[0]>(Routes.messageThread(channelId, messageId), { name: options.name, auto_archive_duration: options.autoArchiveDuration, rate_limit_per_user: options.rateLimitPerUser }); const channel = new Channel(data, this.#context); this.update(channel); return channel; }
}

/** Backward-compatible alias for create-message options. */
export type CreateMessageOptions = MessageCreateOptions;
