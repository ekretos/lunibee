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
export class UserManager extends ResourceManager<string, User> { /** Creates a user manager. @param rest REST transport. @returns A user manager. @throws {Error} If REST is invalid. */ public constructor(rest: REST) { super(async id => new User(await rest.get<ConstructorParameters<typeof User>[0]>(Routes.userById(id))), user => user.id); } }
/** Manages guilds with cache and REST synchronization. */
export class GuildManager extends ResourceManager<string, Guild> { /** Creates a guild manager. @param rest REST transport. @returns A guild manager. @throws {Error} If REST is invalid. */ public constructor(rest: REST) { super(async id => new Guild(await rest.get<ConstructorParameters<typeof Guild>[0]>(Routes.guild(id))), guild => guild.id); } }
/** Payload accepted by Discord's Create Message endpoint. */ export interface MessageCreateOptions { /** Message content. */ content?: string; }
/** Payload accepted by Discord's Edit Message endpoint. */ export interface MessageEditOptions { /** Replacement message content. */ content?: string; }
/** Optional parameters accepted when fetching a message. */ export interface MessageFetchOptions { /** Whether the request should prefer an existing cached message. */ cache?: boolean; }
/** Parameters used when creating a message thread. */ export interface MessageThreadOptions { /** Thread name. */ name: string; /** Auto-archive duration in minutes. */ autoArchiveDuration?: 60 | 1440 | 4320 | 10080; /** Per-user slowmode duration in seconds. */ rateLimitPerUser?: number; }
/** Optional parameters accepted when fetching message reactions. */ export interface ReactionFetchOptions { /** Maximum number of users to return. */ limit?: number; /** User ID after which pagination should continue. */ after?: string; }

/** Manages channels and composes dedicated message and thread resources. */
export class ChannelManager extends Manager<string, Channel> {
    readonly #rest: REST; readonly #context: ResourceContext;
    /** Creates a channel manager. @param rest REST transport. @returns A channel manager. @throws {Error} If REST is invalid. */
    public constructor(rest: REST) { super(); this.#rest = rest; this.#context = { sendMessage: (channelId, options) => this.send(channelId, options), editMessage: (channelId, messageId, options) => this.editMessage(channelId, messageId, options), deleteMessage: (channelId, messageId) => this.deleteMessage(channelId, messageId), crosspostMessage: (channelId, messageId) => this.crosspostMessage(channelId, messageId) }; }
    /** Returns the dedicated message manager for a channel. @param channelId Channel identifier. @returns Message manager. @throws {TypeError} If channelId is empty. */ public messages(channelId: string): MessageManager { return new MessageManager(this.#rest, this.#context, channelId); }
    /** Returns the dedicated thread manager for a channel. @param channelId Channel identifier. @returns Thread manager. @throws {TypeError} If channelId is empty. */ public threads(channelId: string): ThreadManager { return new ThreadManager(this.#rest, this.#context, channelId); }
    /** Fetches a channel and updates its cache. @param channelId Channel identifier. @returns Hydrated channel. @throws {Error} If REST rejects the request. */ public async fetch(channelId: string): Promise<Channel> { const data = await this.#rest.get<ConstructorParameters<typeof Channel>[0]>(Routes.channel(channelId)); const channel = new Channel(data, this.#context); this.update(channel); return channel; }
    /** Resolves a channel from cache or REST. @param channelId Channel identifier. @returns Cached or fetched channel. @throws {Error} If REST rejects the request. */ public async resolve(channelId: string): Promise<Channel> { return this.get(channelId) ?? this.fetch(channelId); }
    /** Inserts a channel into cache. @param channel Channel resource. @returns This manager. */ public update(channel: Channel): this { return this.set(channel.id, channel); }
    /** Sends a message. @param channelId Channel identifier. @param options Message payload. @returns Created message. @throws {Error} If REST rejects the request. */ public send(channelId: string, options: MessageCreateOptions): Promise<Message> { return this.messages(channelId).send(options); }
    /** Sends a message using the compatibility name. @param channelId Channel identifier. @param options Message payload. @returns Created message. @throws {Error} If REST rejects the request. */ public sendMessage(channelId: string, options: MessageCreateOptions): Promise<Message> { return this.send(channelId, options); }
    /** Fetches one message. @param channelId Channel identifier. @param messageId Message identifier. @param options Optional fetch behavior. @returns Hydrated message. @throws {Error} If REST rejects the request. */ public fetchMessage(channelId: string, messageId: string, options: MessageFetchOptions = {}): Promise<Message> { void options; return this.messages(channelId).fetch(messageId); }
    /** Edits one message. @param channelId Channel identifier. @param messageId Message identifier. @param options Edit payload. @returns Updated message. @throws {Error} If REST rejects the request. */ public async editMessage(channelId: string, messageId: string, options: MessageEditOptions): Promise<Message> { const data = await this.#rest.patch<ConstructorParameters<typeof Message>[0]>(Routes.message(channelId, messageId), options); return new Message(data, this.#context); }
    /** Deletes one message. @param channelId Channel identifier. @param messageId Message identifier. @returns Nothing. @throws {Error} If REST rejects the request. */ public deleteMessage(channelId: string, messageId: string): Promise<void> { return this.messages(channelId).delete(messageId); }
    /** Crossposts a message. @param channelId Channel identifier. @param messageId Message identifier. @returns Crossposted message. @throws {Error} If REST rejects the request. */ public async crosspostMessage(channelId: string, messageId: string): Promise<Message> { const data = await this.#rest.post<ConstructorParameters<typeof Message>[0]>(Routes.crosspostMessage(channelId, messageId)); return new Message(data, this.#context); }
    /** Creates a thread from a message. @param channelId Channel identifier. @param messageId Message identifier. @param options Thread options. @returns Created thread. @throws {Error} If REST rejects the request. */ public createThreadFromMessage(channelId: string, messageId: string, options: MessageThreadOptions): Promise<Channel> { return this.threads(channelId).createFromMessage(messageId, options); }
}
/** Backward-compatible alias for create-message options. */ export type CreateMessageOptions = MessageCreateOptions;

export { MessageManager } from "./message.js";
export { ThreadManager } from "./thread.js";
