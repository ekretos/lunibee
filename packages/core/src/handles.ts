import type { Collection } from "@lunibee/collection";
import type { ChannelKind, UnknownChannelKind } from "@lunibee/types";
import type {
    BanOptions,
    ChannelEditOptions,
    GuildManager,
    MemberEditOptions,
    MessageCreateOptions,
    MessageEditOptions,
    MessageQueryOptions,
    RoleEditOptions,
} from "@lunibee/managers";
import type {
    Channel,
    ChannelOfKind,
    Guild,
    GuildMember,
    Message,
    Role,
    User,
} from "@lunibee/structures";
import type { Client } from "./index.js";
import {
    channelCreatePayload,
    type CreateChannelOptions,
} from "./channel-create.js";

/** A length of time: milliseconds, or text such as `"90s"`, `"10m"`, `"2h"`, `"1d"`, `"1w"` or `"1h30m"`. */
export type Duration = number | string;

const UNIT_MS: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
};

/**
 * Turns a {@link Duration} into milliseconds.
 * @throws {RangeError} If a number is negative or not finite, or the text is not a duration.
 */
export function parseDuration(value: Duration): number {
    if (typeof value === "number") {
        if (!Number.isFinite(value) || value < 0)
            throw new RangeError(
                "A duration must be a non-negative, finite number of milliseconds.",
            );
        return value;
    }
    const text = value.replace(/\s+/g, "").toLowerCase();
    if (!/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d|w))+$/.test(text))
        throw new RangeError(
            `Invalid duration: ${JSON.stringify(value)}. Use a number of milliseconds or text such as "90s", "10m" or "1h30m".`,
        );
    let total = 0;
    for (const [, amount, unit] of text.matchAll(
        /(\d+(?:\.\d+)?)(ms|s|m|h|d|w)/g,
    ))
        total += Number(amount) * UNIT_MS[unit!]!;
    return Math.round(total);
}

/** Message text, or a full payload. */
export type MessageInput = string | MessageCreateOptions;

function payload(input: MessageInput): MessageCreateOptions {
    return typeof input === "string" ? { content: input } : input;
}

/**
 * A reference to one Discord thing by its ids. A handle holds no data, so it
 * is cheap to create, can be made before the thing is cached, and fails only
 * when you use it.
 *
 * - `peek()` reads the cache and returns `undefined` when it is not there.
 * - `get()` reads the cache, and asks Discord when it is not there.
 * - `fetch()` asks Discord now and refreshes the cache.
 */
export interface Handle<T> {
    peek(): T | undefined;
    get(): Promise<T>;
    fetch(): Promise<T>;
}

/** A user, by id. Made by `bot.person(id)`. */
export class UserHandle implements Handle<User> {
    public constructor(
        private readonly bot: Client,
        public readonly id: string,
    ) {}

    public peek(): User | undefined {
        return this.bot.users.get(this.id);
    }
    public get(): Promise<User> {
        return this.bot.users.resolve(this.id);
    }
    public fetch(): Promise<User> {
        return this.bot.users.fetch(this.id);
    }

    /** Opens (or reuses) the direct-message channel with this user. */
    public async dm(): Promise<ChannelHandle> {
        const data = await this.bot.users.createDM(this.id);
        this.bot.channels.upsert(data);
        return new ChannelHandle(this.bot, data.id);
    }
    /** Sends this user a direct message. */
    public async send(message: MessageInput): Promise<Message> {
        return (await this.dm()).send(message);
    }
}

/** A guild, by id. Made by `bot.guild(id)`. */
export class GuildHandle implements Handle<Guild> {
    public constructor(
        private readonly bot: Client,
        public readonly id: string,
    ) {}

    public peek(): Guild | undefined {
        return this.bot.guilds.get(this.id);
    }
    public get(): Promise<Guild> {
        return this.bot.guilds.resolve(this.id);
    }
    public fetch(): Promise<Guild> {
        return this.bot.guilds.fetch(this.id);
    }

    /** The cached members, live: it changes as the Gateway updates them. */
    public get members(): Collection<string, GuildMember> {
        return this.bot.guilds.members(this.id).cache;
    }
    /** The cached roles, live. */
    public get roles(): Collection<string, Role> {
        return this.bot.guilds.roles(this.id).cache;
    }
    /** The cached channels of this guild, as a snapshot taken when you read it. */
    public get channels(): Collection<string, Channel> {
        return this.bot.channels.cache.filter(
            (channel) => channel.guildId === this.id,
        );
    }

