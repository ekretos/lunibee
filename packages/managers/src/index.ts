import { Collection } from "@lunibee/collection";
import { REST, Routes } from "@lunibee/rest";
import { Channel, Message, User, Guild, type ResourceContext } from "@lunibee/structures";
import { MessageManager } from "./message.js";
import { ThreadManager } from "./thread.js";

/** Stores Discord resources by stable identifier. */
export class Manager<K, V> {
    /** Cached resources. */ public readonly cache = new Collection<K, V>();
    /** Returns a cached resource. @param id Resource identifier. @returns Cached resource or undefined. */ public get(id: K): V | undefined { return this.cache.get(id); }
    /** Checks whether an identifier is cached. @param id Resource identifier. @returns True when cached. */ public has(id: K): boolean { return this.cache.has(id); }
    /** Inserts or replaces a resource. @param id Resource identifier. @param value Resource instance. @returns This manager. */ public set(id: K, value: V): this { this.cache.set(id, value); return this; }
    /** Removes a resource. @param id Resource identifier. @returns True when removed. */ public delete(id: K): boolean { return this.cache.delete(id); }
    /** Clears the cache. @returns Nothing. */ public clear(): void { this.cache.clear(); }
    /** Returns cache size. @returns Number of cached resources. */ public get size(): number { return this.cache.size; }
    /** Returns the first cached resource. @returns First resource or undefined. */ public first(): V | undefined { return this.cache.first(); }
    /** Returns a snapshot of cached resources. @returns Cached resources. */ public values(): V[] { return this.cache.array(); }
    /** Finds a cached resource. @param predicate Matching predicate. @returns Matching resource or undefined. */ public find(predicate: (value: V, key: K) => boolean): V | undefined { return this.cache.find(predicate); }
    /** Iterates over cached resources. @returns Resource entries iterator. */ public [Symbol.iterator](): IterableIterator<[K, V]> { return this.cache[Symbol.iterator](); }
}

