import { Collection } from "@lunibee/collection";
import { REST, Routes } from "@lunibee/rest";
import { Message, type ResourceContext } from "@lunibee/structures";

/** Manages message resources belonging to a single channel with canonical identity. */
export class MessageManager {
  /** Canonical message cache for this channel. */
  public readonly cache = new Collection<string, Message>();
  readonly #rest: REST;
  readonly #context: ResourceContext;
  readonly #channelId: string;

  /** Creates a message manager. @param rest REST transport. @param context Structure resource context. @param channelId Channel identifier. @throws {TypeError} If channelId is empty. */
  public constructor(rest: REST, context: ResourceContext, channelId: string) {
    if (!channelId) throw new TypeError("Channel ID is required.");
    this.#rest = rest;
    this.#context = context;
    this.#channelId = channelId;
  }
  /** Resolves a message from cache or REST. @param messageId Message identifier. @returns Canonical message. */
  public async resolve(messageId: string): Promise<Message> {
    return this.cache.get(messageId) ?? this.fetch(messageId);
  }
  /** Sends a message and caches it canonically. @param options Message payload. @returns Canonical message. */
  public async send(options: { content?: string }): Promise<Message> {
    const data = await this.#rest.post<
      ConstructorParameters<typeof Message>[0]
    >(Routes.channelMessages(this.#channelId), options);
    return this.upsert(data);
  }
  /** Fetches one message and caches it canonically. @param messageId Message identifier. @returns Canonical message. */
  public async fetch(messageId: string): Promise<Message> {
    const data = await this.#rest.get<
      | ConstructorParameters<typeof Message>[0]
      | ConstructorParameters<typeof Message>[0][]
    >(Routes.message(this.#channelId, messageId));
    const message = Array.isArray(data) ? data[0] : data;
    if (!message) throw new Error("Discord returned no message payload.");
    return this.upsert(message);
  }
  /** Fetches several messages by ID. @param messageIds Message identifiers. @returns Canonical messages. */
  public fetchMany(messageIds: Iterable<string>): Promise<Message[]> {
    return Promise.all(
      Array.from(messageIds, (messageId) => this.fetch(messageId)),
    );
  }
  /** Inserts or updates a message through the shared hydration path. @param data Discord message payload. @returns Canonical message. */
  public upsert(data: ConstructorParameters<typeof Message>[0]): Message {
    const existing = this.cache.get(data.id);
    const message = new Message(data, this.#context);
    if (existing) {
      Object.assign(existing, message);
      return existing;
    }
    this.cache.set(message.id, message);
    return message;
  }
  /** Removes a message from cache. @param messageId Message identifier. @returns Whether a cached message was removed. */
  public delete(messageId: string): boolean {
    return this.cache.delete(messageId);
  }
}