    public member(userId: string): MemberHandle {
        return new MemberHandle(this.bot, this.id, userId);
    }
    public role(roleId: string): RoleHandle {
        return new RoleHandle(this.bot, this.id, roleId);
    }
    public channel(channelId: string): ChannelHandle {
        return new ChannelHandle(this.bot, channelId);
    }

    /**
     * Creates a channel. `kind` decides which other options apply, and the
     * result is typed to match: a `"voice"` option gives a `VoiceChannel`.
     * @example await bot.guild(id).createChannel({ kind: "text", name: "general", parent: categoryId });
     */
    public async createChannel<O extends CreateChannelOptions>(
        options: O,
    ): Promise<ChannelOfKind<O["kind"]>> {
        const channel = await this.bot.channels.create(
            this.id,
            channelCreatePayload(options),
        );
        return channel.as(options.kind) as ChannelOfKind<O["kind"]>;
    }

    /** Bans a user, whether or not they are a member. */
    public ban(userId: string, options?: BanOptions): Promise<void> {
        return this.bot.guilds.members(this.id).ban(userId, options);
    }
    /** Lifts a ban. */
    public unban(userId: string, reason?: string): Promise<void> {
        return this.bot.guilds.members(this.id).unban(userId, reason);
    }
    /** Changes the guild's settings; `reason` is the audit-log reason. */
    public edit(options: Parameters<GuildManager["edit"]>[1]): Promise<Guild> {
        return this.bot.guilds.edit(this.id, options);
    }
    /** Makes the bot leave the guild. */
    public leave(): Promise<void> {
        return this.bot.users.leaveGuild(this.id);
    }
}

/** A guild member, by guild id and user id. Made by `bot.member(guildId, userId)`. */
export class MemberHandle implements Handle<GuildMember> {
    public constructor(
        private readonly bot: Client,
        public readonly guildId: string,
        public readonly userId: string,
    ) {}

    private get members() {
        return this.bot.guilds.members(this.guildId);
    }

    public peek(): GuildMember | undefined {
        return this.members.get(this.userId);
    }
    public get(): Promise<GuildMember> {
        return this.members.resolve(this.userId);
    }
    public fetch(): Promise<GuildMember> {
        return this.members.fetch(this.userId);
    }

    public guild(): GuildHandle {
        return new GuildHandle(this.bot, this.guildId);
    }
    public user(): UserHandle {
        return new UserHandle(this.bot, this.userId);
    }

    public kick(reason?: string): Promise<void> {
        return this.members.kick(this.userId, reason);
    }
    public ban(options?: BanOptions): Promise<void> {
        return this.members.ban(this.userId, options);
    }
    public unban(reason?: string): Promise<void> {
        return this.members.unban(this.userId, reason);
    }
    /** Changes nickname, roles, mute or deafen; put the audit-log reason in `options.reason`. */
    public edit(options: MemberEditOptions): Promise<GuildMember> {
        return this.members.edit(this.userId, options);
    }
    public addRole(roleId: string, reason?: string): Promise<void> {
        return this.members.addRole(this.userId, roleId, reason);
    }
    public removeRole(roleId: string, reason?: string): Promise<void> {
        return this.members.removeRole(this.userId, roleId, reason);
    }
    /**
     * Times the member out for `duration` (`"10m"`, `"2h"`, 90_000), or lifts
     * the timeout with `null`.
     */
    public async timeout(
        duration: Duration | null,
        reason?: string,
    ): Promise<GuildMember> {
        return this.members.timeout(
            this.userId,
            duration === null ? null : parseDuration(duration),
            reason,
        );
    }
}

/** A role, by guild id and role id. Made by `bot.role(guildId, roleId)`. */
export class RoleHandle implements Handle<Role> {
    public constructor(
        private readonly bot: Client,
        public readonly guildId: string,
        public readonly roleId: string,
    ) {}

    private get roles() {
        return this.bot.guilds.roles(this.guildId);
    }

    public peek(): Role | undefined {
        return this.roles.get(this.roleId);
    }
    public get(): Promise<Role> {
        return this.roles.resolve(this.roleId);
    }
    public fetch(): Promise<Role> {
        return this.roles.fetch(this.roleId);
    }

