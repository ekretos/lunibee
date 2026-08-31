/** Resource structures for Discord messages and related entities. */
import { BaseStructure, Channel, User } from "./base.js";
import type { ResourceContext } from "./base.js";

export { BaseStructure, Channel, Guild, User } from "./base.js";
export type { ResourceContext } from "./base.js";

export class Message extends BaseStructure {
  public content: string;
  public author: User;
  public channelId: string;
  public readonly channel: Channel;
  public guildId?: string;
  public flags: number;
  /** Message creation timestamp (from timestamp field or snowflake). */
  public readonly timestamp: Date;
  public readonly attachments: import("@lunibee/types").APIAttachment[];
  public readonly embeds: import("@lunibee/types").APIEmbed[];
  public readonly mentions: User[];
  public readonly mentionRoles: string[];
  public pinned: boolean;
  public mentionEveryone: boolean;
  public type: number;
  public readonly reference?: import("@lunibee/types").APIMessageReference;
  public readonly components: import("@lunibee/types").APIMessageComponent[];
  public readonly referencedMessage?: Message | null;
  readonly #context?: ResourceContext;

  /** Creates a message structure from Discord message data. */
  public constructor(
    data: import("@lunibee/types").APIMessage,
    context?: ResourceContext,
  ) {
    super(data.id);
    if (!/^\d{1,20}$/.test(data.channel_id))
      throw new TypeError("Message channel_id must be a valid snowflake.");
    this.content = data.content ?? "";
    this.author = new User(data.author);
    this.channelId = data.channel_id;
    this.guildId = data.guild_id;
    this.flags = data.flags ?? 0;
    this.timestamp = new Date(
      data.timestamp ?? Number((BigInt(this.id) >> 22n) + 1420070400000n),
    );
    this.attachments = data.attachments ?? [];
    this.embeds = data.embeds ?? [];
    this.components = data.components ?? [];
    this.mentions = (data.mentions ?? []).map((user) => new User(user));
    this.mentionRoles = data.mention_roles ?? [];
    this.pinned = data.pinned ?? false;
    this.mentionEveryone = data.mention_everyone ?? false;
    this.type = data.type ?? 0;
    this.reference = data.message_reference;
    this.referencedMessage = data.referenced_message
      ? new Message(data.referenced_message, context)
      : data.referenced_message === null
        ? null
        : undefined;
    this.#context = context;
    this.channel = new Channel(
      { id: data.channel_id, type: 0, guild_id: data.guild_id },
      context,
    );
  }

  /** Whether embeds are suppressed on this message. */
  public get embedsSuppressed(): boolean {
    return (this.flags & 4) !== 0;
  }

  /** Edits this message. @param options Message fields to change. @returns The updated message. @throws {Error} If the message is not attached to a client. */
  public edit(
    options: Record<string, unknown> & { content?: string },
  ): Promise<Message> {
    if (!this.#context)
      throw new Error("This message is not attached to a client.");
    return this.#context.editMessage(this.channelId, this.id, options);
  }

  /** Updates this message using the same resource operation as edit. @param options Message fields to change. @returns The updated message. @throws {Error} If the message is not attached to a client. */
  public update(
    options: Record<string, unknown> & { content?: string },
  ): Promise<Message> {
    return this.edit(options);
  }

  /** Deletes this message. @returns A promise fulfilled when Discord confirms deletion. @throws {Error} If the message is not attached to a client. */
  public delete(): Promise<void> {
    if (!this.#context)
      throw new Error("This message is not attached to a client.");
    return this.#context.deleteMessage(this.channelId, this.id);
  }

  /** Replies to this message. @param options Message content or payload. @returns The created reply message. @throws {Error} If the message is not attached to a client. */
  public reply(
    options: string | (Record<string, unknown> & { content?: string }),
  ): Promise<Message> {
    if (!this.#context)
      throw new Error("This message is not attached to a client.");
    const payload =
      typeof options === "string" ? { content: options } : { ...options };
    payload.message_reference = {
      message_id: this.id,
      channel_id: this.channelId,
      guild_id: this.guildId,
    };
    return this.#context.sendMessage(this.channelId, payload);
  }

  /** Crossposts this message. @returns The resulting message. @throws {Error} If the message is not attached to a client. */
  public crosspost(): Promise<Message> {
    if (!this.#context)
      throw new Error("This message is not attached to a client.");
    return this.#context.crosspostMessage(this.channelId, this.id);
  }

  /** Adds a reaction to this message. @param emoji Emoji identifier. @returns A promise fulfilled when the reaction is added. @throws {Error} If reactions are unavailable. */
  public react(emoji: string): Promise<void> {
    if (!this.#context?.addReaction)
      throw new Error("This message is not attached to a client.");
    return this.#context.addReaction(this.channelId, this.id, emoji);
  }

  /** Removes a reaction from this message. @param emoji Emoji identifier. @param userId User whose reaction should be removed; omit to remove the current user's reaction. @returns A promise fulfilled when the reaction is removed. @throws {Error} If reaction operations are unavailable. */
  public removeReaction(emoji: string, userId?: string): Promise<void> {
    if (!this.#context)
      throw new Error("This message is not attached to a client.");
    return userId
      ? (this.#context.removeReaction?.(
          this.channelId,
          this.id,
          emoji,
          userId,
        ) ?? Promise.reject(new Error("Reaction operations are unavailable.")))
      : (this.#context.removeOwnReaction?.(this.channelId, this.id, emoji) ??
          Promise.reject(new Error("Reaction operations are unavailable.")));
  }

  /** Removes all reactions from this message. @returns A promise fulfilled when reactions are removed. @throws {Error} If reaction operations are unavailable. */
  public removeAllReactions(): Promise<void> {
    if (!this.#context?.removeAllReactions)
      throw new Error("This message is not attached to a client.");
    return this.#context.removeAllReactions(this.channelId, this.id);
  }

  /** Pins this message. @returns A promise fulfilled when the message is pinned. @throws {Error} If pin operations are unavailable. */
  public pin(): Promise<void> {
    if (!this.#context?.pinMessage)
      throw new Error("This message is not attached to a client.");
    return this.#context.pinMessage(this.channelId, this.id);
  }

  /** Unpins this message. @returns A promise fulfilled when the message is unpinned. @throws {Error} If pin operations are unavailable. */
  public unpin(): Promise<void> {
    if (!this.#context?.unpinMessage)
      throw new Error("This message is not attached to a client.");
    return this.#context.unpinMessage(this.channelId, this.id);
  }
}

export { GuildMember, Role, TextChannel } from "./resources.js";
export * from "./interactions.js";
export { Embed } from "./embed.js";
