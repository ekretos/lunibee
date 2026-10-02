import { Collection } from "@lunibee/collection";

/** Opt-in per-channel message cache. Messages are temporary data, so they
 * use bounded TTL/LRU storage rather than permanent resource storage. */
export interface MessageCacheOptions {
    /** Messages kept per channel; least-recently-used are evicted. Default 100. */
    maxSize?: number;
    /** Sliding TTL in ms. Omit for no expiry. */
    ttl?: number;
}
import { REST, Routes, type RESTFileAttachment } from "@lunibee/rest";
import type { AllowedMentions } from "@lunibee/types";
import { Message, type ResourceContext } from "@lunibee/structures";

/** A file to upload with a message. */
export interface MessageFile {
    name: string;
    data: Blob | Uint8Array | ArrayBuffer | string;
    contentType?: string;
}

export type MessageCreateOptions = Record<string, unknown> & {
    content?: string;
    /** Files to upload; the message is sent as multipart. */
    files?: MessageFile[];
};
export type MessageEditOptions = MessageCreateOptions;

/**
 * Splits `files` out of a message payload into a REST upload, encoding string
 * data as UTF-8. `allowedMentions` is the client's default, applied only when
 * the payload has no `allowed_mentions` of its own.
 */
export function toRequest(
    options: MessageCreateOptions,
    allowedMentions?: AllowedMentions,
):
    | Omit<MessageCreateOptions, "files">
    | {
          body: Omit<MessageCreateOptions, "files">;
          files: RESTFileAttachment[];
      } {
    const { files, ...body } = options;
    if (allowedMentions !== undefined && body.allowed_mentions === undefined)
        body.allowed_mentions = allowedMentions;
    if (!files?.length) return body;
    return {
        body,
        files: files.map((file) => ({
            name: file.name,
            data:
                typeof file.data === "string"
                    ? new TextEncoder().encode(file.data)
                    : file.data,
            contentType: file.contentType,
        })),
    };
}

export class MessageManager {
    /** Cached messages; always empty unless a message cache is configured. */
    public readonly cache: Collection<string, Message>;
    readonly #caching: boolean;
    readonly #rest: REST;
    readonly #context: ResourceContext;
    readonly #channelId: string;

    /** The client's default `allowed_mentions`, for payloads without their own. */
    readonly #allowedMentions?: AllowedMentions;

    public constructor(
        rest: REST,
        context: ResourceContext,
        channelId: string,
        cache?: MessageCacheOptions,
        allowedMentions?: AllowedMentions,
    ) {
        if (!channelId) throw new TypeError("Channel ID is required.");
        this.#allowedMentions = allowedMentions;
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
        >(
            Routes.channelMessages(this.#channelId),
            toRequest(options, this.#allowedMentions),
        );
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
