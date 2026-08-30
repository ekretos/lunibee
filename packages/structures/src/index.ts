import { BaseStructure, Channel, User } from "./base.js";
import type { ResourceContext } from "./base.js";

/** Common Discord structure exports. */
export { BaseStructure, Channel, Guild, User } from "./base.js";
export type { ResourceContext } from "./base.js";

/** Represents a Discord message. */
export class Message extends BaseStructure {
  /** Message content. */ public content: string;
  /** Message author. */ public author: User;
  /** Channel ID containing the message. */ public channelId: string;
  /** Channel containing the message. */ public readonly channel: Channel;
  /** Guild ID containing the message. */ public guildId?: string;
  /** Message flags. */ public flags: number;
  /** Message creation time. */ public readonly createdAt: Date;
  /** Message attachments. */ public readonly attachments: import("@lunibee/types").APIAttachment[];
  /** Message embeds. */ public readonly embeds: import("@lunibee/types").APIEmbed[];
  /** Mentioned users. */ public readonly mentions: User[];
  /** Mentioned role IDs. */ public readonly mentionRoles: string[];
  /** Whether the message is pinned. */ public pinned: boolean;
  /** Whether the message mentions everyone. */ public mentionEveryone: boolean;
  /** Discord message type. */ public type: number;
  /** Message reference (reply chain data). */ public readonly reference?: import("@lunibee/types").APIMessageReference;
  /** The referenced/replied-to message, if included by Discord. */ public readonly referencedMessage?: Message | null;
  readonly #context?: ResourceContext;
  /** Creates a message from Discord API data. @param data Message payload. @param context Optional owning resource context. @throws {TypeError} If required message identifiers are invalid. */
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
    this.createdAt = new Date(
      data.timestamp ?? Number((BigInt(this.id) >> 22n) + 1420070400000n),
    );
    this.attachments = data.attachments ?? [];
    this.embeds = data.embeds ?? [];
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
  /** Whether embeds are suppressed. @returns True when the suppress-embeds flag is set. */ public get embedsSuppressed(): boolean {
    return (this.flags & 4) !== 0;
  }
  /** Edits this message. @param options Edit payload. @returns Updated message. @throws {Error} If detached from a client. */ public edit(options: {
    content?: string;
  }): Promise<Message> {
    if (!this.#context)
      throw new Error("This message is not attached to a client.");
    return this.#context.editMessage(this.channelId, this.id, options);
  }
  /** Deletes this message. @returns Nothing. @throws {Error} If detached from a client. */ public delete(): Promise<void> {
    if (!this.#context)
      throw new Error("This message is not attached to a client.");
    return this.#context.deleteMessage(this.channelId, this.id);
  }
  /** Crossposts this message. @returns Crossposted message. @throws {Error} If detached from a client. */ public crosspost(): Promise<Message> {
    if (!this.#context)
      throw new Error("This message is not attached to a client.");
    return this.#context.crosspostMessage(this.channelId, this.id);
  }
  /** Replies in this message's channel, auto-populating message_reference. @param options Message content or payload. @returns Created reply. @throws {Error} If detached from a client. */ public reply(
    options: string | { content?: string; [key: string]: unknown },
  ): Promise<Message> {
    if (!this.#context)
      throw new Error("This message is not attached to a client.");
    const payload =
      typeof options === "string" ? { content: options } : { ...options };
    // Automatically thread the reply via Discord's message_reference
    (payload as Record<string, unknown>).message_reference = {
      message_id: this.id,
      channel_id: this.channelId,
      guild_id: this.guildId,
    };
    return this.#context.sendMessage(this.channelId, payload);
  }
}

export { GuildMember, Role, TextChannel } from "./resources.js";
export * from "./interactions.js";
