import { REST, Routes } from "@lunibee/rest";
import { Channel, type ResourceContext } from "@lunibee/structures";

/** Manages thread resources created from a parent channel. */
export class ThreadManager {
  readonly #rest: REST;
  readonly #context: ResourceContext;
  readonly #channelId: string;
  /** Creates a thread manager. @param rest REST transport. @param context Structure resource context. @param channelId Parent channel identifier. @throws {TypeError} If channelId is empty. */
  public constructor(rest: REST, context: ResourceContext, channelId: string) {
    if (!channelId) throw new TypeError("Channel ID is required.");
    this.#rest = rest;
    this.#context = context;
    this.#channelId = channelId;
  }
  /** Creates a thread from a message. @param messageId Message identifier. @param options Thread creation options. @returns Created thread channel. @throws {Error} If REST rejects the request. */
  public async createFromMessage(
    messageId: string,
    options: {
      name: string;
      autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
      rateLimitPerUser?: number;
    },
  ): Promise<Channel> {
    const data = await this.#rest.post<
      ConstructorParameters<typeof Channel>[0]
    >(Routes.messageThread(this.#channelId, messageId), {
      name: options.name,
      auto_archive_duration: options.autoArchiveDuration,
      rate_limit_per_user: options.rateLimitPerUser,
    });
    return new Channel(data, this.#context);
  }
}
