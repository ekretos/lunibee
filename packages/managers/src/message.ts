import { Collection } from "@lunibee/collection";

/** Opt-in per-channel message cache. Messages are temporary data, so they
 * use bounded TTL/LRU storage rather than permanent resource storage. */
export interface MessageCacheOptions {
    /** Messages kept per channel; least-recently-used are evicted. Default 100. */
    maxSize?: number;
    /** Sliding TTL in ms. Omit for no expiry. */
    ttl?: number;
}
import { REST, Routes } from "@lunibee/rest";
import { Message, type ResourceContext } from "@lunibee/structures";

export type MessageCreateOptions = Record<string, unknown> & {
    content?: string;
};
export type MessageEditOptions = Record<string, unknown> & { content?: string };

export class MessageManager {
    /** Cached messages; always empty unless a message cache is configured. */
    public readonly cache: Collection<string, Message>;
    readonly #caching: boolean;
    readonly #rest: REST;
    readonly #context: ResourceContext;
    readonly #channelId: string;

    public constructor(
        rest: REST,
        context: ResourceContext,
        channelId: string,
        cache?: MessageCacheOptions,
    ) {
        if (!channelId) throw new TypeError("Channel ID is required.");
        this.#rest = rest;
        this.#context = context;
        this.#channelId = channelId;
        this.#caching = cache !== undefined;
        this.cache = new Collection<string, Message>(null, {
            ttl: cache?.ttl,
            maxSize: cache ? (cache.maxSize ?? 100) : undefined,
        });
    }
    public async resolve(messageId: string): Promise<Message> {
        return this.cache.get(messageId) ?? this.fetch(messageId);
    }
    public async send(options: MessageCreateOptions): Promise<Message> {
        const data = await this.#rest.post<
            ConstructorParameters<typeof Message>[0]
        >(Routes.channelMessages(this.#channelId), options);
        return this.upsert(data);
    }
    public async fetch(messageId: string): Promise<Message> {
        const data = await this.#rest.get<
            ConstructorParameters<typeof Message>[0]
        >(Routes.message(this.#channelId, messageId));
        return this.upsert(data);
    }
    public fetchMany(messageIds: Iterable<string>): Promise<Message[]> {
        return Promise.all(
            Array.from(messageIds, (messageId) => this.fetch(messageId)),
        );
    }
    public upsert(data: ConstructorParameters<typeof Message>[0]): Message {
        const existing = this.cache.peek(data.id);
        const message = new Message(data, this.#context);
        if (existing) {
            Object.assign(existing, message);
            return existing;
        }
        if (this.#caching) this.cache.set(message.id, message);
        return message;
    }
    public delete(messageId: string): boolean {
        return this.cache.delete(messageId);
    }
}
