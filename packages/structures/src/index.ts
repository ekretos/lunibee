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
  public readonly createdAt: Date;
  public readonly attachments: import("@lunibee/types").APIAttachment[];
  public readonly embeds: import("@lunibee/types").APIEmbed[];
  public readonly mentions: User[];
  public readonly mentionRoles: string[];
  public pinned: boolean;
  public mentionEveryone: boolean;
  public type: number;
  public readonly reference?: import("@lunibee/types").APIMessageReference;
  public readonly referencedMessage?: Message | null;
  readonly #context?: ResourceContext;
  public constructor(data: import("@lunibee/types").APIMessage, context?: ResourceContext) {
    super(data.id);
    if (!/^\d{1,20}$/.test(data.channel_id)) throw new TypeError("Message channel_id must be a valid snowflake.");
    this.content = data.content ?? "";
    this.author = new User(data.author);
    this.channelId = data.channel_id;
    this.guildId = data.guild_id;
    this.flags = data.flags ?? 0;
    this.createdAt = new Date(data.timestamp ?? Number((BigInt(this.id) >> 22n) + 1420070400000n));
    this.attachments = data.attachments ?? [];
    this.embeds = data.embeds ?? [];
    this.mentions = (data.mentions ?? []).map((user) => new User(user));
    this.mentionRoles = data.mention_roles ?? [];
    this.pinned = data.pinned ?? false;
    this.mentionEveryone = data.mention_everyone ?? false;
    this.type = data.type ?? 0;
    this.reference = data.message_reference;
    this.referencedMessage = data.referenced_message ? new Message(data.referenced_message, context) : data.referenced_message === null ? null : undefined;
    this.#context = context;
    this.channel = new Channel({ id: data.channel_id, type: 0, guild_id: data.guild_id }, context);
  }
  public get embedsSuppressed(): boolean { return (this.flags & 4) !== 0; }
  public edit(options: Record<string, unknown> & { content?: string }): Promise<Message> {
    if (!this.#context) throw new Error("This message is not attached to a client.");
    return this.#context.editMessage(this.channelId, this.id, options);
  }
  public update(options: Record<string, unknown> & { content?: string }): Promise<Message> {
    return this.edit(options);
  }
  public delete(): Promise<void> {
    if (!this.#context) throw new Error("This message is not attached to a client.");
    return this.#context.deleteMessage(this.channelId, this.id);
  }
  public crosspost(): Promise<Message> {
    if (!this.#context) throw new Error("This message is not attached to a client.");
    return this.#context.crosspostMessage(this.channelId, this.id);
  }
  public reply(options: string | (Record<string, unknown> & { content?: string })): Promise<Message> {
    if (!this.#context) throw new Error("This message is not attached to a client.");
    const payload = typeof options === "string" ? { content: options } : { ...options };
    payload.message_reference = { message_id: this.id, channel_id: this.channelId, guild_id: this.guildId };
    return this.#context.sendMessage(this.channelId, payload);
  }
}

export { GuildMember, Role, TextChannel } from "./resources.js";
export * from "./interactions.js";
