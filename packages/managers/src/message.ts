import { Collection } from "@lunibee/collection";
import { assignFields } from "./base.js";

/** Opt-in per-channel message cache. Messages are temporary data, so they
 * use bounded TTL/LRU storage rather than permanent resource storage. */
export interface MessageCacheOptions {
    /** Messages kept per channel; least-recently-used are evicted. Default 100. */
    maxSize?: number;
    /** Sliding TTL in ms. Omit for no expiry. */
    ttl?: number;
}
import { REST, Routes, type RESTFileAttachment } from "@lunibee/rest";
import type {
    AllowedMentions,
    MessageCreateOptions,
    MessageEditOptions,
    MessageFile,
    MessageFileSource,
} from "@lunibee/types";
import { Message, type ResourceContext } from "@lunibee/structures";

export type {
    MessageCreateOptions,
    MessageEditOptions,
    MessageFile,
    MessageFileSource,
};

/**
 * Turns message files into REST uploads, encoding string data as UTF-8. A file
 * with `toBuffer()` (such as a `CreateAttachment`) is read when the request is sent.
 */
export function toAttachments(
    files: readonly (MessageFile | MessageFileSource)[],
): RESTFileAttachment[] {
    return files.map((file) =>
        "toBuffer" in file
            ? { name: file.name, data: file.toBuffer() }
            : {
                  name: file.name,
                  data:
                      typeof file.data === "string"
                          ? new TextEncoder().encode(file.data)
                          : file.data,
                  contentType: file.contentType,
              },
    );
}

/**
 * Splits `files` out of a message payload into a REST upload, encoding string
 * data as UTF-8. `allowedMentions` is the client's default, applied only when
 * the payload has no `allowed_mentions` of its own.
 */
/**
 * Refuses an `allowed_mentions` object Discord would answer with 400: a kind
 * both in `parse` and listed by id, an unknown `parse` value, or non-string ids.
 * @throws {TypeError} If the object is invalid.
 */
export function assertAllowedMentions(mentions: AllowedMentions): void {
    const parse = mentions.parse ?? [];
    for (const kind of parse)
        if (!["roles", "users", "everyone"].includes(kind))
            throw new TypeError(
                `allowed_mentions.parse has unknown value "${String(kind)}".`,
            );
    for (const [kind, list] of [
        ["users", mentions.users],
        ["roles", mentions.roles],
    ] as const) {
        if (list === undefined) continue;
        if (!Array.isArray(list) || list.some((id) => typeof id !== "string"))
            throw new TypeError(
                `allowed_mentions.${kind} must be an array of ID strings.`,
            );
        if (list.length > 100)
            throw new RangeError(
                `allowed_mentions.${kind} holds at most 100 IDs.`,
            );
        if (list.length > 0 && parse.includes(kind))
            throw new TypeError(
                `allowed_mentions cannot list ${kind} by ID and also parse "${kind}".`,
            );
    }
}

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
    if (body.allowed_mentions) assertAllowedMentions(body.allowed_mentions);
    if (!files?.length) return body;
    // Alt text travels in the payload's `attachments`, matched by index.
    if (body.attachments === undefined && files.some((f) => f.description))
        body.attachments = files.map((file, id) =>
            file.description ? { id, description: file.description } : { id },
        );
    return {
        body,
        files: toAttachments(files),
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
    /** In-flight fetches; `dirty` is set when the message is written or deleted meanwhile. */
    readonly #inflight = new Map<
        string,
        { promise: Promise<Message>; dirty: boolean }
    >();
    /**
     * Fetches a message. Concurrent fetches of one message share a request.
     * If the message is stored or deleted (e.g. by a Gateway event) while the
     * request is in flight, the result is returned but not cached, so it
     * cannot overwrite fresher state or bring back a deleted message.
     */
    public fetch(messageId: string): Promise<Message> {
        const pending = this.#inflight.get(messageId);
        if (pending) return pending.promise;
        const entry: { promise: Promise<Message>; dirty: boolean } = {
            promise: Promise.resolve(null as never),
            dirty: false,
        };
        this.#inflight.set(messageId, entry);
        entry.promise = this.#rest
            .get<ConstructorParameters<typeof Message>[0]>(
                Routes.message(this.#channelId, messageId),
            )
            .then(
                (data) => {
                    this.#inflight.delete(messageId);
                    return entry.dirty
                        ? (this.cache.peek(messageId) ??
                              new Message(data, this.#context))
                        : this.upsert(data);
                },
                (error: unknown) => {
                    this.#inflight.delete(messageId);
                    throw error;
                },
            );
        return entry.promise;
    }
    #markDirty(messageId: string): void {
        const pending = this.#inflight.get(messageId);
        if (pending) pending.dirty = true;
    }
    /** Stores a message as the cached version (when caching is on), replacing any cached one. @returns This manager. */
    public set(messageId: string, message: Message): this {
        this.#markDirty(messageId);
        if (this.#caching) this.cache.set(messageId, message);
        return this;
    }
    public fetchMany(messageIds: Iterable<string>): Promise<Message[]> {
        return Promise.all(
            Array.from(messageIds, (messageId) => this.fetch(messageId)),
        );
    }
    public upsert(data: ConstructorParameters<typeof Message>[0]): Message {
        this.#markDirty(data.id);
        const existing = this.cache.peek(data.id);
        const message = new Message(data, this.#context);
        if (existing) {
            assignFields(existing, message);
            return existing;
        }
        if (this.#caching) this.cache.set(message.id, message);
        return message;
    }
    public delete(messageId: string): boolean {
        this.#markDirty(messageId);
        return this.cache.delete(messageId);
    }
}
