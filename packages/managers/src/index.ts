import { Collection } from "@lunibee/collection";
import { REST, Routes } from "@lunibee/rest";
import { Channel, Message, User, Guild, type ResourceContext } from "@lunibee/structures";

/** Stores Discord resources by their stable identifier. */
export class Manager<K, V> {
    /** Cached resources. */
    public readonly cache = new Collection<K, V>();
    /** Returns a cached resource. @param id Resource identifier. @returns The cached resource, if present. */
    public get(id: K): V | undefined { return this.cache.get(id); }
    /** Checks whether a resource is cached. @param id Resource identifier. @returns True when cached. */
    public has(id: K): boolean { return this.cache.has(id); }
    /** Adds or replaces a cached resource. @param id Resource identifier. @param value Resource instance. @returns This manager. */
    public set(id: K, value: V): this { this.cache.set(id, value); return this; }
    /** Removes a cached resource. @param id Resource identifier. @returns True when removed. */
    public delete(id: K): boolean { return this.cache.delete(id); }
    /** Removes every cached resource. @returns Nothing. */
    public clear(): void { this.cache.clear(); }
    /** Gets the number of cached resources. @returns Cache size. */
    public get size(): number { return this.cache.size; }
    /** Gets the first cached resource. @returns The first resource, if any. */
    public first(): V | undefined { return this.cache.first(); }
    /** Gets all cached resources. @returns A snapshot of cached resources. */
    public values(): V[] { return this.cache.array(); }
    /** Finds the first matching cached resource. @param predicate Predicate to evaluate. @returns The matching resource, if any. */
    public find(predicate: (value: V, key: K) => boolean): V | undefined { return this.cache.find(predicate); }
    /** Iterates over cached resources. @returns An iterator of key/value pairs. */
    public [Symbol.iterator](): IterableIterator<[K, V]> { return this.cache[Symbol.iterator](); }
}

