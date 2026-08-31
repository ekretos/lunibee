export {
  Permission,
  Permissions,
  PermissionFlagsBits,
  PermissionSet,
  PermissionsBitField,
  PermissionOverwriteType,
  type PermissionName,
} from "./permissions.js";
export { ClientEvent, type ClientEventName, type ClientListener } from "./events.js";

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
  APIMessageDeleteBulkEvent,
  APIMessageDeleteEvent,
  APIMessageReactionEvent,
  APIReadyEvent,
  APIRole,
  APIThreadEvent,
  ClientOptions,
  ClientUser,
} from "@lunibee/types";
import type { ClientEvents } from "./events.js";
export type { ClientEvents } from "./events.js";

/** Lifecycle state of a client. */
export type ClientState = "idle" | "connecting" | "ready" | "destroyed";
type Listener<T extends unknown[]> = (...args: T) => unknown;

/** Minimal typed event emitter used by the client. */
class EventEmitter<Events extends { [K in keyof Events]: unknown[] }> {
  readonly #listeners = new Map<keyof Events, Set<Listener<any>>>();
  public on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    if (typeof listener !== "function") throw new TypeError("Event listener must be a function.");
    let listeners = this.#listeners.get(event);
    if (!listeners) this.#listeners.set(event, (listeners = new Set()));
    listeners.add(listener);
    return this;
  }
  public once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    const wrapped: Listener<Events[K]> = (...args) => { this.off(event, wrapped); return listener(...args); };
    return this.on(event, wrapped);
  }
  public off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    this.#listeners.get(event)?.delete(listener);
    return this;
  }
  public removeAllListeners<K extends keyof Events>(event?: K): this {
    if (event === undefined) this.#listeners.clear(); else this.#listeners.delete(event);
    return this;
  }
  protected emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
    const listeners = this.#listeners.get(event);
    if (!listeners?.size) return false;
    for (const listener of [...listeners]) {
      try {
        const result = listener(...args);
        if (result && typeof (result as PromiseLike<unknown>).then === "function")
          void Promise.resolve(result).catch((error) => this.#handleError(event, error));
      } catch (error) { this.#handleError(event, error); }
    }
    return true;
  }
  #handleError(event: keyof Events, error: unknown): void {
    if (event === ClientEvent.Error) return;
    const normalized = error instanceof Error ? error : new Error(String(error), { cause: error });
    for (const listener of [...(this.#listeners.get(ClientEvent.Error as keyof Events) ?? [])]) {
      try { void listener(normalized); } catch {}
    }
  }
}

/** Main Lunibee Discord client. */
export class Client extends EventEmitter<ClientEvents> implements InteractionClient {
  public readonly rest: REST;
  public readonly users: UserManager;
  public readonly guilds: GuildManager;
  public readonly channels: ChannelManager;
  public readonly application: { commands: ApplicationCommandManager };
  public get ws(): Gateway { return this.#gateway; }
  public get gateway(): Gateway { return this.#gateway; }
  public user?: ClientUser;
  public readyAt?: Date;
  public state: ClientState = "idle";
  public get uptime(): number | null { return this.readyAt ? Date.now() - this.readyAt.getTime() : null; }
  readonly #gateway: Gateway;
  readonly #resourceContext: ResourceContext;
  public constructor(public readonly options: ClientOptions) {
    super();
    if (!options.token?.trim()) throw new TypeError("Client token is required.");
    this.rest = new REST({ token: options.token, ...options.rest });
    this.users = new UserManager(this.rest);
    this.guilds = new GuildManager(this.rest);
    this.channels = new ChannelManager(this.rest);
    const placeholderAppCommands = new ApplicationCommandManager(this.rest, "0");
    this.application = { commands: placeholderAppCommands };
    this.#resourceContext = {
      sendMessage: (channelId, options) => this.channels.send(channelId, options),
      editMessage: (channelId, messageId, options) => this.channels.editMessage(channelId, messageId, options),
      deleteMessage: (channelId, messageId) => this.channels.deleteMessage(channelId, messageId),
      crosspostMessage: (channelId, messageId) => this.channels.crosspostMessage(channelId, messageId),
    };
    this.#gateway = new Gateway({ token: options.token, intents: options.intents, ...options.gateway });
    this.#gateway.on("READY", (data) => {
      const ready = data as APIReadyEvent;
      this.user = ready.user;
      this.users.set(this.user.id, new User(this.user));
      this.readyAt = new Date();
      this.state = "ready";
      const appId = ready.application?.id ?? this.user.id;
      (this.application as { commands: ApplicationCommandManager }).commands = new ApplicationCommandManager(this.rest, appId);
      this.emit(ClientEvent.Ready, this.user);
    });
    this.#gateway.on("open", () => this.emit(ClientEvent.Open));
    this.#gateway.on("close", (data) => {
      if (this.state !== "destroyed") this.state = "idle";
      this.emit(ClientEvent.Close, data as { code: number; action: string });
    });
    this.#gateway.on("MESSAGE_CREATE", (data) => {
      const message = new Message(data as import("@lunibee/types").APIMessage, this.#resourceContext);
      this.channels.set(message.channelId, message.channel);
      this.users.set(message.author.id, message.author);
      this.emit(ClientEvent.MessageCreate, message);
    });
    this.#gateway.on("MESSAGE_UPDATE", (data) => {
      const message = new Message(data as import("@lunibee/types").APIMessage, this.#resourceContext);
      this.channels.set(message.channelId, message.channel);
      this.users.set(message.author.id, message.author);
      this.emit(ClientEvent.MessageUpdate, message);
    });
    this.#gateway.on("MESSAGE_DELETE", (data) => this.emit(ClientEvent.MessageDelete, data as APIMessageDeleteEvent));
    this.#gateway.on("MESSAGE_DELETE_BULK", (data) => this.emit(ClientEvent.MessageDeleteBulk, data as APIMessageDeleteBulkEvent));
    this.#gateway.on("GUILD_CREATE", (data) => {
      const guild = new Guild(data as APIGuild);
      this.guilds.set(guild.id, guild);
      const payload = data as APIGuild & { members?: APIGuildMember[]; channels?: APIChannel[]; threads?: APIChannel[] };
      for (const member of payload.members ?? []) this.users.set(member.user.id, new User(member.user));
      for (const channelData of [...(payload.channels ?? []), ...(payload.threads ?? [])]) this.channels.set(channelData.id, new Channel(channelData, this.#resourceContext));
      this.emit(ClientEvent.GuildCreate, data as APIGuild);
    });
    this.#gateway.on("GUILD_UPDATE", (data) => { const guild = new Guild(data as APIGuild); this.guilds.update(guild); this.emit(ClientEvent.GuildUpdate, data as APIGuild); });
    this.#gateway.on("GUILD_DELETE", (data) => { const payload = data as { id: string; unavailable?: boolean }; if (!payload.unavailable) this.guilds.delete(payload.id); this.emit(ClientEvent.GuildDelete, payload); });
    this.#gateway.on("CHANNEL_CREATE", (data) => { const channel = new Channel(data as APIChannel, this.#resourceContext); this.channels.update(channel); this.emit(ClientEvent.ChannelCreate, channel); });
    this.#gateway.on("CHANNEL_UPDATE", (data) => { const channel = new Channel(data as APIChannel, this.#resourceContext); this.channels.update(channel); this.emit(ClientEvent.ChannelUpdate, channel); });
    this.#gateway.on("CHANNEL_DELETE", (data) => { const payload = data as APIChannel; this.channels.delete(payload.id); this.emit(ClientEvent.ChannelDelete, payload); });
    this.#gateway.on("THREAD_CREATE", (data) => { const channel = new Channel(data as APIThreadEvent, this.#resourceContext); this.channels.update(channel); this.emit(ClientEvent.ThreadCreate, channel); });
    this.#gateway.on("THREAD_UPDATE", (data) => { const channel = new Channel(data as APIThreadEvent, this.#resourceContext); this.channels.update(channel); this.emit(ClientEvent.ThreadUpdate, channel); });
    this.#gateway.on("THREAD_DELETE", (data) => { const payload = data as APIThreadEvent; this.channels.delete(payload.id); this.emit(ClientEvent.ThreadDelete, payload); });
    this.#gateway.on("GUILD_MEMBER_ADD", (data) => { const member = data as APIGuildMember; this.users.set(member.user.id, new User(member.user)); this.emit(ClientEvent.GuildMemberAdd, member); });
    this.#gateway.on("GUILD_MEMBER_UPDATE", (data) => { const member = data as APIGuildMember; this.users.set(member.user.id, new User(member.user)); this.emit(ClientEvent.GuildMemberUpdate, member); });
    this.#gateway.on("GUILD_MEMBER_REMOVE", (data) => this.emit(ClientEvent.GuildMemberRemove, data as APIGuildMember));
    this.#gateway.on("MESSAGE_REACTION_ADD", (data) => this.emit(ClientEvent.MessageReactionAdd, data as APIMessageReactionEvent));
    this.#gateway.on("MESSAGE_REACTION_REMOVE", (data) => this.emit(ClientEvent.MessageReactionRemove, data as APIMessageReactionEvent));
    this.#gateway.on("MESSAGE_REACTION_REMOVE_ALL", (data) => this.emit(ClientEvent.MessageReactionRemoveAll, data as APIMessageDeleteEvent));
    this.#gateway.on("INTERACTION_CREATE", (data) => this.emit(ClientEvent.InteractionCreate, createInteraction(this, data as any)));
    this.#gateway.on("GUILD_ROLE_CREATE", (data) => this.emit(ClientEvent.GuildRoleCreate, data as APIGuildRoleEvent));
    this.#gateway.on("GUILD_ROLE_UPDATE", (data) => this.emit(ClientEvent.GuildRoleUpdate, data as APIGuildRoleEvent));
    this.#gateway.on("GUILD_ROLE_DELETE", (data) => this.emit(ClientEvent.GuildRoleDelete, data as APIGuildRoleDeleteEvent));
    this.#gateway.on("GUILD_BAN_ADD", (data) => this.emit(ClientEvent.GuildBanAdd, data as APIGuildBanEvent));
    this.#gateway.on("GUILD_BAN_REMOVE", (data) => this.emit(ClientEvent.GuildBanRemove, data as APIGuildBanEvent));
    this.#gateway.on("GUILD_EMOJIS_UPDATE", (data) => this.emit(ClientEvent.GuildEmojisUpdate, data as APIGuildEmojisUpdateEvent));
    this.#gateway.on("RAW", (data) => this.emit(ClientEvent.Raw, data as { event: string; data: unknown }));
    this.#gateway.on("ERROR", (error) => this.emit(ClientEvent.Error, error instanceof Error ? error : new Error(String(error))));
  }
}
