import { Collection } from "@lunibee/collection";
import { REST, Routes } from "@lunibee/rest";
import { Channel, Message, User, Guild, type ResourceContext } from "@lunibee/structures";
import { MessageManager } from "./message.js";
import { ThreadManager } from "./thread.js";

export class Manager<K, V> {
    public readonly cache = new Collection<K, V>();
    public get(id: K): V | undefined { return this.cache.get(id); }
    public has(id: K): boolean { return this.cache.has(id); }
    public set(id: K, value: V): this { this.cache.set(id, value); return this; }
    public delete(id: K): boolean { return this.cache.delete(id); }
    public clear(): void { this.cache.clear(); }
    public get size(): number { return this.cache.size; }
    public first(): V | undefined { return this.cache.first(); }
    public values(): V[] { return this.cache.array(); }
    public find(predicate: (value: V, key: K) => boolean): V | undefined { return this.cache.find(predicate); }
    public [Symbol.iterator](): IterableIterator<[K, V]> { return this.cache[Symbol.iterator](); }
}

export class ResourceManager<K, V> extends Manager<K, V> {
    readonly #fetcher: (id: K) => Promise<V>; readonly #key: (value: V) => K;
    public constructor(fetcher: (id: K) => Promise<V>, key: (value: V) => K) { super(); if (typeof fetcher !== "function" || typeof key !== "function") throw new TypeError("ResourceManager requires fetcher and key functions."); this.#fetcher = fetcher; this.#key = key; }
    public async resolve(id: K): Promise<V> { return this.get(id) ?? this.fetch(id); }
    public async fetch(id: K): Promise<V> { const value = await this.#fetcher(id); this.update(value); return value; }
    public async fetchMany(ids: Iterable<K>): Promise<V[]> { return Promise.all([...ids].map(id => this.fetch(id))); }
    public update(value: V): this { this.set(this.#key(value), value); return this; }
}

export class UserManager extends ResourceManager<string, User> { public constructor(rest: REST) { super(async id => new User(await rest.get<ConstructorParameters<typeof User>[0]>(Routes.userById(id))), user => user.id); } }
export class GuildManager extends ResourceManager<string, Guild> { public constructor(rest: REST) { super(async id => new Guild(await rest.get<ConstructorParameters<typeof Guild>[0]>(Routes.guild(id))), guild => guild.id); } }
export interface MessageCreateOptions { content?: string; }
export interface MessageEditOptions { content?: string; }
export interface MessageFetchOptions { cache?: boolean; }
export interface MessageThreadOptions { name: string; autoArchiveDuration?: 60 | 1440 | 4320 | 10080; rateLimitPerUser?: number; }
export interface ReactionFetchOptions { limit?: number; after?: string; }

// Interfaces are erased by TypeScript, but core historically re-exported these names as values.
// Keep runtime compatibility without changing their type-level API.
export const MessageCreateOptions = undefined;
export const MessageEditOptions = undefined;
export const MessageFetchOptions = undefined;
export const MessageThreadOptions = undefined;
export const ReactionFetchOptions = undefined;

export class ChannelManager extends Manager<string, Channel> {
    readonly #rest: REST; readonly #context: ResourceContext; readonly #messageManagers = new Map<string, MessageManager>();
    public constructor(rest: REST) { super(); this.#rest = rest; this.#context = { sendMessage: (channelId, options) => this.send(channelId, options), editMessage: (channelId, messageId, options) => this.editMessage(channelId, messageId, options), deleteMessage: (channelId, messageId) => this.deleteMessage(channelId, messageId), crosspostMessage: (channelId, messageId) => this.crosspostMessage(channelId, messageId) }; }
    public messages(channelId: string): MessageManager { let manager = this.#messageManagers.get(channelId); if (!manager) { manager = new MessageManager(this.#rest, this.#context, channelId); this.#messageManagers.set(channelId, manager); } return manager; }
    public threads(channelId: string): ThreadManager { return new ThreadManager(this.#rest, this.#context, channelId); }
    public async fetch(channelId: string): Promise<Channel> { const data = await this.#rest.get<ConstructorParameters<typeof Channel>[0]>(Routes.channel(channelId)); return this.upsert(data); }
    public async resolve(channelId: string): Promise<Channel> { return this.get(channelId) ?? this.fetch(channelId); }
    public upsert(data: ConstructorParameters<typeof Channel>[0]): Channel { const existing = this.get(data.id); const channel = new Channel(data, this.#context); if (existing) { Object.assign(existing, channel); return existing; } this.set(channel.id, channel); return channel; }
    public update(channel: Channel): this { return this.set(channel.id, channel); }
    public send(channelId: string, options: MessageCreateOptions): Promise<Message> { return this.messages(channelId).send(options); }
    public sendMessage(channelId: string, options: MessageCreateOptions): Promise<Message> { return this.send(channelId, options); }
    public fetchMessage(channelId: string, messageId: string, options: MessageFetchOptions = {}): Promise<Message> { void options; return this.messages(channelId).fetch(messageId); }
    public fetchMessages(channelId: string, messageIds: Iterable<string>): Promise<Message[]> { return this.messages(channelId).fetchMany(messageIds); }
    public upsertMessage(data: ConstructorParameters<typeof Message>[0]): Message { return this.messages(data.channel_id).upsert(data); }
    public async editMessage(channelId: string, messageId: string, options: MessageEditOptions): Promise<Message> { const data = await this.#rest.patch<ConstructorParameters<typeof Message>[0]>(Routes.message(channelId, messageId), options); return this.messages(channelId).upsert(data); }
    public async deleteMessage(channelId: string, messageId: string): Promise<void> { await this.#rest.delete(Routes.message(channelId, messageId)); this.messages(channelId).delete(messageId); }
    public deleteCachedMessage(channelId: string, messageId: string): boolean { return this.messages(channelId).delete(messageId); }
    public async crosspostMessage(channelId: string, messageId: string): Promise<Message> { const data = await this.#rest.post<ConstructorParameters<typeof Message>[0]>(Routes.crosspostMessage(channelId, messageId)); return this.messages(channelId).upsert(data); }
    public createThreadFromMessage(channelId: string, messageId: string, options: MessageThreadOptions): Promise<Channel> { return this.threads(channelId).createFromMessage(messageId, options); }
    public delete(channelId: string): boolean { this.#messageManagers.delete(channelId); return super.delete(channelId); }
    public clear(): void { this.#messageManagers.clear(); super.clear(); }
}
export type CreateMessageOptions = MessageCreateOptions;

export { MessageManager } from "./message.js";
export { ThreadManager } from "./thread.js";