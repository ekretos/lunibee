/** Resource structures for Discord messages and related entities. */
import { BaseStructure, Channel, User } from "./base.js";
import { GuildMember } from "./resources.js";
import type { ComponentInteraction } from "./interactions.js";
import type { Collector, CollectorOptions } from "@lunibee/core";

/** Interaction tokens last 15 minutes, so a component collector with no limit of its own stops then. */
const COMPONENT_COLLECTOR_DEFAULT_TIME = 15 * 60_000;

/** Options for {@link Message.createComponentCollector}. */
export interface ComponentCollectorOptions extends CollectorOptions<ComponentInteraction> {
    /** Only this component type (2 button, 3 string select...). */
    componentType?: number;
}
import type { ResourceContext } from "./base.js";

/** discord.js user-authored (non-system) message types: Default, Reply,
 * ChatInputCommand and ContextMenuCommand. Any other type is a system message. */
const NON_SYSTEM_MESSAGE_TYPES = new Set([0, 19, 20, 23]);

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
    /**
     * The author as a guild member, on guild messages from the Gateway. Its
     * `permissions` are computed from the cached roles; `member.kick()` and the
     * other member actions work when the message came from a client.
     */
    public member: GuildMember | null;
    readonly #context?: ResourceContext;

    /** Creates a message structure from Discord message data. */
    public constructor(
        data: import("@lunibee/types").APIMessage,
        context?: ResourceContext,
    ) {
        super(data.id);
        if (!/^\d{1,20}$/.test(data.channel_id))
            throw new TypeError(
                "Message channel_id must be a valid snowflake.",
            );
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
        this.member =
            data.member && data.guild_id
                ? new GuildMember(
                      {
                          ...data.member,
                          user: data.member.user ?? data.author,
                          guild_id: data.guild_id,
                      },
                      context,
                  )
                : null;
        this.channel = new Channel(
            { id: data.channel_id, type: 0, guild_id: data.guild_id },
            context,
        );
    }

    /** Whether embeds are suppressed on this message. */
    public get embedsSuppressed(): boolean {
        return (this.flags & 4) !== 0;
    }

    /** Unix timestamp (ms) at which the message was created — discord.js parity.
     * Derived from the message `timestamp`, which itself falls back to the id snowflake. */
    public get createdTimestamp(): number {
        return this.timestamp.getTime();
    }

    /** Date at which the message was created — discord.js parity. Overrides the
     * snowflake-only `BaseStructure.createdAt` to honour the message `timestamp`. */
    public override get createdAt(): Date {
        return this.timestamp;
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

    /**
     * Collects clicks and picks on this message's components. It always ends:
     * after `time`, or 15 minutes (an interaction token's life) when neither
     * `time` nor `idle` is set.
     * @example
     * const collector = message.createComponentCollector({ filter: (i) => i.user?.id === authorId, time: 60_000 });
     * collector.on("collect", (i) => i.update({ content: `Picked ${i.customId}` }));
     */
    public createComponentCollector(
        options: ComponentCollectorOptions = {},
    ): Collector<string, ComponentInteraction> {
        const collect = this.#context?.collectInteractions;
        if (!collect)
            throw new Error("This message is not attached to a client.");
        const { componentType, filter, ...rest } = options;
        return collect({
            ...rest,
            time:
                rest.time ??
                (rest.idle ? undefined : COMPONENT_COLLECTOR_DEFAULT_TIME),
            filter: async (interaction) =>
                interaction.isMessageComponent() &&
                interaction.messageId === this.id &&
                (componentType === undefined ||
                    interaction.componentType === componentType) &&
                (filter ? await filter(interaction) : true),
        }) as unknown as Collector<string, ComponentInteraction>;
    }

    /**
     * Waits for the next click or pick on this message's components.
     * @param options `time` (default 15 minutes), `filter`, `componentType`.
     * @returns The interaction. @throws {Error} When time runs out first.
     */
    public awaitComponent(
        options: Omit<ComponentCollectorOptions, "max"> = {},
    ): Promise<ComponentInteraction> {
        return this.createComponentCollector({ ...options, max: 1 }).next();
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
              ) ??
                  Promise.reject(
                      new Error("Reaction operations are unavailable."),
                  ))
            : (this.#context.removeOwnReaction?.(
                  this.channelId,
                  this.id,
                  emoji,
              ) ??
                  Promise.reject(
                      new Error("Reaction operations are unavailable."),
                  ));
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

    // ─── Flag-based getters ───────────────────────────────────────────────────────

    /** Whether this message was sent ephemerally (only visible to the recipient). */
    public get isEphemeral(): boolean {
        return (this.flags & 64) !== 0;
    }

    /** Whether this message is currently pinned in its channel. */
    public get isPinned(): boolean {
        return this.pinned;
    }

    /** Whether this is a system-generated message (join, boost, etc). Mirrors
     * discord.js: a message is "system" unless its type is one of the user-authored
     * types — Default (0), Reply (19), ChatInputCommand (20) or ContextMenuCommand (23). */
    public get isSystemMessage(): boolean {
        return !NON_SYSTEM_MESSAGE_TYPES.has(this.type);
    }

    /** Whether this message was crossposted from an announcement channel. */
    public get isCrosspost(): boolean {
        return (this.flags & 2) !== 0;
    }

    /** Whether this message has file attachments. */
    public get hasAttachments(): boolean {
        return this.attachments.length > 0;
    }

    /** Whether this message contains embeds. */
    public get hasEmbeds(): boolean {
        return this.embeds.length > 0;
    }

    /** Whether this message contains interactive components. */
    public get hasComponents(): boolean {
        return this.components.length > 0;
    }

    /** Edits this message to suppress its embeds. @returns The updated message. */
    public suppressEmbeds(): Promise<Message> {
        return this.edit({ flags: this.flags | 4 });
    }

    /** Returns a plain-object snapshot of all message fields. */
    public toJSON(): Record<string, unknown> {
        return {
            id: this.id,
            content: this.content,
            channelId: this.channelId,
            guildId: this.guildId,
            flags: this.flags,
            pinned: this.pinned,
            mentionEveryone: this.mentionEveryone,
            type: this.type,
            timestamp: this.timestamp.toISOString(),
            author: { id: this.author.id, username: this.author.username },
            attachments: [...this.attachments],
            embeds: [...this.embeds],
            components: [...this.components],
            mentions: this.mentions.map((u) => u.id),
            mentionRoles: [...this.mentionRoles],
            reference: this.reference,
            referencedMessage: this.referencedMessage
                ? this.referencedMessage.id
                : this.referencedMessage,
        };
    }
}

export {
    GuildMember,
    Role,
    TextChannel,
    Invite,
    Webhook,
    WebhookEnum,
    WebhookType,
    Emoji,
    AutoModerationRule,
    WelcomeScreenChannel,
    GuildWelcomeScreen,
    OnboardingPromptOption,
    OnboardingPrompt,
    GuildOnboarding,
} from "./resources.js";
export {
    NewsChannel,
    DMChannel,
    VoiceChannel,
    StageChannel,
    CategoryChannel,
    ThreadChannel,
    ForumChannel,
    MediaChannel,
    createChannel,
} from "./channels.js";
export * from "./interactions.js";
export { Embed } from "./embed.js";
export { AuditLog, AuditLogEntry } from "./audit-log.js";
// KI-4: PermissionsBitField lives canonically in @lunibee/core (single source of
// truth). Re-export it here for discord.js-style top-level access from structures,
// replacing the former structures-local duplicate.
export { PermissionsBitField } from "@lunibee/core";
