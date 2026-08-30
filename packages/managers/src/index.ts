/** Collection-backed generic resource manager. */
import { Collection } from "@lunibee/collection";
import { REST, Routes } from "@lunibee/rest";
import {
  Channel,
  Message,
  User,
  Guild,
  type ResourceContext,
} from "@lunibee/structures";
import { MessageManager } from "./message.js";
import { ThreadManager } from "./thread.js";

/** Generic cache manager. @typeParam K Cache key type. @typeParam V Cached value type. */
export class Manager<K, V> {
  /** Cached resources. */ public readonly cache = new Collection<K, V>();
  /** Gets a cached value. @param id Cache key. @returns Cached value. */ public get(
    id: K,
  ): V | undefined {
    return this.cache.get(id);
  }
  /** Checks whether a value is cached. @param id Cache key. @returns True when cached. */ public has(
    id: K,
  ): boolean {
    return this.cache.has(id);
  }
  /** Stores a value. @param id Cache key. @param value Value. @returns This manager. */ public set(
    id: K,
    value: V,
  ): this {
    this.cache.set(id, value);
    return this;
  }
  /** Deletes a cached value. @param id Cache key. @returns True when deleted. */ public delete(
    id: K,
  ): boolean {
    return this.cache.delete(id);
  }
  /** Clears the cache. @returns Nothing. */ public clear(): void {
    this.cache.clear();
  }
  /** Gets cache size. @returns Number of cached values. */ public get size(): number {
    return this.cache.size;
  }
  /** Gets the first cached value. @returns First value. */ public first():
    V | undefined {
    return this.cache.first();
  }
  /** Returns cached values. @returns Array of values. */ public values(): V[] {
    return this.cache.array();
  }
  /** Finds a cached value. @param predicate Predicate. @returns Matching value. */ public find(
    predicate: (value: V, key: K) => boolean,
  ): V | undefined {
    return this.cache.find(predicate);
  }
  /** Iterates cached entries. @returns Cache iterator. */ public [Symbol.iterator](): IterableIterator<
    [K, V]
  > {
    return this.cache[Symbol.iterator]();
  }
}
/** Generic REST-backed resource manager. @typeParam K Resource key type. @typeParam V Resource type. */
export class ResourceManager<K, V> extends Manager<K, V> {
  readonly #fetcher: (id: K) => Promise<V>;
  readonly #key: (value: V) => K;
  /** Creates a resource manager. @param fetcher Resource fetcher. @param key Key extractor. @throws {TypeError} When callbacks are invalid. */
  public constructor(fetcher: (id: K) => Promise<V>, key: (value: V) => K) {
    super();
    if (typeof fetcher !== "function" || typeof key !== "function")
      throw new TypeError(
        "ResourceManager requires fetcher and key functions.",
      );
    this.#fetcher = fetcher;
    this.#key = key;
  }
  /** Resolves from cache or REST. @param id Resource key. @returns Resource. */ public async resolve(
    id: K,
  ): Promise<V> {
    return this.get(id) ?? this.fetch(id);
  }
  /** Fetches and caches a resource. @param id Resource key. @returns Resource. */ public async fetch(
    id: K,
  ): Promise<V> {
    const value = await this.#fetcher(id);
    this.update(value);
    return value;
  }
  /** Fetches multiple resources. @param ids Resource keys. @returns Resources. */ public async fetchMany(
    ids: Iterable<K>,
  ): Promise<V[]> {
    return Promise.all([...ids].map((id) => this.fetch(id)));
  }
  /** Updates a resource in cache. @param value Resource. @returns This manager. */ public update(
    value: V,
  ): this {
    this.set(this.#key(value), value);
    return this;
  }
}
/** Manages users. */
export class UserManager extends ResourceManager<string, User> {
  /** Creates a user manager. @param rest REST transport. */ public constructor(
    rest: REST,
  ) {
    super(
      async (id) =>
        new User(
          await rest.get<ConstructorParameters<typeof User>[0]>(
            Routes.userById(id),
          ),
        ),
      (user) => user.id,
    );
  }
}
/** Manages guilds. */
export class GuildManager extends ResourceManager<string, Guild> {
  /** Creates a guild manager. @param rest REST transport. */ public constructor(
    rest: REST,
  ) {
    super(
      async (id) =>
        new Guild(
          await rest.get<ConstructorParameters<typeof Guild>[0]>(
            Routes.guild(id),
          ),
        ),
      (guild) => guild.id,
    );
  }
}
/** Message creation options. */
export interface MessageCreateOptions {
  /** Message content. */ content?: string;
}
/** Message edit options. */
export interface MessageEditOptions {
  /** New message content. */ content?: string;
}
/** Message fetch options. */
export interface MessageFetchOptions {
  /** Whether to use cache. */ cache?: boolean;
}
/** Message list query options. */
export interface MessageQueryOptions {
  /** Message before this ID. */ before?: string;
  /** Message after this ID. */ after?: string;
  /** Message around this ID. */ around?: string;
  /** Maximum number of messages. */ limit?: number;
}
/** Message thread creation options. */
export interface MessageThreadOptions {
  /** Thread name. */ name: string;
  /** Auto archive duration. */ autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
  /** Slowmode duration. */ rateLimitPerUser?: number;
}
/** Reaction list options. */
export interface ReactionFetchOptions {
  /** Maximum reactions. */ limit?: number;
  /** Reaction pagination cursor. */ after?: string;
}
/** Runtime compatibility placeholders for legacy value imports. */
export const MessageCreateOptions = undefined;
/** Runtime compatibility placeholder. */
export const MessageEditOptions = undefined;
/** Runtime compatibility placeholder. */
export const MessageFetchOptions = undefined;
/** Runtime compatibility placeholder. */
export const MessageThreadOptions = undefined;
/** Runtime compatibility placeholder. */
export const ReactionFetchOptions = undefined;

/** Manages Discord channels and their message APIs. */
export class ChannelManager extends Manager<string, Channel> {
  readonly #rest: REST;
  readonly #context: ResourceContext;
  readonly #messageManagers = new Map<string, MessageManager>();
  /** Creates a channel manager. @param rest REST transport. */
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
    };
  }
  /** Gets the canonical message manager for a channel. @param channelId Channel ID. @returns Message manager. */ public messages(
    channelId: string,
  ): MessageManager {
    let manager = this.#messageManagers.get(channelId);
    if (!manager) {
      manager = new MessageManager(this.#rest, this.#context, channelId);
      this.#messageManagers.set(channelId, manager);
    }
    return manager;
  }
  /** Creates a thread manager. @param channelId Channel ID. @returns Thread manager. */ public threads(
    channelId: string,
  ): ThreadManager {
    return new ThreadManager(this.#rest, this.#context, channelId);
  }
  /** Fetches a channel. @param channelId Channel ID. @returns Channel. */ public async fetch(
    channelId: string,
  ): Promise<Channel> {
    const data = await this.#rest.get<ConstructorParameters<typeof Channel>[0]>(
      Routes.channel(channelId),
    );
    return this.upsert(data);
  }
  /** Resolves a channel. @param channelId Channel ID. @returns Canonical channel. */ public async resolve(
    channelId: string,
  ): Promise<Channel> {
    return this.get(channelId) ?? this.fetch(channelId);
  }
  /** Inserts or updates a channel. @param data Channel payload. @returns Canonical channel. */ public upsert(
    data: ConstructorParameters<typeof Channel>[0],
  ): Channel {
    const existing = this.get(data.id);
    const channel = new Channel(data, this.#context);
    if (existing) {
      Object.assign(existing, channel);
      return existing;
    }
    this.set(channel.id, channel);
    return channel;
  }
  /** Updates a channel. @param channel Channel. @returns This manager. */ public update(
    channel: Channel,
  ): this {
    return this.set(channel.id, channel);
  }
  /** Sends a message. @param channelId Channel ID. @param options Message options. @returns Created message. */ public send(
    channelId: string,
    options: MessageCreateOptions,
  ): Promise<Message> {
    return this.messages(channelId).send(options);
  }
  /** Alias for send. @param channelId Channel ID. @param options Message options. @returns Created message. */ public sendMessage(
    channelId: string,
    options: MessageCreateOptions,
  ): Promise<Message> {
    return this.send(channelId, options);
  }
  /** Fetches one message. @param channelId Channel ID. @param messageId Message ID. @param options Fetch options. @returns Message. */ public async fetchMessage(
    channelId: string,
    messageId: string,
    options: MessageFetchOptions = {},
  ): Promise<Message> {
    void options;
    return this.messages(channelId).fetch(messageId);
  }
  /** Fetches messages by query or by iterable IDs. @param channelId Channel ID. @param query Query options or message IDs. @returns Messages. */ public fetchMessages(
    channelId: string,
    query: MessageQueryOptions | Iterable<string>,
  ): Promise<Message[]> {
    if (isMessageQuery(query)) {
      const params = new URLSearchParams();
      if (query.before) params.set("before", query.before);
      if (query.after) params.set("after", query.after);
      if (query.around) params.set("around", query.around);
      if (query.limit !== undefined) params.set("limit", String(query.limit));
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
  /** Inserts a message through the canonical cache path. @param data Message payload. @returns Canonical message. */ public upsertMessage(
    data: ConstructorParameters<typeof Message>[0],
  ): Message {
    return this.messages(data.channel_id).upsert(data);
  }
  /** Edits a message. @param channelId Channel ID. @param messageId Message ID. @param options Edit options. @returns Updated message. */ public async editMessage(
    channelId: string,
    messageId: string,
    options: MessageEditOptions,
  ): Promise<Message> {
    const data = await this.#rest.patch<
      ConstructorParameters<typeof Message>[0]
    >(Routes.message(channelId, messageId), options);
    return this.messages(channelId).upsert(data);
  }
  /** Deletes a message. @param channelId Channel ID. @param messageId Message ID. @returns Nothing. */ public async deleteMessage(
    channelId: string,
    messageId: string,
  ): Promise<void> {
    await this.#rest.delete(Routes.message(channelId, messageId));
    this.messages(channelId).delete(messageId);
  }
  /** Deletes a cached message. @param channelId Channel ID. @param messageId Message ID. @returns Whether removed. */ public deleteCachedMessage(
    channelId: string,
    messageId: string,
  ): boolean {
    return this.messages(channelId).delete(messageId);
  }
  /** Crossposts a message. @param channelId Channel ID. @param messageId Message ID. @returns Crossposted message. */ public async crosspostMessage(
    channelId: string,
    messageId: string,
  ): Promise<Message> {
    const data = await this.#rest.post<
      ConstructorParameters<typeof Message>[0]
    >(Routes.crosspostMessage(channelId, messageId));
    return this.messages(channelId).upsert(data);
  }
  /** Bulk deletes messages. @param channelId Channel ID. @param messageIds Message IDs. @returns Nothing. */ public async bulkDeleteMessages(
    channelId: string,
    messageIds: Iterable<string>,
  ): Promise<void> {
    const ids = [...messageIds];
    await this.#rest.post(Routes.channelBulkDelete(channelId), {
      messages: ids,
    });
    for (const id of ids) this.messages(channelId).delete(id);
  }
  /** Adds a reaction. @param channelId Channel ID. @param messageId Message ID. @param emoji Emoji identifier. @returns Nothing. */ public async addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    await this.#rest.put(Routes.messageReactions(channelId, messageId, emoji));
  }
  /** Fetches users who reacted. @param channelId Channel ID. @param messageId Message ID. @param emoji Emoji identifier. @param options Query options. @returns Users. */ public async fetchReactions(
    channelId: string,
    messageId: string,
    emoji: string,
    options: ReactionFetchOptions = {},
  ): Promise<User[]> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.after) params.set("after", options.after);
    const suffix = params.toString();
    const data = await this.#rest.get<ConstructorParameters<typeof User>[0][]>(
      `${Routes.messageReactions(channelId, messageId, emoji)}${suffix ? `?${suffix}` : ""}`,
    );
    return data.map((user) => new User(user));
  }
  /** Removes the current bot user's reaction. @param channelId Channel ID. @param messageId Message ID. @param emoji Emoji identifier. @returns Nothing. */ public async removeOwnReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    await this.#rest.delete(
      Routes.messageReactions(channelId, messageId, emoji) + "/@me",
    );
  }
  /** Removes a user's reaction. @param channelId Channel ID. @param messageId Message ID. @param emoji Emoji identifier. @param userId User ID. @returns Nothing. */ public async removeReaction(
    channelId: string,
    messageId: string,
    emoji: string,
    userId: string,
  ): Promise<void> {
    await this.#rest.delete(
      `${Routes.messageReactions(channelId, messageId, emoji)}/${userId}`,
    );
  }
  /** Removes all reactions. @param channelId Channel ID. @param messageId Message ID. @returns Nothing. */ public async removeAllReactions(
    channelId: string,
    messageId: string,
  ): Promise<void> {
    await this.#rest.delete(Routes.messageReactionsAll(channelId, messageId));
  }
  /** Fetches pinned messages. @param channelId Channel ID. @returns Pinned messages. */ public async fetchPinnedMessages(
    channelId: string,
  ): Promise<Message[]> {
    const data = await this.#rest.get<
      ConstructorParameters<typeof Message>[0][]
    >(Routes.channelPins(channelId));
    return data.map((item) => this.messages(channelId).upsert(item));
  }
  /** Pins a message. @param channelId Channel ID. @param messageId Message ID. @returns Nothing. */ public async pinMessage(
    channelId: string,
    messageId: string,
  ): Promise<void> {
    await this.#rest.put(Routes.channelPin(channelId, messageId));
  }
  /** Unpins a message. @param channelId Channel ID. @param messageId Message ID. @returns Nothing. */ public async unpinMessage(
    channelId: string,
    messageId: string,
  ): Promise<void> {
    await this.#rest.delete(Routes.channelPin(channelId, messageId));
  }
  /** Creates a thread from a message. @param channelId Channel ID. @param messageId Message ID. @param options Thread options. @returns Created thread channel. */ public createThreadFromMessage(
    channelId: string,
    messageId: string,
    options: MessageThreadOptions,
  ): Promise<Channel> {
    return this.threads(channelId).createFromMessage(messageId, options);
  }
  /** Deletes a channel and its message manager. @param channelId Channel ID. @returns Whether removed. */ public delete(
    channelId: string,
  ): boolean {
    this.#messageManagers.delete(channelId);
    return super.delete(channelId);
  }
  /** Clears all channels and message managers. @returns Nothing. */ public clear(): void {
    this.#messageManagers.clear();
    super.clear();
  }
}
/** Determines whether a message query object was supplied. @param value Candidate query. @returns True when it is a query object. */
function isMessageQuery(
  value: MessageQueryOptions | Iterable<string>,
): value is MessageQueryOptions {
  return (
    typeof value === "object" && value !== null && !(Symbol.iterator in value)
  );
}
/** Backward-compatible message option alias. */
export type CreateMessageOptions = MessageCreateOptions;
/** Exposes the message manager class. */
export { MessageManager } from "./message.js";
/** Exposes the thread manager class. */
export { ThreadManager } from "./thread.js";
