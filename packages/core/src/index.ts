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
  type ClientEventName,
  type ClientListener,
} from "./events.js";
export {
  GatewayIntentBits,
  IntentBits,
  Intents,
  resolveGatewayIntents,
  type GatewayIntentResolvable,
} from "@lunibee/types";

import { Collection } from "@lunibee/collection";
import {
  ApplicationCommandManager,
  ChannelManager,
  GuildManager,
  UserManager,
} from "@lunibee/managers";
import { REST, Routes } from "@lunibee/rest";
import {
  User,
  Guild,
  Channel,
  Message,
  Interaction,
  createInteraction,
  type InteractionClient,
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
  APIThreadMember,
  ClientOptions,
  ClientUser,
} from "@lunibee/types";
import { ClientEvent } from "./events.js";

/** Lifecycle state of a client. */
export type ClientState = "idle" | "connecting" | "ready" | "destroyed";
type Listener<T extends unknown[]> = (...args: T) => unknown;

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
  public get uptime(): number | null {
    return this.readyAt ? Date.now() - this.readyAt.getTime() : null;
  }
  /** Whether the client is ready and connected. */
  public isReady(): boolean {
    return this.state === "ready";
  }
  /** Sets the bot's presence / status. @param data Presence payload. @returns Whether the payload was sent. */
  public setPresence(data: import("@lunibee/types").GatewayPresence): boolean {
    return this.#gateway.setPresence?.(data) ?? false;
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
    this.channels = new ChannelManager(this.rest);
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
      (this.application as { commands: ApplicationCommandManager }).commands =
        new ApplicationCommandManager(this.rest, appId);
      this.emit(ClientEvent.Ready, this.user);
    });
    this.#gateway.on("open", () => this.emit(ClientEvent.Open));
    this.#gateway.on("close", (data) => {
      if (this.state !== "destroyed") this.state = "idle";
      this.emit(ClientEvent.Close, data as { code: number; action: string });
    });

    // ── Messages ─────────────────────────────────────────────────────────────
    this.#gateway.on("MESSAGE_CREATE", (data) => {
      const message = new Message(
        data as import("@lunibee/types").APIMessage,
        this.#resourceContext,
      );
      this.channels.set(message.channelId, message.channel);
      this.users.set(message.author.id, message.author);
      this.emit(ClientEvent.MessageCreate, message);
    });
    this.#gateway.on("MESSAGE_UPDATE", (data) => {
      const message = new Message(
        data as import("@lunibee/types").APIMessage,
        this.#resourceContext,
      );
      this.channels.set(message.channelId, message.channel);
      this.users.set(message.author.id, message.author);
      this.emit(ClientEvent.MessageUpdate, message);
    });
    this.#gateway.on("MESSAGE_DELETE", (data) =>
      this.emit(ClientEvent.MessageDelete, data as APIMessageDeleteEvent),
    );
    this.#gateway.on("MESSAGE_DELETE_BULK", (data) =>
      this.emit(
        ClientEvent.MessageDeleteBulk,
        data as APIMessageDeleteBulkEvent,
      ),
    );

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
        this.emit(ClientEvent.GuildAvailable, payload);
        return;
      }
      const guild = new Guild(payload);
      this.guilds.set(guild.id, guild);
      for (const member of payload.members ?? [])
        this.users.set(member.user.id, new User(member.user));
      for (const channelData of [
        ...(payload.channels ?? []),
        ...(payload.threads ?? []),
      ])
        this.channels.set(
          channelData.id,
          new Channel(channelData, this.#resourceContext),
        );
      this.emit(ClientEvent.GuildCreate, payload);
    });
    this.#gateway.on("GUILD_UPDATE", (data) => {
      const guild = new Guild(data as APIGuild);
      this.guilds.update(guild);
      this.emit(ClientEvent.GuildUpdate, data as APIGuild);
    });
    this.#gateway.on("GUILD_DELETE", (data) => {
      const payload = data as { id: string; unavailable?: boolean };
      if (payload.unavailable) {
        this.emit(ClientEvent.GuildUnavailable, payload);
        return;
      }
      this.guilds.delete(payload.id);
      this.emit(ClientEvent.GuildDelete, payload);
    });

    // ── Guild Members ────────────────────────────────────────────────────────
    this.#gateway.on("GUILD_MEMBER_ADD", (data) => {
      const member = data as APIGuildMember;
      this.users.set(member.user.id, new User(member.user));
      this.emit(ClientEvent.GuildMemberAdd, member);
    });
    this.#gateway.on("GUILD_MEMBER_UPDATE", (data) => {
      const member = data as APIGuildMember;
      this.users.set(member.user.id, new User(member.user));
      this.emit(ClientEvent.GuildMemberUpdate, member);
    });
    this.#gateway.on("GUILD_MEMBER_REMOVE", (data) =>
      this.emit(ClientEvent.GuildMemberRemove, data as APIGuildMember),
    );
    this.#gateway.on("GUILD_MEMBERS_CHUNK", (data) =>
      this.emit(ClientEvent.GuildMembersChunk, data as APIGuildMembersChunk),
    );

    // ── Guild Bans ───────────────────────────────────────────────────────────
    this.#gateway.on("GUILD_BAN_ADD", (data) =>
      this.emit(ClientEvent.GuildBanAdd, data as APIGuildBanEvent),
    );
    this.#gateway.on("GUILD_BAN_REMOVE", (data) =>
      this.emit(ClientEvent.GuildBanRemove, data as APIGuildBanEvent),
    );

    // ── Guild Roles ──────────────────────────────────────────────────────────
    this.#gateway.on("GUILD_ROLE_CREATE", (data) =>
      this.emit(ClientEvent.GuildRoleCreate, data as APIGuildRoleEvent),
    );
    this.#gateway.on("GUILD_ROLE_UPDATE", (data) =>
      this.emit(ClientEvent.GuildRoleUpdate, data as APIGuildRoleEvent),
    );
    this.#gateway.on("GUILD_ROLE_DELETE", (data) =>
      this.emit(ClientEvent.GuildRoleDelete, data as APIGuildRoleDeleteEvent),
    );

    // ── Guild Emojis & Stickers ──────────────────────────────────────────────
    this.#gateway.on("GUILD_EMOJIS_UPDATE", (data) =>
      this.emit(
        ClientEvent.GuildEmojisUpdate,
        data as APIGuildEmojisUpdateEvent,
      ),
    );
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
    this.#gateway.on("GUILD_SCHEDULED_EVENT_CREATE", (data) =>
      this.emit(
        ClientEvent.GuildScheduledEventCreate,
        data as APIGuildScheduledEvent,
      ),
    );
    this.#gateway.on("GUILD_SCHEDULED_EVENT_UPDATE", (data) =>
      this.emit(
        ClientEvent.GuildScheduledEventUpdate,
        data as APIGuildScheduledEvent,
      ),
    );
    this.#gateway.on("GUILD_SCHEDULED_EVENT_DELETE", (data) =>
      this.emit(
        ClientEvent.GuildScheduledEventDelete,
        data as APIGuildScheduledEvent,
      ),
    );
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
      const channel = new Channel(data as APIChannel, this.#resourceContext);
      this.channels.update(channel);
      this.emit(ClientEvent.ChannelCreate, channel);
    });
    this.#gateway.on("CHANNEL_UPDATE", (data) => {
      const channel = new Channel(data as APIChannel, this.#resourceContext);
      this.channels.update(channel);
      this.emit(ClientEvent.ChannelUpdate, channel);
    });
    this.#gateway.on("CHANNEL_DELETE", (data) => {
      const payload = data as APIChannel;
      this.channels.delete(payload.id);
      this.emit(ClientEvent.ChannelDelete, payload);
    });
    this.#gateway.on("CHANNEL_PINS_UPDATE", (data) =>
      this.emit(ClientEvent.ChannelPinsUpdate, data as APIChannelPinsUpdate),
    );

    // ── Threads ──────────────────────────────────────────────────────────────
    this.#gateway.on("THREAD_CREATE", (data) => {
      const channel = new Channel(
        data as APIThreadEvent,
        this.#resourceContext,
      );
      this.channels.update(channel);
      this.emit(ClientEvent.ThreadCreate, channel);
    });
    this.#gateway.on("THREAD_UPDATE", (data) => {
      const channel = new Channel(
        data as APIThreadEvent,
        this.#resourceContext,
      );
      this.channels.update(channel);
      this.emit(ClientEvent.ThreadUpdate, channel);
    });
    this.#gateway.on("THREAD_DELETE", (data) => {
      const payload = data as APIThreadEvent;
      this.channels.delete(payload.id);
      this.emit(ClientEvent.ThreadDelete, payload);
    });
    this.#gateway.on("THREAD_LIST_SYNC", (data) =>
      this.emit(ClientEvent.ThreadListSync, data as APIThreadListSync),
    );
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
    this.#gateway.on("STAGE_INSTANCE_CREATE", (data) =>
      this.emit(ClientEvent.StageInstanceCreate, data as APIStageInstance),
    );
    this.#gateway.on("STAGE_INSTANCE_UPDATE", (data) =>
      this.emit(ClientEvent.StageInstanceUpdate, data as APIStageInstance),
    );
    this.#gateway.on("STAGE_INSTANCE_DELETE", (data) =>
      this.emit(ClientEvent.StageInstanceDelete, data as APIStageInstance),
    );

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
      this.emit(ClientEvent.VoiceServerUpdate, data as APIVoiceServerUpdate),
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
        createInteraction(this, data as any),
      ),
    );

    // ── Raw / Error ───────────────────────────────────────────────────────────
    this.#gateway.on("RAW", (data) =>
      this.emit(ClientEvent.Raw, data as { event: string; data: unknown }),
    );
    this.#gateway.on("ERROR", (error) =>
      this.emit(
        ClientEvent.Error,
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
  }

  /**
   * Convenience method to connect the bot to Discord.
   * Optionally overrides the configured token.
   * @param token Optional token override.
   * @returns The token used to log in.
   * @throws {TypeError} If the resulting token is empty.
   */
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
    return this.rest.patch(
      Routes.interactionOriginalResponse(this.user?.id ?? "0", token),
      data,
    );
  }
  public deleteInteractionReply(token: string): Promise<void> {
    return this.rest.delete(
      Routes.interactionOriginalResponse(this.user?.id ?? "0", token),
    );
  }
  public followUpInteraction(
    token: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.rest.post(`/webhooks/${this.user?.id ?? "0"}/${token}`, data);
  }
}

