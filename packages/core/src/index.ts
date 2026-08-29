import { Collection } from "@lunibee/collection";
import { ChannelManager, GuildManager, UserManager } from "@lunibee/managers";
import { REST, Routes } from "@lunibee/rest";
import { User, Guild, Channel, Message, Interaction, createInteraction, type InteractionClient, type ResourceContext } from "@lunibee/structures";
import { Gateway } from "@lunibee/ws";
import type { APIChannel, APIGuild, APIGuildMember, APIMessageDeleteBulkEvent, APIMessageDeleteEvent, APIMessageReactionEvent, APIReadyEvent, APIThreadEvent, ClientOptions, ClientUser } from "@lunibee/types";

/** Events emitted by the Lunibee client. */
export interface ClientEvents {
    /** Client is ready. @param user Authenticated bot user. */ ready: [ClientUser];
    /** Raw gateway dispatch envelope. @param payload Gateway event name and payload. */ raw: [{ event: string; data: unknown }];
    /** An asynchronous listener or gateway error. @param error Normalized error. */ error: [Error];
    /** Gateway opened. */ open: [];
    /** Gateway closed. @param info Gateway close information. */ close: [{ code: number; action: string }];
    /** Message created. @param message Hydrated message structure. */ messageCreate: [Message];
    /** Message updated. @param message Hydrated message structure. */ messageUpdate: [Message];
    /** Message deleted. @param payload Discord deletion payload. */ messageDelete: [APIMessageDeleteEvent];
    /** Messages deleted in bulk. @param payload Discord bulk deletion payload. */ messageDeleteBulk: [APIMessageDeleteBulkEvent];
    /** Guild became available. @param guild Hydrated guild structure. */ guildCreate: [Guild];
    /** Guild updated. @param guild Hydrated guild structure. */ guildUpdate: [Guild];
    /** Guild became unavailable or was removed. @param payload Discord guild deletion payload. */ guildDelete: [{ id: string; unavailable?: boolean }];
    /** Channel created. @param channel Hydrated channel structure. */ channelCreate: [Channel];
    /** Channel updated. @param channel Hydrated channel structure. */ channelUpdate: [Channel];
    /** Channel deleted. @param payload Deleted channel payload. */ channelDelete: [APIChannel];
    /** Thread created. @param channel Hydrated thread structure. */ threadCreate: [Channel];
    /** Thread updated. @param channel Hydrated thread structure. */ threadUpdate: [Channel];
    /** Thread deleted. @param payload Deleted thread payload. */ threadDelete: [APIThreadEvent];
    /** Guild member added. @param member Guild member payload. */ guildMemberAdd: [APIGuildMember];
    /** Guild member updated. @param member Guild member payload. */ guildMemberUpdate: [APIGuildMember];
    /** Guild member removed. @param member Removed member payload. */ guildMemberRemove: [APIGuildMember];
    /** A reaction was added to a message. @param payload Reaction event payload. */ messageReactionAdd: [APIMessageReactionEvent];
    /** A reaction was removed from a message. @param payload Reaction event payload. */ messageReactionRemove: [APIMessageReactionEvent];
    /** All reactions were removed from a message. @param payload Reaction removal payload. */ messageReactionRemoveAll: [APIMessageDeleteEvent];
    /** Interaction created. @param interaction Hydrated interaction structure. */ interactionCreate: [Interaction];
}

/** Lifecycle state of a client. */
export type ClientState = "idle" | "connecting" | "ready" | "destroyed";
type Listener<T extends unknown[]> = (...args: T) => unknown;