/** Provides consistent cache-first resolution for REST-backed resources. */
export class ResourceManager<K, V> extends Manager<K, V> {
    readonly #fetcher: (id: K) => Promise<V>;
    readonly #key: (value: V) => K;
    /** Creates a resource manager. @param fetcher Function used to retrieve a resource. @param key Function that extracts its cache key. @throws {TypeError} If either callback is not callable. */
    public constructor(fetcher: (id: K) => Promise<V>, key: (value: V) => K) { super(); if (typeof fetcher !== "function" || typeof key !== "function") throw new TypeError("ResourceManager requires fetcher and key functions."); this.#fetcher = fetcher; this.#key = key; }
    /** Resolves a resource from cache or REST. @param id Resource identifier. @returns The cached or fetched resource. */
    public async resolve(id: K): Promise<V> { const cached = this.get(id); return cached ?? this.fetch(id); }
    /** Fetches and replaces a resource in cache. @param id Resource identifier. @returns The fetched resource. */
    public async fetch(id: K): Promise<V> { const value = await this.#fetcher(id); this.set(this.#key(value), value); return value; }
    /** Fetches multiple resources and caches each result. @param ids Resource identifiers. @returns Fetched resources in input order. */
    public async fetchMany(ids: Iterable<K>): Promise<V[]> { return Promise.all([...ids].map(id => this.fetch(id))); }
    /** Updates a cached resource without changing its identity. @param value Resource instance. @returns This manager. */
    public update(value: V): this { this.set(this.#key(value), value); return this; }
}

/** Manages users with a consistent cache/fetch lifecycle. */
export class UserManager extends ResourceManager<string, User> {
    /** Creates a user manager backed by Discord REST. @param rest REST transport. */
    public constructor(rest: REST) { super(async id => new User(await rest.get<ConstructorParameters<typeof User>[0]>(Routes.userById(id))), user => user.id); }
}

/** Manages guilds with a consistent cache/fetch lifecycle. */
export class GuildManager extends ResourceManager<string, Guild> {
    /** Creates a guild manager backed by Discord REST. @param rest REST transport. */
    public constructor(rest: REST) { super(async id => new Guild(await rest.get<ConstructorParameters<typeof Guild>[0]>(Routes.guild(id))), guild => guild.id); }
}

/** Payload accepted by Discord's Create Message endpoint. */
export interface MessageCreateOptions { /** Message text. */ content?: string; }
/** Payload accepted by Discord's Edit Message endpoint. */
export interface MessageEditOptions { /** Replacement message text. */ content?: string; }
/** Query parameters accepted by Discord's Get Channel Messages endpoint. */
export interface MessageFetchOptions { /** Return messages before this ID. */ before?: string; /** Return messages after this ID. */ after?: string; /** Center results around this ID. */ around?: string; /** Maximum number of messages. */ limit?: number; }
/** Options for creating a thread from an existing message. */
export interface MessageThreadOptions { /** Thread name. */ name: string; /** Auto archive duration in minutes. */ autoArchiveDuration?: 60 | 1440 | 4320 | 10080; /** Slowmode interval in seconds. */ rateLimitPerUser?: number; }
/** Options for retrieving users who reacted to a message. */
export interface ReactionFetchOptions { /** Return users after this ID. */ after?: string; /** Maximum number of users. */ limit?: number; }

/** High-level REST-backed channel and message manager. */
export class ChannelManager extends Manager<string, Channel> {
    readonly #rest: REST;
    readonly #context: ResourceContext;
    /** Creates a channel manager backed by the client's REST transport. @param rest REST transport. */
    public constructor(rest: REST) { super(); this.#rest = rest; this.#context = { sendMessage: (channelId, options) => this.send(channelId, options), editMessage: (channelId, messageId, options) => this.editMessage(channelId, messageId, options), deleteMessage: (channelId, messageId) => this.deleteMessage(channelId, messageId), crosspostMessage: (channelId, messageId) => this.crosspostMessage(channelId, messageId) }; }
    /** Fetches a channel and synchronizes it into cache. @param channelId Channel identifier. @returns The hydrated channel. */
    public async fetch(channelId: string): Promise<Channel> { const data = await this.#rest.get<ConstructorParameters<typeof Channel>[0]>(Routes.channel(channelId)); const channel = new Channel(data, this.#context); this.set(channel.id, channel); return channel; }
    /** Resolves a channel from cache or REST. @param channelId Channel identifier. @returns The cached or fetched channel. */
    public async resolve(channelId: string): Promise<Channel> { return this.get(channelId) ?? this.fetch(channelId); }
    /** Sends a message. @param channelId Channel identifier. @param options Message payload. @returns The created message. @throws {RESTError} If Discord rejects the request. */
    public async send(channelId: string, options: MessageCreateOptions): Promise<Message> { const data = await this.#rest.post<ConstructorParameters<typeof Message>[0]>(Routes.channelMessages(channelId), options); return new Message(data, this.#context); }
    /** @deprecated Use send(). @param channelId Channel identifier. @param options Message payload. @returns The created message. */
    public sendMessage(channelId: string, options: MessageCreateOptions): Promise<Message> { return this.send(channelId, options); }
    /** Fetches messages. @param channelId Channel identifier. @param options Message query. @returns Hydrated messages. */
    public async fetchMessages(channelId: string, options: MessageFetchOptions = {}): Promise<Message[]> { const query = new URLSearchParams(); if (options.before !== undefined) query.set("before", options.before); if (options.after !== undefined) query.set("after", options.after); if (options.around !== undefined) query.set("around", options.around); if (options.limit !== undefined) query.set("limit", String(options.limit)); const data = await this.#rest.get<ConstructorParameters<typeof Message>[0][]>(`${Routes.channelMessages(channelId)}${query.size ? `?${query}` : ""}`); return data.map(message => new Message(message, this.#context)); }
    /** Fetches a message. @param channelId Channel identifier. @param messageId Message identifier. @returns The hydrated message. */
    public async fetchMessage(channelId: string, messageId: string): Promise<Message> { const data = await this.#rest.get<ConstructorParameters<typeof Message>[0]>(Routes.message(channelId, messageId)); return new Message(data, this.#context); }
    /** Edits a message. @param channelId Channel identifier. @param messageId Message identifier. @param options Edit payload. @returns The updated message. */
    public async editMessage(channelId: string, messageId: string, options: MessageEditOptions): Promise<Message> { const data = await this.#rest.patch<ConstructorParameters<typeof Message>[0]>(Routes.message(channelId, messageId), options); return new Message(data, this.#context); }
    /** Deletes a message. @param channelId Channel identifier. @param messageId Message identifier. @returns Nothing. */
    public async deleteMessage(channelId: string, messageId: string): Promise<void> { await this.#rest.delete(Routes.message(channelId, messageId)); }
    /** Crossposts a message. @param channelId Channel identifier. @param messageId Message identifier. @returns The crossposted message. */
    public async crosspostMessage(channelId: string, messageId: string): Promise<Message> { const data = await this.#rest.post<ConstructorParameters<typeof Message>[0]>(Routes.crosspostMessage(channelId, messageId)); return new Message(data, this.#context); }
    /** Bulk deletes messages. @param channelId Channel identifier. @param messageIds Message identifiers. @returns Nothing. */
    public async bulkDeleteMessages(channelId: string, messageIds: Iterable<string>): Promise<void> { await this.#rest.post(Routes.channelBulkDelete(channelId), { messages: [...messageIds] }); }
    /** Adds a reaction. @param channelId Channel identifier. @param messageId Message identifier. @param emoji Emoji name. @returns Nothing. */
    public async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> { await this.#rest.put(Routes.messageReactions(channelId, messageId, emoji)); }
    /** Removes the current bot user's reaction. @param channelId Channel identifier. @param messageId Message identifier. @param emoji Emoji name. @returns Nothing. */
    public async removeOwnReaction(channelId: string, messageId: string, emoji: string): Promise<void> { await this.#rest.delete(`${Routes.messageReactions(channelId, messageId, emoji)}/@me`); }
    /** Removes a specific user's reaction. @param channelId Channel identifier. @param messageId Message identifier. @param emoji Emoji name. @param userId User identifier. @returns Nothing. */
    public async removeReaction(channelId: string, messageId: string, emoji: string, userId: string): Promise<void> { await this.#rest.delete(`${Routes.messageReactions(channelId, messageId, emoji)}/${userId}`); }
    /** Gets users who reacted. @param channelId Channel identifier. @param messageId Message identifier. @param emoji Emoji name. @param options Reaction query. @returns Hydrated users. */
    public async fetchReactions(channelId: string, messageId: string, emoji: string, options: ReactionFetchOptions = {}): Promise<User[]> { const query = new URLSearchParams(); if (options.after !== undefined) query.set("after", options.after); if (options.limit !== undefined) query.set("limit", String(options.limit)); const data = await this.#rest.get<ConstructorParameters<typeof User>[0][]>(`${Routes.messageReactions(channelId, messageId, emoji)}${query.size ? `?${query}` : ""}`); return data.map(user => new User(user)); }
    /** Removes all reactions. @param channelId Channel identifier. @param messageId Message identifier. @returns Nothing. */
    public async removeAllReactions(channelId: string, messageId: string): Promise<void> { await this.#rest.delete(Routes.messageReactionsAll(channelId, messageId)); }
    /** Gets pinned messages. @param channelId Channel identifier. @returns Hydrated messages. */
    public async fetchPinnedMessages(channelId: string): Promise<Message[]> { const data = await this.#rest.get<ConstructorParameters<typeof Message>[0][]>(Routes.channelPins(channelId)); return data.map(message => new Message(message, this.#context)); }
    /** Pins a message. @param channelId Channel identifier. @param messageId Message identifier. @returns Nothing. */
    public async pinMessage(channelId: string, messageId: string): Promise<void> { await this.#rest.put(Routes.channelPin(channelId, messageId)); }
    /** Unpins a message. @param channelId Channel identifier. @param messageId Message identifier. @returns Nothing. */
    public async unpinMessage(channelId: string, messageId: string): Promise<void> { await this.#rest.delete(Routes.channelPin(channelId, messageId)); }
    /** Creates a thread from a message. @param channelId Channel identifier. @param messageId Message identifier. @param options Thread options. @returns The created channel. */
    public async createThreadFromMessage(channelId: string, messageId: string, options: MessageThreadOptions): Promise<Channel> { const data = await this.#rest.post<ConstructorParameters<typeof Channel>[0]>(Routes.messageThread(channelId, messageId), { name: options.name, auto_archive_duration: options.autoArchiveDuration, rate_limit_per_user: options.rateLimitPerUser }); const channel = new Channel(data, this.#context); this.set(channel.id, channel); return channel; }
}

export type { MessageCreateOptions as CreateMessageOptions };
