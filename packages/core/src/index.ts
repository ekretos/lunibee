export {
    Permission,
    Permissions,
    PermissionFlagsBits,
    PermissionSet,
    PermissionsBitField,
    PermissionOverwriteEnum,
    PermissionOverwriteType,
    computePermissions,
    type PermissionContext,
    type PermissionOverwrite,
    type PermissionRole,
    type PermissionName,
} from "./permissions.js";
export {
    ClientEvent,
    /** Discord.js-familiar alias for {@link ClientEvent}. */
    ClientEvent as Events,
    type ClientEventName,
    type ClientEvents,
    type ClientListener,
} from "./events.js";
export { Collector, type CollectorOptions } from "./collector.js";
export {
    GatewayIntentBits,
    IntentBits,
    Intents,
    IntentsBitField,
    resolveGatewayIntents,
    type GatewayIntentResolvable,
} from "@lunibee/types";

import {
    ApplicationCommandManager,
    ChannelManager,
    GuildManager,
    MonetizationManager,
    StageInstanceManager,
    UserManager,
    toRequest,
} from "@lunibee/managers";
import { REST, Routes } from "@lunibee/rest";
import {
    User,
    GuildMember,
    Role,
    Emoji,
    type Channel,
    createChannel,
    Message,
    createInteraction,
    type InteractionClient,
    type InteractionData,
    type ResourceContext,
} from "@lunibee/structures";
import { Gateway } from "@lunibee/ws";
import type {
    APIEntitlement,
    APISoundboardSound,
    APIChannel,
    APIGuild,
    APIGuildMember,
    APIGuildRoleEvent,
    APIGuildRoleDeleteEvent,
    APIGuildBanEvent,
    APIGuildEmojisUpdateEvent,
    APIGuildStickersUpdateEvent,
    APIMessageDeleteBulkEvent,
    APIMessageDeleteEvent,
    APIMessageReactionEvent,
    APIMessageReactionRemoveEmojiEvent,
    APIReadyEvent,
    APIRole,
    APIThreadEvent,
    APIThreadListSync,
    APIThreadMembersUpdate,
    APIVoiceState,
    APIVoiceServerUpdate,
    APIPresenceUpdate,
    APITypingStart,
    APIInviteCreate,
    APIInviteDelete,
    APIWebhooksUpdate,
    APIAutoModerationRule,
    APIAutoModerationActionExecution,
    APIGuildScheduledEvent,
    APIGuildScheduledEventUserEvent,
    APIStageInstance,
    APIChannelPinsUpdate,
    APIGuildMembersChunk,
    APIMessagePollVoteEvent,
    ClientOptions,
    ClientUser,
} from "@lunibee/types";
import { ClientEvent, type ClientEvents } from "./events.js";
import { Collector, type CollectorOptions } from "./collector.js";
import { computePermissions, PermissionSet } from "./permissions.js";

/** Lifecycle state of a client. */
export type ClientState = "idle" | "connecting" | "ready" | "destroyed";
type Listener<T extends unknown[]> = (...args: T) => unknown;
type GuildMemberEvent = APIGuildMember & { guild_id: string };

/** Minimal typed event emitter used by the client. */
class EventEmitter<Events extends { [K in keyof Events]: unknown[] }> {
    #listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};
    /** Removes secrets from text this emitter prints; the client removes its token. */
    protected readonly redactSecrets = (text: string): string => text;
    public on<K extends keyof Events>(
        event: K,
        listener: Listener<Events[K]>,
    ): this {
        if (typeof listener !== "function")
            throw new TypeError("Event listener must be a function.");
        (this.#listeners[event] ??= new Set()).add(listener);
        return this;
    }
    public once<K extends keyof Events>(
        event: K,
        listener: Listener<Events[K]>,
    ): this {
        const wrapped: Listener<Events[K]> = (...args) => {
            this.off(event, wrapped);
            return listener(...args);
        };
        return this.on(event, wrapped);
    }
    public off<K extends keyof Events>(
        event: K,
        listener: Listener<Events[K]>,
    ): this {
        this.#listeners[event]?.delete(listener);
        return this;
    }
    /** Alias of {@link off}, provided for Node.js/Discord.js familiarity. */
    public removeListener<K extends keyof Events>(
        event: K,
        listener: Listener<Events[K]>,
    ): this {
        return this.off(event, listener);
    }
    public removeAllListeners<K extends keyof Events>(event?: K): this {
        if (event === undefined) this.#listeners = {};
        else delete this.#listeners[event];
        return this;
    }
    protected emit<K extends keyof Events>(
        event: K,
        ...args: Events[K]
    ): boolean {
        const listeners = this.#listeners[event];
        if (!listeners?.size) return false;
        for (const listener of [...listeners]) {
            try {
                const result = listener(...args);
                if (
                    result &&
                    typeof (result as PromiseLike<unknown>).then === "function"
                )
                    void Promise.resolve(result).catch((error) =>
                        this.#handleError(event, error),
                    );
            } catch (error) {
                this.#handleError(event, error);
            }
        }
        return true;
    }
    /** Sends a listener's error to the `error` listeners. When there are none, or
     * an `error` listener itself fails, it becomes a process warning instead of
     * disappearing (never a new `error` event, so it cannot loop). */
    #handleError(event: keyof Events, error: unknown): void {
        const normalized =
            error instanceof Error
                ? error
                : new Error(String(error), { cause: error });
        // Every emitter in this file declares `error: [Error]`.
        const errorListeners = this.#listeners[
            ClientEvent.Error as keyof Events
        ] as Set<Listener<[Error]>> | undefined;
        const listeners =
            event === ClientEvent.Error ? [] : [...(errorListeners ?? [])];
        if (listeners.length === 0)
            return warnListenerError(event, normalized, this.redactSecrets);
        for (const listener of listeners) {
            try {
                const result = listener(normalized);
                if (
                    result &&
                    typeof (result as PromiseLike<unknown>).then === "function"
                )
                    void Promise.resolve(result).catch((failure) =>
                        warnListenerError(
                            ClientEvent.Error,
                            failure,
                            this.redactSecrets,
                        ),
                    );
            } catch (failure) {
                warnListenerError(
                    ClientEvent.Error,
                    failure,
                    this.redactSecrets,
                );
            }
        }
    }
}