/** Minimal typed event emitter used by the client. */
class EventEmitter<Events extends Record<string, unknown[]>> {
    readonly #listeners = new Map<keyof Events, Set<Listener<any>>>();
    /** Registers a listener. @param event Event name. @param listener Listener callback. @returns This emitter. @throws {TypeError} If listener is not callable. */
    public on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this { if (typeof listener !== "function") throw new TypeError("Event listener must be a function."); let listeners = this.#listeners.get(event); if (!listeners) this.#listeners.set(event, listeners = new Set()); listeners.add(listener); return this; }
    /** Registers a one-shot listener. @param event Event name. @param listener Listener callback. @returns This emitter. @throws {TypeError} If listener is not callable. */
    public once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this { const wrapped: Listener<Events[K]> = (...args) => { this.off(event, wrapped); return listener(...args); }; return this.on(event, wrapped); }
    /** Removes a listener. @param event Event name. @param listener Listener callback. @returns This emitter. */
    public off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this { this.#listeners.get(event)?.delete(listener); return this; }
    /** Removes listeners. @param event Optional event name. @returns This emitter. */
    public removeAllListeners<K extends keyof Events>(event?: K): this { if (event === undefined) this.#listeners.clear(); else this.#listeners.delete(event); return this; }
    /** Emits an event. @param event Event name. @param args Event arguments. @returns Whether listeners were invoked. */
    protected emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean { const listeners = this.#listeners.get(event); if (!listeners?.size) return false; for (const listener of [...listeners]) { try { const result = listener(...args); if (result && typeof (result as PromiseLike<unknown>).then === "function") void Promise.resolve(result).catch(error => this.#handleError(event, error)); } catch (error) { this.#handleError(event, error); } } return true; }
    /** Normalizes listener failures and forwards them to error listeners. @param event Event whose listener failed. @param error Listener failure. @returns Nothing. */
    #handleError(event: keyof Events, error: unknown): void { if (event === "error") return; const normalized = error instanceof Error ? error : new Error(String(error), { cause: error }); for (const listener of [...(this.#listeners.get("error" as keyof Events) ?? [])]) { try { void listener(normalized); } catch {} } }
}

/** Main Lunibee Discord client. */
export class Client extends EventEmitter<ClientEvents> implements InteractionClient {
    /** REST transport used by all managers. */ public readonly rest: REST;
    /** User resource manager. */ public readonly users: UserManager;
    /** Guild resource manager. */ public readonly guilds: GuildManager;
    /** Channel and message resource manager. */ public readonly channels: ChannelManager;
    /** Current authenticated bot user. */ public user?: ClientUser;
    /** Time at which the gateway became ready. */ public readyAt?: Date;
    /** Current client lifecycle state. */ public state: ClientState = "idle";
    readonly #gateway: Gateway;
    readonly #resourceContext: ResourceContext;

    /** Creates a client and initializes REST, resource managers, and gateway lifecycle handlers. @param options Client configuration. @throws {TypeError} If no token is supplied. */
    public constructor(public readonly options: ClientOptions) {
        super();
        if (!options.token?.trim()) throw new TypeError("Client token is required.");
        this.rest = new REST({ token: options.token, ...options.rest });
        this.users = new UserManager(this.rest);
        this.guilds = new GuildManager(this.rest);
        this.channels = new ChannelManager(this.rest);
        this.#resourceContext = { sendMessage: (channelId, options) => this.channels.send(channelId, options), editMessage: (channelId, messageId, options) => this.channels.editMessage(channelId, messageId, options), deleteMessage: (channelId, messageId) => this.channels.deleteMessage(channelId, messageId), crosspostMessage: (channelId, messageId) => this.channels.crosspostMessage(channelId, messageId) };
        this.#gateway = new Gateway({ token: options.token, intents: options.intents, ...options.gateway });
        this.#gateway.on("READY", data => { const ready = data as APIReadyEvent; this.user = ready.user; this.users.set(this.user.id, new User(this.user)); this.readyAt = new Date(); this.state = "ready"; this.emit("ready", this.user); });
        this.#gateway.on("open", () => this.emit("open"));
        this.#gateway.on("close", data => { if (this.state !== "destroyed") this.state = "idle"; this.emit("close", data as { code: number; action: string }); });
        this.#gateway.on("MESSAGE_CREATE", data => { const message = new Message(data as import("@lunibee/types").APIMessage, this.#resourceContext); this.channels.set(message.channelId, message.channel); this.users.set(message.author.id, message.author); this.emit("messageCreate", message); });
        this.#gateway.on("MESSAGE_UPDATE", data => { const message = new Message(data as import("@lunibee/types").APIMessage, this.#resourceContext); this.channels.set(message.channelId, message.channel); this.users.set(message.author.id, message.author); this.emit("messageUpdate", message); });
        this.#gateway.on("MESSAGE_DELETE", data => this.emit("messageDelete", data as APIMessageDeleteEvent));
        this.#gateway.on("MESSAGE_DELETE_BULK", data => this.emit("messageDeleteBulk", data as APIMessageDeleteBulkEvent));
        this.#gateway.on("GUILD_CREATE", data => { const guild = new Guild(data as APIGuild); this.guilds.set(guild.id, guild); const payload = data as APIGuild & { members?: APIGuildMember[]; channels?: APIChannel[]; threads?: APIChannel[] }; for (const member of payload.members ?? []) this.users.set(member.user.id, new User(member.user)); for (const channelData of [...(payload.channels ?? []), ...(payload.threads ?? [])]) { const channel = new Channel(channelData, this.#resourceContext); this.channels.set(channel.id, channel); } this.emit("guildCreate", guild); });
        this.#gateway.on("GUILD_UPDATE", data => { const guild = new Guild(data as APIGuild); this.guilds.update(guild); this.emit("guildUpdate", guild); });
        this.#gateway.on("GUILD_DELETE", data => { const payload = data as { id: string; unavailable?: boolean }; if (!payload.unavailable) this.guilds.delete(payload.id); this.emit("guildDelete", payload); });
        this.#gateway.on("CHANNEL_CREATE", data => { const channel = new Channel(data as APIChannel, this.#resourceContext); this.channels.update(channel); this.emit("channelCreate", channel); });
        this.#gateway.on("CHANNEL_UPDATE", data => { const channel = new Channel(data as APIChannel, this.#resourceContext); this.channels.update(channel); this.emit("channelUpdate", channel); });
        this.#gateway.on("CHANNEL_DELETE", data => { const payload = data as APIChannel; this.channels.delete(payload.id); this.emit("channelDelete", payload); });
        this.#gateway.on("THREAD_CREATE", data => { const channel = new Channel(data as APIThreadEvent, this.#resourceContext); this.channels.update(channel); this.emit("threadCreate", channel); });
        this.#gateway.on("THREAD_UPDATE", data => { const channel = new Channel(data as APIThreadEvent, this.#resourceContext); this.channels.update(channel); this.emit("threadUpdate", channel); });
        this.#gateway.on("THREAD_DELETE", data => { const payload = data as APIThreadEvent; this.channels.delete(payload.id); this.emit("threadDelete", payload); });
        this.#gateway.on("GUILD_MEMBER_ADD", data => { const member = data as APIGuildMember; this.users.set(member.user.id, new User(member.user)); this.emit("guildMemberAdd", member); });
        this.#gateway.on("GUILD_MEMBER_UPDATE", data => { const member = data as APIGuildMember; this.users.set(member.user.id, new User(member.user)); this.emit("guildMemberUpdate", member); });
        this.#gateway.on("GUILD_MEMBER_REMOVE", data => this.emit("guildMemberRemove", data as APIGuildMember));
        this.#gateway.on("MESSAGE_REACTION_ADD", data => this.emit("messageReactionAdd", data as APIMessageReactionEvent));
        this.#gateway.on("MESSAGE_REACTION_REMOVE", data => this.emit("messageReactionRemove", data as APIMessageReactionEvent));
        this.#gateway.on("MESSAGE_REACTION_REMOVE_ALL", data => this.emit("messageReactionRemoveAll", data as APIMessageDeleteEvent));
        this.#gateway.on("INTERACTION_CREATE", data => this.emit("interactionCreate", createInteraction(this, data as any)));
        for (const event of ["READY", "MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "GUILD_CREATE", "GUILD_UPDATE", "GUILD_DELETE", "CHANNEL_CREATE", "CHANNEL_UPDATE", "CHANNEL_DELETE", "THREAD_CREATE", "THREAD_UPDATE", "THREAD_DELETE", "GUILD_MEMBER_ADD", "GUILD_MEMBER_UPDATE", "GUILD_MEMBER_REMOVE", "MESSAGE_REACTION_ADD", "MESSAGE_REACTION_REMOVE", "MESSAGE_REACTION_REMOVE_ALL", "INTERACTION_CREATE"]) this.#gateway.on(event, data => this.emit("raw", { event, data }));
        this.#gateway.on("error", data => this.emit("error", data as Error));
    }

    /** Indicates whether the client has completed gateway readiness. @returns True when ready. */
    public isReady(): this is Client & { user: ClientUser; readyAt: Date } { return this.state === "ready" && this.user !== undefined && this.readyAt !== undefined; }
    /** Connects the REST and gateway clients. @returns A promise fulfilled after connection succeeds. @throws {Error} If the client is destroyed or connection fails. */
    public async login(): Promise<void> { if (this.state === "destroyed") throw new Error("Cannot login a destroyed client."); if (this.state === "connecting" || this.state === "ready") return; this.state = "connecting"; try { this.user = await this.rest.get<ClientUser>(Routes.user()); this.users.set(this.user.id, new User(this.user)); await this.#gateway.connect(); } catch (error) { this.state = "idle"; throw error; } }
    /** Closes the gateway and destroys cached resources. @returns Nothing. */
    public destroy(): void { if (this.state === "destroyed") return; this.#gateway.close(); this.users.clear(); this.guilds.clear(); this.channels.clear(); this.state = "destroyed"; this.readyAt = undefined; this.user = undefined; }
    /** Posts an interaction callback through REST. @param id Interaction identifier. @param token Interaction token. @param response Interaction response. @returns REST response. @throws {Error} If REST rejects the request. */
    public postInteractionResponse(id: string, token: string, response: import("@lunibee/structures").InteractionResponse): Promise<unknown> { return this.rest.post(`/interactions/${id}/${token}/callback`, response.toJSON()); }
    /** Edits the original interaction response. @param token Interaction token. @param data Reply payload. @returns REST response. @throws {Error} If the authenticated client user is unavailable. */
    public editInteractionReply(token: string, data: import("@lunibee/structures").InteractionReplyOptions): Promise<unknown> { if (!this.user?.id) throw new Error("Client user is unavailable; login is required."); return this.rest.patch(`/webhooks/${this.user.id}/${token}/messages/@original`, data); }
    /** Deletes the original interaction response. @param token Interaction token. @returns Nothing. @throws {Error} If the authenticated client user is unavailable or REST rejects the request. */
    public async deleteInteractionReply(token: string): Promise<void> { if (!this.user?.id) throw new Error("Client user is unavailable; login is required."); await this.rest.delete(`/webhooks/${this.user.id}/${token}/messages/@original`); }
}

export { Collection } from "@lunibee/collection";
export { REST, RESTError, Routes } from "@lunibee/rest";
export { Gateway, GatewayError, GatewayOpcodes } from "@lunibee/ws";
export { User, Guild, Channel, Message, type ResourceContext } from "@lunibee/structures";
export { EmbedBuilder, ButtonBuilder, ActionRowBuilder, StringSelectBuilder, SlashCommandBuilder, StringOptionBuilder } from "@lunibee/builders";
export * from "@lunibee/types";
export { Manager, ResourceManager, UserManager, GuildManager, ChannelManager, MessageCreateOptions, MessageEditOptions, MessageFetchOptions, MessageThreadOptions, ReactionFetchOptions } from "@lunibee/managers";