    public edit(options: RoleEditOptions): Promise<Role> {
        return this.roles.edit(this.roleId, options);
    }
    public delete(reason?: string): Promise<void> {
        return this.roles.remove(this.roleId, reason);
    }
}

/** A channel, by id. Made by `bot.channel(id)`. */
export class ChannelHandle implements Handle<Channel> {
    public constructor(
        private readonly bot: Client,
        public readonly id: string,
    ) {}

    public peek(): Channel | undefined {
        return this.bot.channels.get(this.id);
    }
    public get(): Promise<Channel> {
        return this.bot.channels.resolve(this.id);
    }
    public fetch(): Promise<Channel> {
        return this.bot.channels.fetch(this.id);
    }

    public message(messageId: string): MessageHandle {
        return new MessageHandle(this.bot, this.id, messageId);
    }

    /**
     * Gets the channel (cache, else Discord) and returns it typed as one of
     * `kinds`.
     * @throws {TypeError} If it is a different kind.
     */
    public async as<K extends ChannelKind | UnknownChannelKind>(
        ...kinds: K[]
    ): Promise<ChannelOfKind<K>> {
        return (await this.get()).as(...kinds);
    }

    /** Sends a message: text, or a full payload (`embeds`, `components`, `files`, …). */
    public send(message: MessageInput): Promise<Message> {
        return this.bot.channels.send(this.id, payload(message));
    }
    /** Reads messages: the latest, or around / before / after one. */
    public messages(query: MessageQueryOptions = {}): Promise<Message[]> {
        return this.bot.channels.fetchMessages(this.id, query);
    }
    public edit(options: ChannelEditOptions): Promise<Channel> {
        return this.bot.channels.edit(this.id, options);
    }
    public delete(reason?: string): Promise<void> {
        return this.bot.channels.remove(this.id, reason);
    }
    /** Deletes up to 100 messages younger than 14 days. */
    public bulkDelete(
        messageIds: Iterable<string>,
        reason?: string,
    ): Promise<void> {
        return this.bot.channels.bulkDeleteMessages(
            this.id,
            messageIds,
            reason,
        );
    }
}

/** A message, by channel id and message id. Made by `bot.message(channelId, messageId)`. */
export class MessageHandle implements Handle<Message> {
    public constructor(
        private readonly bot: Client,
        public readonly channelId: string,
        public readonly messageId: string,
    ) {}

    public peek(): Message | undefined {
        return this.bot.channels
            .cachedMessages(this.channelId)
            ?.cache.peek(this.messageId);
    }
    public async get(): Promise<Message> {
        return this.peek() ?? this.fetch();
    }
    public fetch(): Promise<Message> {
        return this.bot.channels.fetchMessage(this.channelId, this.messageId);
    }

    public channel(): ChannelHandle {
        return new ChannelHandle(this.bot, this.channelId);
    }

    public edit(message: string | MessageEditOptions): Promise<Message> {
        return this.bot.channels.editMessage(
            this.channelId,
            this.messageId,
            typeof message === "string" ? { content: message } : message,
        );
    }
    public delete(reason?: string): Promise<void> {
        return this.bot.channels.deleteMessage(
            this.channelId,
            this.messageId,
            reason,
        );
    }
    /** Sends a message that replies to this one. */
    public reply(message: MessageInput): Promise<Message> {
        return this.bot.channels.send(this.channelId, {
            ...payload(message),
            message_reference: {
                message_id: this.messageId,
                channel_id: this.channelId,
            },
        });
    }
    /** Adds the bot's reaction (`"👍"`, or `"name:id"` for a custom emoji). */
    public react(emoji: string): Promise<void> {
        return this.bot.channels.addReaction(
            this.channelId,
            this.messageId,
            emoji,
        );
    }
    public pin(reason?: string): Promise<void> {
        return this.bot.channels.pinMessage(
            this.channelId,
            this.messageId,
            reason,
        );
    }
    public unpin(reason?: string): Promise<void> {
        return this.bot.channels.unpinMessage(
            this.channelId,
            this.messageId,
            reason,
        );
    }
    /** Publishes the message from an announcement channel. */
    public crosspost(): Promise<Message> {
        return this.bot.channels.crosspostMessage(
            this.channelId,
            this.messageId,
        );
    }
}