/** Reports an error no listener handled as a process warning (stderr by default), with secrets removed. */
function warnListenerError(
    event: PropertyKey,
    error: unknown,
    redact: (text: string) => string = (text) => text,
): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    process.emitWarning(
        redact(
            `A "${String(event)}" listener threw and no error listener handled it: ${failure.message}`,
        ),
        {
            type: "LunibeeWarning",
            code: "LUNIBEE_UNHANDLED_LISTENER_ERROR",
            detail:
                failure.stack === undefined ? undefined : redact(failure.stack),
        },
    );
}

/** Main Lunibee Discord client. */
export class Client
    extends EventEmitter<ClientEvents>
    implements InteractionClient
{
    public readonly rest: REST;
    public readonly users: UserManager;
    public readonly guilds: GuildManager;
    public readonly channels: ChannelManager;
    /** Stage instances, cached by stage channel ID. */
    public readonly stageInstances: StageInstanceManager;
    public readonly application: { commands: ApplicationCommandManager };
    /** SKUs, entitlements and subscriptions; available after READY (application ID known). */
    public monetization?: MonetizationManager;
    public get ws(): Gateway {
        return this.#gateway;
    }
    public get gateway(): Gateway {
        return this.#gateway;
    }
    public user?: ClientUser;
    public readyAt?: Date;
    public state: ClientState = "idle";
    /**
     * The bot token this client is authenticated with, or `null` once the
     * client has been destroyed. Mirrors `Client#token` in Discord.js.
     */
    /** Replaces the bot token in text Lunibee prints (listener warnings). */
    protected override readonly redactSecrets = (text: string): string => {
        const token = this.options.token;
        return token && token.length >= 8
            ? text.split(token).join("[token]")
            : text;
    };
    public get token(): string | null {
        return this.state === "destroyed" ? null : (this.options.token ?? null);
    }
    public get uptime(): number | null {
        return this.readyAt ? Date.now() - this.readyAt.getTime() : null;
    }
    public get ping(): number {
        return this.#gateway.ping;
    }
    /** Whether the client is ready and connected. */
    public isReady(): boolean {
        return this.state === "ready";
    }
    /** Sets the bot's presence / status. @param data Presence payload. @returns Whether the payload was sent. */
    public setPresence(
        data: import("@lunibee/types").GatewayPresence,
    ): boolean {
        return this.#gateway.setPresence(data);
    }
    /** Sends a voice state update. @param data Voice state payload. @returns Whether it was sent. */
    public setVoiceState(data: Record<string, unknown>): boolean {
        return this.#gateway.setVoiceState(data);
    }
    /** Requests guild members. @param data Guild member request payload. @returns Whether it was sent. */
    public requestGuildMembers(data: Record<string, unknown>): boolean {
        return this.#gateway.requestGuildMembers(data);
    }
    readonly #gateway: Gateway;
    /** Which resources Gateway events are allowed to cache. */
    readonly #cache: Required<NonNullable<ClientOptions["cache"]>>;
    readonly #resourceContext: ResourceContext;

    public constructor(public readonly options: ClientOptions) {
        super();
        if (!options.token?.trim())
            throw new TypeError("Client token is required.");
        this.rest = new REST({ token: options.token, ...options.rest });
        this.#cache = {
            users: true,
            members: true,
            roles: true,
            emojis: true,
            ...options.cache,
        };
        this.users = new UserManager(this.rest);
        this.guilds = new GuildManager(this.rest);
        this.channels = new ChannelManager(this.rest, {
            messageCache: options.messageCache,
            allowedMentions: options.allowedMentions,
        });
        this.stageInstances = new StageInstanceManager(this.rest);
        const placeholderAppCommands = new ApplicationCommandManager(
            this.rest,
            "0",
        );
        this.application = { commands: placeholderAppCommands };
        this.#resourceContext = {
            sendMessage: (channelId, options) =>
                this.channels.send(channelId, options),
            editMessage: (channelId, messageId, options) =>
                this.channels.editMessage(channelId, messageId, options),
            deleteMessage: (channelId, messageId, reason) =>
                this.channels.deleteMessage(channelId, messageId, reason),
            crosspostMessage: (channelId, messageId) =>
                this.channels.crosspostMessage(channelId, messageId),
            editChannel: (channelId, options) =>
                this.channels.edit(channelId, options),
            deleteChannel: (channelId, reason) =>
                this.channels.remove(channelId, reason),
            addReaction: (channelId, messageId, emoji) =>
                this.channels.addReaction(channelId, messageId, emoji),
            removeOwnReaction: (channelId, messageId, emoji) =>
                this.channels.removeOwnReaction(channelId, messageId, emoji),
            removeReaction: (channelId, messageId, emoji, userId) =>
                this.channels.removeReaction(
                    channelId,
                    messageId,
                    emoji,
                    userId,
                ),
            removeAllReactions: (channelId, messageId) =>
                this.channels.removeAllReactions(channelId, messageId),
            pinMessage: (channelId, messageId, reason) =>
                this.channels.pinMessage(channelId, messageId, reason),
            unpinMessage: (channelId, messageId, reason) =>
                this.channels.unpinMessage(channelId, messageId, reason),
            collectInteractions: (options) =>
                this.createCollector(ClientEvent.InteractionCreate, options),
            memberPermissions: (
                guildId,
                memberId,
                roleIds,
                channelId,
                timedOutUntil,
            ) =>
                this.#memberPermissions(
                    guildId,
                    memberId,
                    roleIds,
                    channelId,
                    timedOutUntil,
                ),
            kickMember: (guildId, userId, reason) =>
                this.guilds.members(guildId).kick(userId, reason),
            banMember: (guildId, userId, options) =>
                this.guilds.members(guildId).ban(userId, options),
            editMember: (guildId, userId, options, reason) =>
                this.guilds.members(guildId).edit(userId, options, reason),
            addMemberRole: (guildId, userId, roleId, reason) =>
                this.guilds.members(guildId).addRole(userId, roleId, reason),
            removeMemberRole: (guildId, userId, roleId, reason) =>
                this.guilds.members(guildId).removeRole(userId, roleId, reason),
            editPermissionOverwrite: async (
                channelId,
                targetId,
                changes,
                options,
            ) => {
                const bits = { allow: 0n, deny: 0n, inherit: 0n };
                for (const [name, value] of Object.entries(changes)) {
                    // Names only: a number or bit string here is a mistake, not a permission.
                    if (!/^[A-Za-z]+$/.test(name))
                        throw new TypeError(`Unknown permission: ${name}`);
                    let bit: bigint;
                    try {
                        bit = new PermissionSet(name).bitfield;
                    } catch {
                        throw new TypeError(`Unknown permission: ${name}`);
                    }
                    const key =
                        value === true
                            ? "allow"
                            : value === false
                              ? "deny"
                              : "inherit";
                    bits[key] |= bit;
                }
                return this.channels
                    .permissionOverwrites(channelId)
                    .update(targetId, bits, options);
            },
        };
        this.guilds.attachContext(this.#resourceContext);
        this.#gateway = new Gateway({
            token: options.token,
            intents: options.intents,
            ...options.gateway,
        });

        // ── Lifecycle ────────────────────────────────────────────────────────────
        this.#gateway.on("READY", (data) => {
            const ready = data as APIReadyEvent;
            this.user = ready.user;
            this.users.set(this.user.id, new User(this.user));
            this.readyAt = new Date();
            this.state = "ready";
            const appId = ready.application?.id ?? this.user.id;
            (
                this.application as { commands: ApplicationCommandManager }
            ).commands = new ApplicationCommandManager(this.rest, appId);
            if (this.monetization?.applicationId !== appId)
                this.monetization = new MonetizationManager(this.rest, appId);
            this.emit(ClientEvent.Ready, this.user);
        });
        this.#gateway.on("RESUMED", () => {
            this.state = "ready";
            this.emit(ClientEvent.Resumed);
        });
        this.#gateway.on("invalidSession", (isRecoverable) => {
            this.emit(ClientEvent.InvalidSession, isRecoverable as boolean);
        });
        this.#gateway.on("open", () => this.emit(ClientEvent.Open));
        this.#gateway.on("close", (data) => {
            if (this.state !== "destroyed") this.state = "idle";
            this.emit(
                ClientEvent.Close,
                data as { code: number; action: string },
            );
        });

        // ── Messages ─────────────────────────────────────────────────────────────
        this.#gateway.on("MESSAGE_CREATE", (data) => {
            const payload = data as import("@lunibee/types").APIMessage;
            const message = new Message(payload, this.#resourceContext);
            this.#observeMessage(message);
            // The author's member (roles, nickname) comes with every guild
            // message; keep the cached member current with it.
            if (
                payload.member &&
                payload.guild_id &&
                this.guilds.has(payload.guild_id)
            )
                this.#upsertMember(payload.guild_id, {
                    ...payload.member,
                    user: payload.member.user ?? payload.author,
                } as APIGuildMember);
            // With messageCache enabled, Gateway messages enter the bounded
            // cache so later edits and deletes can see the previous content;
            // listeners get the cached instance.
            const cached = this.options.messageCache
                ? this.channels
                      .messages(message.channelId)
                      .upsert(data as import("@lunibee/types").APIMessage)
                : message;
            this.emit(ClientEvent.MessageCreate, cached);
        });
        this.#gateway.on("MESSAGE_UPDATE", (data) => {
            const message = new Message(
                data as import("@lunibee/types").APIMessage,
                this.#resourceContext,
            );
            this.#observeMessage(message);
            // The cached message is replaced, not merged, so listeners receive
            // the previous version intact alongside the new one.
            const messages = this.channels.cachedMessages(message.channelId);
            const previous = messages?.cache.peek(message.id);
            if (previous) messages!.cache.set(message.id, message);
            this.emit(ClientEvent.MessageUpdate, message, previous);
        });
        this.#gateway.on("MESSAGE_DELETE", (data) => {
            const payload = data as APIMessageDeleteEvent;
            const messages = this.channels.cachedMessages(payload.channel_id);
            const removed = messages?.cache.peek(payload.id);
            messages?.delete(payload.id);
            this.emit(ClientEvent.MessageDelete, payload, removed);
        });
        this.#gateway.on("MESSAGE_DELETE_BULK", (data) => {
            const payload = data as APIMessageDeleteBulkEvent;
            const messages = this.channels.cachedMessages(payload.channel_id);
            const removed: Message[] = [];
            if (messages)
                for (const id of payload.ids) {
                    const message = messages.cache.peek(id);
                    if (message) removed.push(message);
                    messages.delete(id);
                }
            this.emit(ClientEvent.MessageDeleteBulk, payload, removed);
        });

        // ── Reactions ────────────────────────────────────────────────────────────
        this.#gateway.on("MESSAGE_REACTION_ADD", (data) =>
            this.emit(
                ClientEvent.MessageReactionAdd,
                data as APIMessageReactionEvent,
            ),
        );
        this.#gateway.on("MESSAGE_REACTION_REMOVE", (data) =>
            this.emit(
                ClientEvent.MessageReactionRemove,
                data as APIMessageReactionEvent,
            ),
        );
        this.#gateway.on("MESSAGE_REACTION_REMOVE_ALL", (data) =>
            this.emit(
                ClientEvent.MessageReactionRemoveAll,
                data as APIMessageDeleteEvent,
            ),
        );
        this.#gateway.on("MESSAGE_REACTION_REMOVE_EMOJI", (data) =>
            this.emit(
                ClientEvent.MessageReactionRemoveEmoji,
                data as APIMessageReactionRemoveEmojiEvent,
            ),
        );

        // ── Polls ────────────────────────────────────────────────────────────────
        this.#gateway.on("MESSAGE_POLL_VOTE_ADD", (data) =>
            this.emit(
                ClientEvent.MessagePollVoteAdd,
                data as APIMessagePollVoteEvent,
            ),
        );
        this.#gateway.on("MESSAGE_POLL_VOTE_REMOVE", (data) =>
            this.emit(
                ClientEvent.MessagePollVoteRemove,
                data as APIMessagePollVoteEvent,
            ),
        );

        // ── Guilds ───────────────────────────────────────────────────────────────
        this.#gateway.on("GUILD_CREATE", (data) => {
            const payload = data as APIGuild & {
                members?: APIGuildMember[];
                voice_states?: APIVoiceState[];
                channels?: APIChannel[];
                threads?: APIChannel[];
                unavailable?: boolean;
            };
            if (payload.unavailable) {
                this.emit(ClientEvent.GuildUnavailable, payload);
                return;
            }
            // A guild already in cache that arrives again (e.g. after an outage
            // or gateway resume) has become *available* rather than newly joined.
            // Mirrors Discord.js' guildAvailable vs. guildCreate distinction.
            const wasCached = this.guilds.has(payload.id);
            this.guilds.patch(payload);
            for (const role of payload.roles ?? [])
                this.#upsertRole(payload.id, role);
            if (this.#cache.emojis) {
                const emojis = this.guilds.emojis(payload.id);
                for (const emoji of payload.emojis ?? []) emojis.upsert(emoji);
            }
            for (const member of payload.members ?? [])
                this.#upsertMember(payload.id, member);
            for (const state of payload.voice_states ?? [])
                this.#storeVoiceState(payload.id, state);
            // Channels in GUILD_CREATE omit guild_id; restore it so the
            // channel can be cleaned up with its guild.
            for (const channelData of [
                ...(payload.channels ?? []),
                ...(payload.threads ?? []),
            ])
                this.channels.upsert({ ...channelData, guild_id: payload.id });
            this.emit(
                wasCached
                    ? ClientEvent.GuildAvailable
                    : ClientEvent.GuildCreate,
                payload,
            );
        });
        this.#gateway.on("GUILD_UPDATE", (data) => {
            const payload = data as APIGuild;
            const cached = this.guilds.get(payload.id);
            const previous = cached ? this.#snapshot(cached) : null;
            this.guilds.patch(payload);
            this.emit(ClientEvent.GuildUpdate, payload, previous);
        });
        this.#gateway.on("GUILD_DELETE", (data) => {
            const payload = data as { id: string; unavailable?: boolean };
            if (payload.unavailable) {
                this.emit(ClientEvent.GuildUnavailable, payload);
                return;
            }
            this.guilds.delete(payload.id);
            this.channels.deleteGuildChannels(payload.id);
            this.emit(ClientEvent.GuildDelete, payload);
        });

        // ── Guild Members ────────────────────────────────────────────────────────
        this.#gateway.on("GUILD_MEMBER_ADD", (data) => {
            const member = data as GuildMemberEvent;
            this.#upsertMember(member.guild_id, member);
            this.emit(ClientEvent.GuildMemberAdd, member);
        });
        this.#gateway.on("GUILD_MEMBER_UPDATE", (data) => {
            const member = data as GuildMemberEvent;
            const cached = this.#cache.members
                ? this.guilds.members(member.guild_id).get(member.user.id)
                : undefined;
            // A fresh instance keeps the client context (a private field).
            const previous = cached
                ? this.#snapshot(
                      cached,
                      new GuildMember(
                          { user: member.user, guild_id: member.guild_id },
                          this.#resourceContext,
                      ),
                  )
                : null;
            this.#upsertMember(member.guild_id, member);
            this.emit(ClientEvent.GuildMemberUpdate, member, previous);
        });
        this.#gateway.on("GUILD_MEMBER_REMOVE", (data) => {
            const member = data as GuildMemberEvent;
            this.guilds.members(member.guild_id).delete(member.user.id);
            this.emit(ClientEvent.GuildMemberRemove, member);
        });
        this.#gateway.on("GUILD_MEMBERS_CHUNK", (data) => {
            const chunk = data as APIGuildMembersChunk;
            for (const member of chunk.members)
                this.#upsertMember(chunk.guild_id, member);
            this.emit(ClientEvent.GuildMembersChunk, chunk);
        });

        // ── Guild Bans ───────────────────────────────────────────────────────────
        this.#gateway.on("GUILD_BAN_ADD", (data) => {
            const ban = data as APIGuildBanEvent;
            const bans = this.guilds.bans(ban.guild_id);
            // Keep a reason already fetched over REST; the event carries none.
            bans.set(ban.user.id, {
                reason: bans.get(ban.user.id)?.reason ?? null,
                user: ban.user,
            });
            this.guilds.members(ban.guild_id).delete(ban.user.id);
            this.emit(ClientEvent.GuildBanAdd, ban);
        });
        this.#gateway.on("GUILD_BAN_REMOVE", (data) => {
            const ban = data as APIGuildBanEvent;
            this.guilds.bans(ban.guild_id).delete(ban.user.id);
            this.emit(ClientEvent.GuildBanRemove, ban);
        });

        // ── Guild Roles ──────────────────────────────────────────────────────────
        this.#gateway.on("GUILD_ROLE_CREATE", (data) => {
            const event = data as APIGuildRoleEvent;
            this.#upsertRole(event.guild_id, event.role);
            this.emit(ClientEvent.GuildRoleCreate, event);
        });
        this.#gateway.on("GUILD_ROLE_UPDATE", (data) => {
            const event = data as APIGuildRoleEvent;
            const cached = this.#cache.roles
                ? this.guilds.roles(event.guild_id).get(event.role.id)
                : undefined;
            const previous = cached ? this.#snapshot(cached) : null;
            this.#upsertRole(event.guild_id, event.role);
            this.emit(ClientEvent.GuildRoleUpdate, event, previous);
        });
        this.#gateway.on("GUILD_ROLE_DELETE", (data) => {
            const event = data as APIGuildRoleDeleteEvent;
            const roles = this.guilds.roles(event.guild_id);
            const removed = roles.get(event.role_id) ?? null;
            roles.delete(event.role_id);
            this.emit(ClientEvent.GuildRoleDelete, event, removed);
        });

        // ── Guild Emojis & Stickers ──────────────────────────────────────────────
        this.#gateway.on("GUILD_EMOJIS_UPDATE", (data) => {
            const event = data as APIGuildEmojisUpdateEvent;
            let previous: Emoji[] | null = null;
            // The event carries the guild's full emoji list.
            if (this.#cache.emojis) {
                const emojis = this.guilds.emojis(event.guild_id);
                previous = [...emojis.cache.values()].map((emoji) =>
                    this.#snapshot(emoji),
                );
                const current = new Set(event.emojis.map((emoji) => emoji.id));
                for (const id of [...emojis.cache.keys()])
                    if (!current.has(id)) emojis.delete(id);
                for (const emoji of event.emojis) emojis.upsert(emoji);
            }
            this.emit(ClientEvent.GuildEmojisUpdate, event, previous);
        });
        this.#gateway.on("GUILD_STICKERS_UPDATE", (data) => {
            const event = data as APIGuildStickersUpdateEvent;
            // The event carries the guild's full sticker list. `sync` replaces
            // the raw objects, so the previous list needs no copying.
            const stickers = this.guilds.stickers(event.guild_id);
            const previous = [...stickers.cache.values()];
            stickers.sync(event.stickers);
            this.emit(ClientEvent.GuildStickersUpdate, event, previous);
        });

        // ── Soundboard ───────────────────────────────────────────────────────────
        this.#gateway.on("GUILD_SOUNDBOARD_SOUND_CREATE", (data) => {
            const sound = data as APISoundboardSound;
            if (sound.guild_id)
                this.guilds
                    .soundboard(sound.guild_id)
                    .set(sound.sound_id, sound);
            this.emit(ClientEvent.SoundboardSoundCreate, sound);
        });
        this.#gateway.on("GUILD_SOUNDBOARD_SOUND_UPDATE", (data) => {
            const sound = data as APISoundboardSound;
            if (sound.guild_id)
                this.guilds
                    .soundboard(sound.guild_id)
                    .set(sound.sound_id, sound);
            this.emit(ClientEvent.SoundboardSoundUpdate, sound);
        });
        this.#gateway.on("GUILD_SOUNDBOARD_SOUND_DELETE", (data) => {
            const event = data as { sound_id: string; guild_id: string };
            this.guilds.soundboard(event.guild_id).delete(event.sound_id);
            this.emit(ClientEvent.SoundboardSoundDelete, event);
        });
        this.#gateway.on("GUILD_SOUNDBOARD_SOUNDS_UPDATE", (data) => {
            const event = data as {
                guild_id: string;
                soundboard_sounds: APISoundboardSound[];
            };
            const sounds = this.guilds.soundboard(event.guild_id);
            sounds.clear();
            for (const sound of event.soundboard_sounds)
                sounds.set(sound.sound_id, sound);
            this.emit(ClientEvent.SoundboardSoundsUpdate, event);
        });

        // ── Monetization ─────────────────────────────────────────────────────────
        this.#gateway.on("ENTITLEMENT_CREATE", (data) => {
            const entitlement = data as APIEntitlement;
            this.monetization?.set(entitlement.id, entitlement);
            this.emit(ClientEvent.EntitlementCreate, entitlement);
        });
        this.#gateway.on("ENTITLEMENT_UPDATE", (data) => {
            const entitlement = data as APIEntitlement;
            this.monetization?.set(entitlement.id, entitlement);
            this.emit(ClientEvent.EntitlementUpdate, entitlement);
        });
        this.#gateway.on("ENTITLEMENT_DELETE", (data) => {
            const entitlement = data as APIEntitlement;
            this.monetization?.delete(entitlement.id);
            this.emit(ClientEvent.EntitlementDelete, entitlement);
        });

        // ── Guild Integrations ───────────────────────────────────────────────────
        this.#gateway.on("GUILD_INTEGRATIONS_UPDATE", (data) =>
            this.emit(
                ClientEvent.GuildIntegrationsUpdate,
                data as { guild_id: string },
            ),
        );

        // ── Guild Scheduled Events ───────────────────────────────────────────────
        this.#gateway.on("GUILD_SCHEDULED_EVENT_CREATE", (data) => {
            const event = data as APIGuildScheduledEvent;
            this.guilds.scheduledEvents(event.guild_id).set(event.id, event);
            this.emit(ClientEvent.GuildScheduledEventCreate, event);
        });
        this.#gateway.on("GUILD_SCHEDULED_EVENT_UPDATE", (data) => {
            const event = data as APIGuildScheduledEvent;
            this.guilds.scheduledEvents(event.guild_id).set(event.id, event);
            this.emit(ClientEvent.GuildScheduledEventUpdate, event);
        });
        this.#gateway.on("GUILD_SCHEDULED_EVENT_DELETE", (data) => {
            const event = data as APIGuildScheduledEvent;
            this.guilds.scheduledEvents(event.guild_id).delete(event.id);
            this.emit(ClientEvent.GuildScheduledEventDelete, event);
        });
        this.#gateway.on("GUILD_SCHEDULED_EVENT_USER_ADD", (data) =>
            this.emit(
                ClientEvent.GuildScheduledEventUserAdd,
                data as APIGuildScheduledEventUserEvent,
            ),
        );
        this.#gateway.on("GUILD_SCHEDULED_EVENT_USER_REMOVE", (data) =>
            this.emit(
                ClientEvent.GuildScheduledEventUserRemove,
                data as APIGuildScheduledEventUserEvent,
            ),
        );

        // ── AutoMod ──────────────────────────────────────────────────────────────
        this.#gateway.on("AUTO_MODERATION_RULE_CREATE", (data) => {
            const rule = data as APIAutoModerationRule;
            this.guilds.autoModerationRules(rule.guild_id).set(rule.id, rule);
            this.emit(ClientEvent.AutoModerationRuleCreate, rule);
        });
        this.#gateway.on("AUTO_MODERATION_RULE_UPDATE", (data) => {
            const rule = data as APIAutoModerationRule;
            this.guilds.autoModerationRules(rule.guild_id).set(rule.id, rule);
            this.emit(ClientEvent.AutoModerationRuleUpdate, rule);
        });
        this.#gateway.on("AUTO_MODERATION_RULE_DELETE", (data) => {
            const rule = data as APIAutoModerationRule;
            this.guilds.autoModerationRules(rule.guild_id).delete(rule.id);
            this.emit(ClientEvent.AutoModerationRuleDelete, rule);
        });
        this.#gateway.on("AUTO_MODERATION_ACTION_EXECUTION", (data) =>
            this.emit(
                ClientEvent.AutoModerationActionExecution,
                data as APIAutoModerationActionExecution,
            ),
        );

        // ── Channels ─────────────────────────────────────────────────────────────
        this.#gateway.on("CHANNEL_CREATE", (data) => {
            const channel = this.channels.upsert(data as APIChannel);
            this.emit(ClientEvent.ChannelCreate, channel);
        });
        this.#gateway.on("CHANNEL_UPDATE", (data) => {
            const previous = this.#previousChannel(data as APIChannel);
            const channel = this.channels.upsert(data as APIChannel);
            this.emit(ClientEvent.ChannelUpdate, channel, previous);
        });
        this.#gateway.on("CHANNEL_DELETE", (data) => {
            const payload = data as APIChannel;
            const removed = this.channels.get(payload.id) ?? null;
            this.channels.delete(payload.id);
            this.emit(ClientEvent.ChannelDelete, payload, removed);
        });
        this.#gateway.on("CHANNEL_PINS_UPDATE", (data) =>
            this.emit(
                ClientEvent.ChannelPinsUpdate,
                data as APIChannelPinsUpdate,
            ),
        );

        // ── Threads ──────────────────────────────────────────────────────────────
        this.#gateway.on("THREAD_CREATE", (data) => {
            const channel = this.channels.upsert(data as APIThreadEvent);
            this.emit(ClientEvent.ThreadCreate, channel);
        });
        this.#gateway.on("THREAD_UPDATE", (data) => {
            const previous = this.#previousChannel(data as APIThreadEvent);
            const channel = this.channels.upsert(data as APIThreadEvent);
            this.emit(ClientEvent.ThreadUpdate, channel, previous);
        });
        this.#gateway.on("THREAD_DELETE", (data) => {
            const payload = data as APIThreadEvent;
            const removed = this.channels.get(payload.id) ?? null;
            this.channels.delete(payload.id);
            this.emit(ClientEvent.ThreadDelete, payload, removed);
        });
        this.#gateway.on("THREAD_LIST_SYNC", (data) => {
            const sync = data as APIThreadListSync;
            for (const thread of sync.threads)
                this.channels.upsert({ ...thread, guild_id: sync.guild_id });
            this.emit(ClientEvent.ThreadListSync, sync);
        });
        this.#gateway.on("THREAD_MEMBERS_UPDATE", (data) =>
            this.emit(
                ClientEvent.ThreadMembersUpdate,
                data as APIThreadMembersUpdate,
            ),
        );
        this.#gateway.on("THREAD_MEMBER_UPDATE", (data) =>
            this.emit(
                ClientEvent.ThreadMemberUpdate,
                data as import("@lunibee/types").APIThreadMember,
            ),
        );

        // ── Stage Instances ──────────────────────────────────────────────────────
        this.#gateway.on("STAGE_INSTANCE_CREATE", (data) => {
            const stage = data as APIStageInstance;
            this.stageInstances.set(stage.channel_id, stage);
            this.emit(ClientEvent.StageInstanceCreate, stage);
        });
        this.#gateway.on("STAGE_INSTANCE_UPDATE", (data) => {
            const stage = data as APIStageInstance;
            this.stageInstances.set(stage.channel_id, stage);
            this.emit(ClientEvent.StageInstanceUpdate, stage);
        });
        this.#gateway.on("STAGE_INSTANCE_DELETE", (data) => {
            const stage = data as APIStageInstance;
            this.stageInstances.delete(stage.channel_id);
            this.emit(ClientEvent.StageInstanceDelete, stage);
        });

        // ── Invites ──────────────────────────────────────────────────────────────
        this.#gateway.on("INVITE_CREATE", (data) => {
            const invite = data as APIInviteCreate;
            if (invite.guild_id)
                this.guilds.invites(invite.guild_id).set(invite.code, invite);
            this.emit(ClientEvent.InviteCreate, invite);
        });
        this.#gateway.on("INVITE_DELETE", (data) => {
            const invite = data as APIInviteDelete;
            if (invite.guild_id)
                this.guilds.invites(invite.guild_id).delete(invite.code);
            this.emit(ClientEvent.InviteDelete, invite);
        });

        // ── Webhooks ─────────────────────────────────────────────────────────────
        this.#gateway.on("WEBHOOKS_UPDATE", (data) =>
            this.emit(ClientEvent.WebhooksUpdate, data as APIWebhooksUpdate),
        );

        // ── Voice ────────────────────────────────────────────────────────────────
        this.#gateway.on("VOICE_STATE_UPDATE", (data) => {
            const state = data as APIVoiceState;
            if (state.guild_id) this.#storeVoiceState(state.guild_id, state);
            this.emit(ClientEvent.VoiceStateUpdate, state);
        });
        this.#gateway.on("VOICE_SERVER_UPDATE", (data) =>
            this.emit(
                ClientEvent.VoiceServerUpdate,
                data as APIVoiceServerUpdate,
            ),
        );

        // ── Presence & Typing ────────────────────────────────────────────────────
        this.#gateway.on("PRESENCE_UPDATE", (data) =>
            this.emit(ClientEvent.PresenceUpdate, data as APIPresenceUpdate),
        );
        this.#gateway.on("TYPING_START", (data) =>
            this.emit(ClientEvent.TypingStart, data as APITypingStart),
        );

        // ── Interactions ─────────────────────────────────────────────────────────
        this.#gateway.on("INTERACTION_CREATE", (data) =>
            this.emit(
                ClientEvent.InteractionCreate,
                createInteraction(this, data as InteractionData),
            ),
        );

        // ── Raw / Error ───────────────────────────────────────────────────────────
        this.#gateway.on("RAW", (data) =>
            this.emit(
                ClientEvent.Raw,
                data as { event: string; data: unknown },
            ),
        );
        this.#gateway.on("error", (error) =>
            this.emit(ClientEvent.Error, error as Error),
        );
    }

    /**
     * Convenience method to connect the bot to Discord.
     * Optionally overrides the configured token.
     * @param token Optional token override.
     * @returns The token used to log in.
     * @throws {TypeError} If the resulting token is empty.
     */
    /** Caches a message's author, and its channel only when none is cached: the
     * message carries a stub channel that must not overwrite a full one. */
    #observeMessage(message: Message): void {
        if (!this.channels.has(message.channelId))
            this.channels.set(message.channelId, message.channel);
        if (this.#cache.users)
            this.#merge(this.users, message.author.id, message.author);
    }

    #upsertMember(guildId: string, data: APIGuildMember): GuildMember {
        const member = new GuildMember(
            { ...data, guild_id: guildId },
            this.#resourceContext,
        );
        if (this.#cache.users)
            this.#merge(this.users, member.user.id, member.user);
        if (!this.#cache.members) return member;
        return this.#merge(
            this.guilds.members(guildId),
            member.user.id,
            member,
        );
    }

    /** A voice state without a channel means the user left voice. */
    #storeVoiceState(guildId: string, state: APIVoiceState): void {
        const states = this.guilds.voiceStates(guildId);
        if (state.channel_id) states.set(state.user_id, state);
        else states.delete(state.user_id);
    }

    #upsertRole(guildId: string, data: APIRole): Role {
        if (!this.#cache.roles) return new Role(data);
        return this.#merge(this.guilds.roles(guildId), data.id, new Role(data));
    }

    /**
     * Copies a cached structure's fields before an in-place merge changes them.
     * Pass `blank` (a fresh instance of the same class) when the class has
     * private fields, so the copy keeps them.
     */
    #snapshot<T extends object>(
        cached: T,
        blank: T = Object.create(Object.getPrototypeOf(cached)) as T,
    ): T {
        return Object.assign(blank, cached);
    }

    /** A copy of the cached channel an update is about to change, or null. */
    #previousChannel(data: APIChannel): Channel | null {
        const cached = this.channels.get(data.id);
        if (!cached) return null;
        // Channel keeps its client context in a private field; build the copy
        // through the same factory so it keeps the subclass and the context.
        return this.#snapshot(
            cached,
            createChannel(
                { id: cached.id, type: cached.type, guild_id: cached.guildId },
                this.#resourceContext,
            ),
        );
    }

    /** Merges `next` into the cached instance so references stay valid.
     * Fields a partial payload left undefined keep their cached value. */
    #merge<T extends object>(
        manager: {
            get(id: string): T | undefined;
            set(id: string, value: T): unknown;
        },
        id: string,
        next: T,
    ): T {
        const existing = manager.get(id);
        if (!existing) {
            manager.set(id, next);
            return next;
        }
        for (const [key, value] of Object.entries(next))
            if (value !== undefined)
                (existing as Record<string, unknown>)[key] = value;
        return existing;
    }

    /**
     * Collects the first argument of a client event until a limit, timeout,
     * idle timeout, abort or `stop()`. The collector unsubscribes itself when
     * it ends. Items are keyed by `options.key`, else their `id`, else order.
     */
    public createCollector<E extends keyof ClientEvents>(
        event: E,
        options: CollectorOptions<ClientEvents[E][0]> & {
            key?: (item: ClientEvents[E][0]) => string;
        } = {},
    ): Collector<string, ClientEvents[E][0]> {
        const collector = new Collector<string, ClientEvents[E][0]>(options);
        let order = 0;
        const listener = (...args: ClientEvents[E]): void => {
            const item = args[0];
            const id = (item as { id?: unknown } | null | undefined)?.id;
            const key =
                options.key?.(item) ??
                (typeof id === "string" ? id : String(order++));
            collector
                .handle(key, item)
                .catch((error: unknown) =>
                    this.emit(
                        ClientEvent.Error,
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                    ),
                );
        };
        this.on(event, listener);
        collector.onDispose(() => this.off(event, listener));
        return collector;
    }

    /** Structures built by this client (members from interactions...) act through this. */
    public get resourceContext(): ResourceContext {
        return this.#resourceContext;
    }

    /** Guild- or channel-level permissions from a member's role IDs and the cached roles and overwrites. */
    #memberPermissions(
        guildId: string,
        memberId: string,
        roleIds: readonly string[],
        channelId?: string,
        timedOutUntil?: Date | null,
    ): PermissionSet | null {
        const guild = this.guilds.get(guildId);
        if (!guild) return null;
        let channel = channelId ? this.channels.get(channelId) : undefined;
        if (channelId) {
            // Threads use their parent's overwrites; without it the answer is unknown.
            if (channel?.isThread())
                channel = channel.parentId
                    ? this.channels.get(channel.parentId)
                    : undefined;
            if (!channel || channel.guildId !== guildId) return null;
        }
        return computePermissions({
            guildId,
            ownerId: guild.ownerId,
            memberId,
            memberRoleIds: [...roleIds],
            roles: this.guilds.roles(guildId).values(),
            overwrites: channel?.permissionOverwrites,
            timedOutUntil,
        });
    }

    /**
     * Resolves a member's permissions from cached state: guild-level for a
     * guild ID, or channel-level (including overwrites) for a cached channel
     * ID. Returns null when the guild or member is not cached.
     */
    public permissionsFor(
        memberId: string,
        guildOrChannelId: string,
    ): PermissionSet | null {
        let channel = this.channels.get(guildOrChannelId);
        // Threads have no overwrites of their own: they use the parent's.
        // Without a cached parent the answer would be guild-level only, which
        // could wrongly grant access, so report it as unknown instead.
        if (channel?.isThread()) {
            channel = channel.parentId
                ? this.channels.get(channel.parentId)
                : undefined;
            if (!channel) return null;
        }
        const guildId = channel?.guildId ?? guildOrChannelId;
        const guild = this.guilds.get(guildId);
        const member = this.guilds.members(guildId).get(memberId);
        if (!guild || !member) return null;
        return computePermissions({
            guildId,
            ownerId: guild.ownerId,
            memberId,
            memberRoleIds: member.roleIds,
            roles: this.guilds.roles(guildId).values(),
            overwrites: channel?.permissionOverwrites,
            timedOutUntil: member.timedOutUntil,
        });
    }

    /** Fetches Discord's default soundboard sounds. */
    public fetchDefaultSoundboardSounds(): Promise<APISoundboardSound[]> {
        return this.rest.get<APISoundboardSound[]>(
            Routes.soundboardDefaultSounds(),
        );
    }

    /**
     * Connects to the Gateway. Resolves with the token used, like discord.js;
     * do not log the return value.
     */
    public async login(token?: string): Promise<string> {
        if (this.state === "destroyed")
            throw new Error("Cannot login a destroyed client.");
        if (token?.trim()) {
            this.rest.setToken(token);
            this.options.token = token;
        }
        const usedToken = this.options.token;
        if (!usedToken?.trim())
            throw new TypeError("A bot token is required to log in.");
        this.state = "connecting";
        await this.#gateway.connect();
        return usedToken;
    }

    /**
     * Destroys the client, permanently closing the Gateway connection.
     */
    public destroy(): void {
        this.state = "destroyed";
        this.#gateway.close();
    }

    // ── InteractionClient implementation ─────────────────────────────────────

    public postInteractionResponse(
        id: string,
        token: string,
        response: import("@lunibee/structures").InteractionResponse,
    ): Promise<unknown> {
        const json = response.toJSON();
        // `?with_response=true` makes Discord return the created message.
        const callback = response.withResponse
            ? `${Routes.interactionCallback(id, token)}?with_response=true`
            : Routes.interactionCallback(id, token);
        // Only message responses (4 reply, 7 update) carry mentions; a modal or a deferral does not.
        const carriesMessage = json.type === 4 || json.type === 7;
        // Files in the reply turn the callback into an upload.
        const upload = json.data
            ? toRequest(
                  json.data,
                  carriesMessage ? this.options.allowedMentions : undefined,
              )
            : undefined;
        if (upload && typeof upload === "object" && "files" in upload) {
            const { body, files } = upload as { body: unknown; files: never[] };
            return this.rest.post(callback, {
                body: { ...json, data: body },
                files,
            });
        }
        return this.rest.post(
            callback,
            upload === undefined ? json : { ...json, data: upload },
        );
    }
    public editInteractionReply(
        token: string,
        data: Record<string, unknown>,
    ): Promise<unknown> {
        if (!this.user)
            return Promise.reject(new Error("Client is unauthenticated."));
        return this.rest.patch(
            Routes.interactionOriginalResponse(this.user.id, token),
            toRequest(data, this.options.allowedMentions),
        );
    }
    public deleteInteractionReply(token: string): Promise<void> {
        if (!this.user)
            return Promise.reject(new Error("Client is unauthenticated."));
        return this.rest.delete(
            Routes.interactionOriginalResponse(this.user.id, token),
        );
    }
    public async followUpInteraction(
        token: string,
        data: Record<string, unknown>,
    ): Promise<unknown> {
        if (!this.user)
            return Promise.reject(new Error("Client is unauthenticated."));
        return this.rest.post(
            Routes.webhook(this.user.id, token),
            toRequest(data, this.options.allowedMentions),
        );
    }
    public interactionWebhookMessage(
        method: "GET" | "PATCH" | "DELETE",
        applicationId: string,
        token: string,
        messageId: string,
        data?: Record<string, unknown>,
    ): Promise<unknown> {
        const path =
            messageId === "@original"
                ? Routes.interactionOriginalResponse(applicationId, token)
                : Routes.webhookMessage(applicationId, token, messageId);
        if (method === "GET") return this.rest.get(path);
        if (method === "PATCH")
            return this.rest.patch(
                path,
                data ? toRequest(data, this.options.allowedMentions) : data,
            );
        return this.rest.delete(path);
    }

    // ── Client Utilities ─────────────────────────────────────────────────────

    /** Fetches a webhook from Discord. */
    public async fetchWebhook(
        id: string,
        token?: string,
    ): Promise<Record<string, unknown>> {
        return this.rest.get(Routes.webhook(id, token)) as Promise<
            Record<string, unknown>
        >;
    }

    /** Fetches a guild preview from Discord. */
    public async fetchGuildPreview(
        guildId: string,
    ): Promise<Record<string, unknown>> {
        return this.rest.get(Routes.guildPreview(guildId)) as Promise<
            Record<string, unknown>
        >;
    }

    /** Fetches the voice regions from Discord. */
    public fetchVoiceRegions(): Promise<Record<string, unknown>[]> {
        return this.rest.get("/voice/regions") as Promise<
            Record<string, unknown>[]
        >;
    }

    /** Fetches an invite from Discord. */
    public fetchInvite(
        code: string,
        options?: {
            withCounts?: boolean;
            /** @deprecated No effect: Discord always returns `expires_at` and deprecated `with_expiration`. Removed in 0.3.0. */
            withExpiration?: boolean;
            guildScheduledEventId?: string;
        },
    ): Promise<Record<string, unknown>> {
        const query = new URLSearchParams();
        if (options?.withCounts) query.set("with_counts", "true");
        if (options?.guildScheduledEventId)
            query.set(
                "guild_scheduled_event_id",
                options.guildScheduledEventId,
            );
        const qs = query.toString();
        return this.rest.get(
            `/invites/${encodeURIComponent(code)}${qs ? `?${qs}` : ""}`,
        ) as Promise<Record<string, unknown>>;
    }

    /** Fetches a sticker from Discord. */
    public async fetchSticker(id: string): Promise<Record<string, unknown>> {
        return this.rest.get(Routes.sticker(id)) as Promise<
            Record<string, unknown>
        >;
    }

    /** Fetches premium sticker packs from Discord. */
    public fetchPremiumStickerPacks(): Promise<Record<string, unknown>> {
        return this.rest.get(`/sticker-packs`) as Promise<
            Record<string, unknown>
        >;
    }

    /** Fetches a guild template from Discord. */
    public fetchGuildTemplate(code: string): Promise<Record<string, unknown>> {
        return this.rest.get(
            `/guilds/templates/${encodeURIComponent(code)}`,
        ) as Promise<Record<string, unknown>>;
    }

    /** Generates an invite link for this client. */
    public generateInvite(options?: {
        scopes?: string[];
        permissions?: string | bigint;
    }): string {
        if (!this.user)
            throw new Error("Client must be ready to generate invite.");
        const params = new URLSearchParams({
            client_id: this.user.id,
            scope: (options?.scopes ?? ["bot"]).join(" "),
        });
        if (options?.permissions) {
            params.set("permissions", String(options.permissions));
        }
        return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
    }
}
