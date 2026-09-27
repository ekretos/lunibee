export {
    Permission,
    Permissions,
    PermissionFlagsBits,
    PermissionSet,
    PermissionsBitField,
    PermissionOverwriteType,
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

import { Collection } from "@lunibee/collection";
import {
    ApplicationCommandManager,
    ChannelManager,
    GuildManager,
    StageInstanceManager,
    UserManager,
} from "@lunibee/managers";
import { REST, Routes } from "@lunibee/rest";
import {
    User,
    Guild,
    GuildMember,
    Role,
    createChannel,
    Message,
    createInteraction,
    type InteractionClient,
    type InteractionData,
    type ResourceContext,
} from "@lunibee/structures";
import { Gateway } from "@lunibee/ws";
import type {
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

/** Lifecycle state of a client. */
export type ClientState = "idle" | "connecting" | "ready" | "destroyed";
type Listener<T extends unknown[]> = (...args: T) => unknown;
type GuildMemberEvent = APIGuildMember & { guild_id: string };

/** Minimal typed event emitter used by the client. */
class EventEmitter<Events extends { [K in keyof Events]: unknown[] }> {
    readonly #listeners = new Map<keyof Events, Set<Listener<any>>>();
    public on<K extends keyof Events>(
        event: K,
        listener: Listener<Events[K]>,
    ): this {
        if (typeof listener !== "function")
            throw new TypeError("Event listener must be a function.");
        let listeners = this.#listeners.get(event);
        if (!listeners) this.#listeners.set(event, (listeners = new Set()));
        listeners.add(listener);
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
        this.#listeners.get(event)?.delete(listener);
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
        if (event === undefined) this.#listeners.clear();
        else this.#listeners.delete(event);
        return this;
    }
    protected emit<K extends keyof Events>(
        event: K,
        ...args: Events[K]
    ): boolean {
        const listeners = this.#listeners.get(event);
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
    #handleError(event: keyof Events, error: unknown): void {
        if (event === ClientEvent.Error) return;
        const normalized =
            error instanceof Error
                ? error
                : new Error(String(error), { cause: error });
        for (const listener of [
            ...(this.#listeners.get(ClientEvent.Error as keyof Events) ?? []),
        ]) {
            try {
                void listener(normalized);
            } catch {}
        }
    }
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
    readonly #resourceContext: ResourceContext;

    public constructor(public readonly options: ClientOptions) {
        super();
        if (!options.token?.trim())
            throw new TypeError("Client token is required.");
        this.rest = new REST({ token: options.token, ...options.rest });
        this.users = new UserManager(this.rest);
        this.guilds = new GuildManager(this.rest);
        this.channels = new ChannelManager(this.rest, {
            messageCache: options.messageCache,
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
            deleteMessage: (channelId, messageId) =>
                this.channels.deleteMessage(channelId, messageId),
            crosspostMessage: (channelId, messageId) =>
                this.channels.crosspostMessage(channelId, messageId),
            editChannel: (channelId, options) =>
                this.channels.edit(channelId, options),
            deleteChannel: (channelId) =>
                this.channels.deleteChannel(channelId),
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
            pinMessage: (channelId, messageId) =>
                this.channels.pinMessage(channelId, messageId),
            unpinMessage: (channelId, messageId) =>
                this.channels.unpinMessage(channelId, messageId),
        };
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
            const message = new Message(
                data as import("@lunibee/types").APIMessage,
                this.#resourceContext,
            );
            this.#observeMessage(message);
            this.emit(ClientEvent.MessageCreate, message);
        });
        this.#gateway.on("MESSAGE_UPDATE", (data) => {
            const message = new Message(
                data as import("@lunibee/types").APIMessage,
                this.#resourceContext,
            );
            this.#observeMessage(message);
            const messages = this.channels.cachedMessages(message.channelId);
            if (messages?.cache.has(message.id))
                messages.upsert(data as import("@lunibee/types").APIMessage);
            this.emit(ClientEvent.MessageUpdate, message);
        });
        this.#gateway.on("MESSAGE_DELETE", (data) => {
            const payload = data as APIMessageDeleteEvent;
            this.channels
                .cachedMessages(payload.channel_id)
                ?.delete(payload.id);
            this.emit(ClientEvent.MessageDelete, payload);
        });
        this.#gateway.on("MESSAGE_DELETE_BULK", (data) => {
            const payload = data as APIMessageDeleteBulkEvent;
            const messages = this.channels.cachedMessages(payload.channel_id);
            if (messages) for (const id of payload.ids) messages.delete(id);
            this.emit(ClientEvent.MessageDeleteBulk, payload);
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
            const emojis = this.guilds.emojis(payload.id);
            for (const emoji of payload.emojis ?? []) emojis.upsert(emoji);
            for (const member of payload.members ?? [])
                this.#upsertMember(payload.id, member);
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
            this.guilds.patch(data as APIGuild);
            this.emit(ClientEvent.GuildUpdate, data as APIGuild);
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
            this.#upsertMember(member.guild_id, member);
            this.emit(ClientEvent.GuildMemberUpdate, member);
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
            this.#upsertRole(event.guild_id, event.role);
            this.emit(ClientEvent.GuildRoleUpdate, event);
        });
        this.#gateway.on("GUILD_ROLE_DELETE", (data) => {
            const event = data as APIGuildRoleDeleteEvent;
            this.guilds.roles(event.guild_id).delete(event.role_id);
            this.emit(ClientEvent.GuildRoleDelete, event);
        });

        // ── Guild Emojis & Stickers ──────────────────────────────────────────────
        this.#gateway.on("GUILD_EMOJIS_UPDATE", (data) => {
            const event = data as APIGuildEmojisUpdateEvent;
            // The event carries the guild's full emoji list.
            const emojis = this.guilds.emojis(event.guild_id);
            const current = new Set(event.emojis.map((emoji) => emoji.id));
            for (const id of [...emojis.cache.keys()])
                if (!current.has(id)) emojis.delete(id);
            for (const emoji of event.emojis) emojis.upsert(emoji);
            this.emit(ClientEvent.GuildEmojisUpdate, event);
        });
        this.#gateway.on("GUILD_STICKERS_UPDATE", (data) =>
            this.emit(
                ClientEvent.GuildStickersUpdate,
                data as APIGuildStickersUpdateEvent,
            ),
        );

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
        this.#gateway.on("AUTO_MODERATION_RULE_CREATE", (data) =>
            this.emit(
                ClientEvent.AutoModerationRuleCreate,
                data as APIAutoModerationRule,
            ),
        );
        this.#gateway.on("AUTO_MODERATION_RULE_UPDATE", (data) =>
            this.emit(
                ClientEvent.AutoModerationRuleUpdate,
                data as APIAutoModerationRule,
            ),
        );
        this.#gateway.on("AUTO_MODERATION_RULE_DELETE", (data) =>
            this.emit(
                ClientEvent.AutoModerationRuleDelete,
                data as APIAutoModerationRule,
            ),
        );
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
            const channel = this.channels.upsert(data as APIChannel);
            this.emit(ClientEvent.ChannelUpdate, channel);
        });
        this.#gateway.on("CHANNEL_DELETE", (data) => {
            const payload = data as APIChannel;
            this.channels.delete(payload.id);
            this.emit(ClientEvent.ChannelDelete, payload);
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
            const channel = this.channels.upsert(data as APIThreadEvent);
            this.emit(ClientEvent.ThreadUpdate, channel);
        });
        this.#gateway.on("THREAD_DELETE", (data) => {
            const payload = data as APIThreadEvent;
            this.channels.delete(payload.id);
            this.emit(ClientEvent.ThreadDelete, payload);
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
        this.#gateway.on("INVITE_CREATE", (data) =>
            this.emit(ClientEvent.InviteCreate, data as APIInviteCreate),
        );
        this.#gateway.on("INVITE_DELETE", (data) =>
            this.emit(ClientEvent.InviteDelete, data as APIInviteDelete),
        );

        // ── Webhooks ─────────────────────────────────────────────────────────────
        this.#gateway.on("WEBHOOKS_UPDATE", (data) =>
            this.emit(ClientEvent.WebhooksUpdate, data as APIWebhooksUpdate),
        );

        // ── Voice ────────────────────────────────────────────────────────────────
        this.#gateway.on("VOICE_STATE_UPDATE", (data) =>
            this.emit(ClientEvent.VoiceStateUpdate, data as APIVoiceState),
        );
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
        this.#merge(this.users, message.author.id, message.author);
    }

    #upsertMember(guildId: string, data: APIGuildMember): GuildMember {
        const member = new GuildMember({ ...data, guild_id: guildId });
        this.#merge(this.users, member.user.id, member.user);
        return this.#merge(
            this.guilds.members(guildId),
            member.user.id,
            member,
        );
    }

    #upsertRole(guildId: string, data: APIRole): Role {
        return this.#merge(this.guilds.roles(guildId), data.id, new Role(data));
    }

    /** Merges `next` into the cached instance so references stay valid. */
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
        Object.assign(existing, next);
        return existing;
    }

    public async login(token?: string): Promise<string> {
        if (this.state === "destroyed")
            throw new Error("Cannot login a destroyed client.");
        if (token?.trim()) {
            this.rest.setToken(token);
            (this as any).options.token = token;
        }
        const usedToken = (this as any).options.token as string;
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
        return this.rest.post(
            Routes.interactionCallback(id, token),
            response.toJSON(),
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
            data,
        );
    }
    public deleteInteractionReply(token: string): Promise<void> {
        if (!this.user)
            return Promise.reject(new Error("Client is unauthenticated."));
        return this.rest.delete(
            Routes.interactionOriginalResponse(this.user.id, token),
        );
    }
    public followUpInteraction(
        token: string,
        data: Record<string, unknown>,
    ): Promise<unknown> {
        if (!this.user)
            return Promise.reject(new Error("Client is unauthenticated."));
        return this.rest.post(`/webhooks/${this.user.id}/${token}`, data);
    }

    // ── Client Utilities ─────────────────────────────────────────────────────

    /** Fetches a webhook from Discord. */
    public fetchWebhook(
        id: string,
        token?: string,
    ): Promise<Record<string, unknown>> {
        return this.rest.get(
            token ? `/webhooks/${id}/${token}` : `/webhooks/${id}`,
        ) as Promise<Record<string, unknown>>;
    }

    /** Fetches a guild preview from Discord. */
    public fetchGuildPreview(
        guildId: string,
    ): Promise<Record<string, unknown>> {
        return this.rest.get(`/guilds/${guildId}/preview`) as Promise<
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
            withExpiration?: boolean;
            guildScheduledEventId?: string;
        },
    ): Promise<Record<string, unknown>> {
        const query = new URLSearchParams();
        if (options?.withCounts) query.set("with_counts", "true");
        if (options?.withExpiration) query.set("with_expiration", "true");
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
    public fetchSticker(id: string): Promise<Record<string, unknown>> {
        return this.rest.get(`/stickers/${id}`) as Promise<
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
