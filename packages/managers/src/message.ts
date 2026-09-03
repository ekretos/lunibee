import { Collection } from "@lunibee/collection";
import { REST, Routes } from "@lunibee/rest";
import { Message, type ResourceContext } from "@lunibee/structures";

export type MessageCreateOptions = Record<string, unknown> & {
    content?: string;
};
export type MessageEditOptions = Record<string, unknown> & { content?: string };

export class MessageManager {
    public readonly cache = new Collection<string, Message>();
    readonly #rest: REST;
    readonly #context: ResourceContext;
    readonly #channelId: string;

    public constructor(
        rest: REST,
        context: ResourceContext,
        channelId: string,
    ) {
        if (!channelId) throw new TypeError("Channel ID is required.");
        this.#rest = rest;
        this.#context = context;
        this.#channelId = channelId;
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
        const existing = this.cache.get(data.id);
        const message = new Message(data, this.#context);
        if (existing) {
            Object.assign(existing, message);
            return existing;
        }
        this.cache.set(message.id, message);
        return message;
    }
    public delete(messageId: string): boolean {
        return this.cache.delete(messageId);
    }
}
