import { REST, Routes } from "@lunibee/rest";
import { Message, type ResourceContext } from "@lunibee/structures";

/** Manages message resources belonging to a single channel. */
export class MessageManager {
    readonly #rest: REST;
    readonly #context: ResourceContext;
    readonly #channelId: string;
    /** Creates a message manager. @param rest REST transport. @param context Structure resource context. @param channelId Channel identifier. @throws {TypeError} If channelId is empty. */
    public constructor(rest: REST, context: ResourceContext, channelId: string) { if (!channelId) throw new TypeError("Channel ID is required."); this.#rest = rest; this.#context = context; this.#channelId = channelId; }
    /** Sends a message in the managed channel. @param options Message creation payload. @returns Created message. @throws {Error} If REST rejects the request. */
    public async send(options: { content?: string }): Promise<Message> { const data = await this.#rest.post<ConstructorParameters<typeof Message>[0]>(Routes.channelMessages(this.#channelId), options); return new Message(data, this.#context); }
    /** Fetches a message by ID. @param messageId Message identifier. @returns Hydrated message. @throws {Error} If REST rejects the request. */
    public async fetch(messageId: string): Promise<Message> { const data = await this.#rest.get<ConstructorParameters<typeof Message>[0]>(Routes.message(this.#channelId, messageId)); return new Message(data, this.#context); }
    /** Deletes a message by ID. @param messageId Message identifier. @returns Promise fulfilled after deletion. @throws {Error} If REST rejects the request. */
    public async delete(messageId: string): Promise<void> { await this.#rest.delete(Routes.message(this.#channelId, messageId)); }
}