/** Provides a consistent cache-first lifecycle for REST-backed resources. */
export class ResourceManager<K, V> extends Manager<K, V> {
    readonly #fetcher: (id: K) => Promise<V>; readonly #key: (value: V) => K;
    /** Creates a resource manager. @param fetcher REST/resource fetcher. @param key Cache-key extractor. @throws {TypeError} If callbacks are not functions. */
    public constructor(fetcher: (id: K) => Promise<V>, key: (value: V) => K) { super(); if (typeof fetcher !== "function" || typeof key !== "function") throw new TypeError("ResourceManager requires fetcher and key functions."); this.#fetcher = fetcher; this.#key = key; }
    /** Resolves from cache or fetches from REST. @param id Resource identifier. @returns Cached or fetched resource. @throws {Error} If REST rejects the request. */ public async resolve(id: K): Promise<V> { return this.get(id) ?? this.fetch(id); }
    /** Fetches and caches a resource. @param id Resource identifier. @returns Fetched resource. @throws {Error} If REST rejects the request. */ public async fetch(id: K): Promise<V> { const value = await this.#fetcher(id); this.update(value); return value; }
    /** Fetches several resources. @param ids Resource identifiers. @returns Resources in input order. @throws {Error} If any fetch fails. */ public async fetchMany(ids: Iterable<K>): Promise<V[]> { return Promise.all([...ids].map(id => this.fetch(id))); }
    /** Inserts or replaces a resource using its intrinsic identifier. @param value Resource instance. @returns This manager. */ public update(value: V): this { this.set(this.#key(value), value); return this; }
}

/** Manages users with cache and REST synchronization. */
export class UserManager extends ResourceManager<string, User> { /** Creates a user manager. @param rest REST transport. @returns A user manager. */ public constructor(rest: REST) { super(async id => new User(await rest.get<ConstructorParameters<typeof User>[0]>(Routes.userById(id))), user => user.id); } }
/** Manages guilds with cache and REST synchronization. */
export class GuildManager extends ResourceManager<string, Guild> { /** Creates a guild manager. @param rest REST transport. @returns A guild manager. */ public constructor(rest: REST) { super(async id => new Guild(await rest.get<ConstructorParameters<typeof Guild>[0]>(Routes.guild(id))), guild => guild.id); } }
/** Payload accepted by Discord's Create Message endpoint. */ export interface MessageCreateOptions { /** Message content. */ content?: string; }
/** Payload accepted by Discord's Edit Message endpoint. */ export interface MessageEditOptions { /** Replacement message content. */ content?: string; }
/** Optional parameters accepted when fetching a message. */ export interface MessageFetchOptions { /** Whether the request should prefer an existing cached message. */ cache?: boolean; }
/** Parameters used when creating a message thread. */ export interface MessageThreadOptions { /** Thread name. */ name: string; /** Auto-archive duration in minutes. */ autoArchiveDuration?: 60 | 1440 | 4320 | 10080; /** Per-user slowmode duration in seconds. */ rateLimitPerUser?: number; }
/** Optional parameters accepted when fetching message reactions. */ export interface ReactionFetchOptions { /** Maximum number of users to return. */ limit?: number; /** User ID after which pagination should continue. */ after?: string; }

/** Manages channels and composes dedicated message and thread resources. */
export class ChannelManager extends Manager<string, Channel> {
    readonly #rest: REST; readonly #context: ResourceContext; readonly #messageManagers = new Map<string, MessageManager>();
    /** Creates a channel manager. @param rest REST transport. @returns A channel manager. */
    public constructor(rest: REST) { super(); this.#rest = rest; this.#context = { sendMessage: (channelId, options) => this.send(channelId, options), editMessage: (channelId, messageId, options) => this.editMessage(channelId, messageId, options), deleteMessage: (channelId, messageId) => this.deleteMessage(channelId, messageId), crosspostMessage: (channelId, messageId) => this.crosspostMessage(channelId, messageId) }; }
    /** Returns the stable message manager for a channel. @param channelId Channel identifier. @returns Canonical message manager. */ public messages(channelId: string): MessageManager { let manager = this.#messageManagers.get(channelId); if (!manager) { manager = new MessageManager(this.#rest, this.#context, channelId); this.#messageManagers.set(channelId, manager); } return manager; }
    /** Returns the dedicated thread manager for a channel. @param channelId Channel identifier. @returns Thread manager. */ public threads(channelId: string): ThreadManager { return new ThreadManager(this.#rest, this.#context, channelId); }
    /** Fetches a channel and updates its cache. @param channelId Channel identifier. @returns Canonical channel. @throws {Error} If REST rejects the request. */ public async fetch(channelId: string): Promise<Channel> { const data = await this.#rest.get<ConstructorParameters<typeof Channel>[0]>(Routes.channel(channelId)); return this.upsert(data); }
    /** Resolves a channel from cache or REST. @param channelId Channel identifier. @returns Canonical channel. @throws {Error} If REST rejects the request. */ public async resolve(channelId: string): Promise<Channel> { return this.get(channelId) ?? this.fetch(channelId); }
    /** Inserts or updates a channel through the shared hydration path. @param data Channel API payload. @returns Canonical channel. */ public upsert(data: ConstructorParameters<typeof Channel>[0]): Channel { const existing = this.get(data.id); const channel = new Channel(data, this.#context); if (existing) { Object.assign(existing, channel); return existing; } this.set(channel.id, channel); return channel; }
    /** Inserts a channel into cache. @param channel Channel resource. @returns This manager. */ public update(channel: Channel): this { return this.set(channel.id, channel); }
    /** Sends a message. @param channelId Channel identifier. @param options Message payload. @returns Canonical created message. */ public send(channelId: string, options: MessageCreateOptions): Promise<Message> { return this.messages(channelId).send(options); }
    /** Sends a message using the compatibility name. @param channelId Channel identifier. @param options Message payload. @returns Canonical created message. */ public sendMessage(channelId: string, options: MessageCreateOptions): Promise<Message> { return this.send(channelId, options); }
    /** Fetches one message. @param channelId Channel identifier. @param messageId Message identifier. @param options Optional fetch behavior. @returns Canonical message. */ public fetchMessage(channelId: string, messageId: string, options: MessageFetchOptions = {}): Promise<Message> { void options; return this.messages(channelId).fetch(messageId); }
    /** Fetches and caches multiple messages from a channel. @param channelId Channel identifier. @param messageIds Message identifiers. @returns Canonical messages. */ public fetchMessages(channelId: string, messageIds: Iterable<string>): Promise<Message[]> { return this.messages(channelId).fetchMany(messageIds); }
    /** Hydrates a Gateway or REST message through the shared cache path. @param data Message API payload. @returns Canonical message. */ public upsertMessage(data: ConstructorParameters<typeof Message>[0]): Message { return this.messages(data.channel_id).upsert(data); }
    /** Edits one message and updates its canonical cache entry. @param channelId Channel identifier. @param messageId Message identifier. @param options Edit payload. @returns Canonical updated message. */ public async editMessage(channelId: string, messageId: string, options: MessageEditOptions): Promise<Message> { const data = await this.#rest.patch<ConstructorParameters<typeof Message>[0]>(Routes.message(channelId, messageId), options); return this.messages(channelId).upsert(data); }
    /** Deletes one message and removes it from the canonical cache. @param channelId Channel identifier. @param messageId Message identifier. @returns Nothing. */ public async deleteMessage(channelId: string, messageId: string): Promise<void> { await this.#rest.delete(Routes.message(channelId, messageId)); this.messages(channelId).delete(messageId); }
    /** Removes a Gateway/REST deleted message from its canonical cache. @param channelId Channel identifier. @param messageId Message identifier. @returns True when cached. */ public deleteCachedMessage(channelId: string, messageId: string): boolean { return this.messages(channelId).delete(messageId); }
    /** Crossposts a message and updates its canonical cache entry. @param channelId Channel identifier. @param messageId Message identifier. @returns Canonical crossposted message. */ public async crosspostMessage(channelId: string, messageId: string): Promise<Message> { const data = await this.#rest.post<ConstructorParameters<typeof Message>[0]>(Routes.crosspostMessage(channelId, messageId)); return this.messages(channelId).upsert(data); }
    /** Creates a thread from a message. @param channelId Channel identifier. @param messageId Message identifier. @param options Thread options. @returns Created thread. */ public createThreadFromMessage(channelId: string, messageId: string, options: MessageThreadOptions): Promise<Channel> { return this.threads(channelId).createFromMessage(messageId, options); }
    /** Removes a channel from cache and releases its message manager. @param channelId Channel identifier. @returns True when a cached channel was removed. */ public delete(channelId: string): boolean { this.#messageManagers.delete(channelId); return super.delete(channelId); }
    /** Clears channels and all associated message caches. @returns Nothing. */ public clear(): void { this.#messageManagers.clear(); super.clear(); }
}
/** Backward-compatible alias for create-message options. */ export type CreateMessageOptions = MessageCreateOptions;

export { MessageManager } from "./message.js";
export { ThreadManager } from "./thread.js";