// ─── ClientEvents type map ────────────────────────────────────────────────────
// Uses string literal keys so client.on("ready", ...) works without using
// the ClientEvent enum explicitly.

export type ClientEvents = {
  // ── Lifecycle ──────────────────────────────────────────────────────────────
  ready: [user: ClientUser];
  raw: [data: { event: string; data: unknown }];
  error: [error: Error];
  open: [];
  close: [data: { code: number; action: string }];
  // ── Messages ───────────────────────────────────────────────────────────────
  messageCreate: [message: Message];
  messageUpdate: [message: Message];
  messageDelete: [data: APIMessageDeleteEvent];
  messageDeleteBulk: [data: APIMessageDeleteBulkEvent];
  // ── Reactions ─────────────────────────────────────────────────────────────
  messageReactionAdd: [data: APIMessageReactionEvent];
  messageReactionRemove: [data: APIMessageReactionEvent];
  messageReactionRemoveAll: [data: APIMessageDeleteEvent];
  messageReactionRemoveEmoji: [data: APIMessageReactionRemoveEmojiEvent];
  // ── Polls ─────────────────────────────────────────────────────────────────
  messagePollVoteAdd: [data: APIMessagePollVoteEvent];
  messagePollVoteRemove: [data: APIMessagePollVoteEvent];
  // ── Guilds ────────────────────────────────────────────────────────────────
  guildCreate: [data: APIGuild];
  guildUpdate: [data: APIGuild];
  guildDelete: [data: { id: string; unavailable?: boolean }];
  guildAvailable: [data: APIGuild & { unavailable?: boolean }];
  guildUnavailable: [data: { id: string; unavailable?: boolean }];
  // ── Guild Members ──────────────────────────────────────────────────────────
  guildMemberAdd: [member: APIGuildMember];
  guildMemberUpdate: [member: APIGuildMember];
  guildMemberRemove: [member: APIGuildMember];
  guildMembersChunk: [data: APIGuildMembersChunk];
  // ── Guild Bans ────────────────────────────────────────────────────────────
  guildBanAdd: [data: APIGuildBanEvent];
  guildBanRemove: [data: APIGuildBanEvent];
  // ── Guild Roles ───────────────────────────────────────────────────────────
  guildRoleCreate: [data: APIGuildRoleEvent];
  guildRoleUpdate: [data: APIGuildRoleEvent];
  guildRoleDelete: [data: APIGuildRoleDeleteEvent];
  // ── Guild Emojis & Stickers ───────────────────────────────────────────────
  guildEmojisUpdate: [data: APIGuildEmojisUpdateEvent];
  guildStickersUpdate: [data: APIGuildStickersUpdateEvent];
  // ── Guild Integrations ────────────────────────────────────────────────────
  guildIntegrationsUpdate: [data: { guild_id: string }];
  // ── Guild Scheduled Events ────────────────────────────────────────────────
  guildScheduledEventCreate: [data: APIGuildScheduledEvent];
  guildScheduledEventUpdate: [data: APIGuildScheduledEvent];
  guildScheduledEventDelete: [data: APIGuildScheduledEvent];
  guildScheduledEventUserAdd: [data: APIGuildScheduledEventUserEvent];
  guildScheduledEventUserRemove: [data: APIGuildScheduledEventUserEvent];
  // ── AutoMod ───────────────────────────────────────────────────────────────
  autoModerationRuleCreate: [data: APIAutoModerationRule];
  autoModerationRuleUpdate: [data: APIAutoModerationRule];
  autoModerationRuleDelete: [data: APIAutoModerationRule];
  autoModerationActionExecution: [data: APIAutoModerationActionExecution];
  // ── Channels ──────────────────────────────────────────────────────────────
  channelCreate: [channel: Channel];
  channelUpdate: [channel: Channel];
  channelDelete: [data: APIChannel];
  channelPinsUpdate: [data: APIChannelPinsUpdate];
  // ── Threads ───────────────────────────────────────────────────────────────
  threadCreate: [channel: Channel];
  threadUpdate: [channel: Channel];
  threadDelete: [data: APIThreadEvent];
  threadListSync: [data: APIThreadListSync];
  threadMembersUpdate: [data: APIThreadMembersUpdate];
  threadMemberUpdate: [data: APIThreadMember];
  // ── Stage Instances ───────────────────────────────────────────────────────
  stageInstanceCreate: [data: APIStageInstance];
  stageInstanceUpdate: [data: APIStageInstance];
  stageInstanceDelete: [data: APIStageInstance];
  // ── Invites ───────────────────────────────────────────────────────────────
  inviteCreate: [data: APIInviteCreate];
  inviteDelete: [data: APIInviteDelete];
  // ── Webhooks ──────────────────────────────────────────────────────────────
  webhooksUpdate: [data: APIWebhooksUpdate];
  // ── Voice ─────────────────────────────────────────────────────────────────
  voiceStateUpdate: [data: APIVoiceState];
  voiceServerUpdate: [data: APIVoiceServerUpdate];
  // ── Presence & Typing ─────────────────────────────────────────────────────
  presenceUpdate: [data: APIPresenceUpdate];
  typingStart: [data: APITypingStart];
  // ── Interactions ──────────────────────────────────────────────────────────
  interactionCreate: [interaction: Interaction];
};
