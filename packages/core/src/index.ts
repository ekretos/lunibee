import { Collection } from "@lunibee/collection";
import { Manager } from "@lunibee/managers";
import { REST, Routes, type RESTOptions } from "@lunibee/rest";
import { User, Guild, Channel, Message, Interaction, createInteraction, type InteractionClient } from "@lunibee/structures";
import { Gateway, type GatewayOptions } from "@lunibee/ws";
import type { ClientOptions, ClientUser } from "@lunibee/types";

type Listener<T extends unknown[]> = (...args: T) => unknown;

/** Complete typed Gateway event surface exposed by the client. */
export interface ClientEvents {
    ready: [ClientUser];
    raw: [{ event: string | null; data: unknown }];
    error: [Error];
    resume: [];
    reconnect: [];
    invalidSession: [boolean];
    messageCreate: [Message];
    messageUpdate: [Message];
    messageDelete: [unknown];
    messageDeleteBulk: [unknown];
    messageReactionAdd: [unknown];
    messageReactionRemove: [unknown];
    messageReactionRemoveAll: [unknown];
    messageReactionRemoveEmoji: [unknown];
    messageCreateThread: [unknown];
    threadCreate: [unknown];
    threadUpdate: [unknown];
    threadDelete: [unknown];
    threadListSync: [unknown];
    threadMemberUpdate: [unknown];
    threadMembersUpdate: [unknown];
    guildCreate: [Guild];
    guildUpdate: [Guild];
    guildDelete: [unknown];
    guildBanAdd: [unknown];
    guildBanRemove: [unknown];
    guildEmojisUpdate: [unknown];
    guildIntegrationsUpdate: [unknown];
    guildMemberAdd: [unknown];
    guildMemberRemove: [unknown];
    guildMemberUpdate: [unknown];
    guildMembersChunk: [unknown];
    guildRoleCreate: [unknown];
    guildRoleUpdate: [unknown];
    guildRoleDelete: [unknown];
    guildScheduledEventCreate: [unknown];
    guildScheduledEventUpdate: [unknown];
    guildScheduledEventDelete: [unknown];
    guildScheduledEventUserAdd: [unknown];
    guildScheduledEventUserRemove: [unknown];
    guildStickersUpdate: [unknown];
    inviteCreate: [unknown];
    inviteDelete: [unknown];
    presenceUpdate: [unknown];
    stageInstanceCreate: [unknown];
    stageInstanceUpdate: [unknown];
    stageInstanceDelete: [unknown];
    typingStart: [unknown];
    userUpdate: [unknown];
    voiceStateUpdate: [unknown];
    voiceServerUpdate: [unknown];
    webhooksUpdate: [unknown];
    interactionCreate: [Interaction];
    autoModerationRuleCreate: [unknown];
    autoModerationRuleUpdate: [unknown];
    autoModerationRuleDelete: [unknown];
    autoModerationActionExecution: [unknown];
    soundboardSoundsUpdate: [unknown];
    entitlementCreate: [unknown];
    entitlementUpdate: [unknown];
    entitlementDelete: [unknown];
    messagePollVoteAdd: [unknown];
    messagePollVoteRemove: [unknown];
}

/** Typed event dispatcher with listener isolation. */
class EventEmitter<Events extends Record<string, unknown[]>> {
    readonly #listeners = new Map<keyof Events, Set<Listener<any>>>();
    /** Registers an event listener. */
    public on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this { if (typeof listener !== "function") throw new TypeError("Event listener must be a function."); let listeners = this.#listeners.get(event); if (!listeners) this.#listeners.set(event, listeners = new Set()); listeners.add(listener); return this; }
    /** Registers a one-time event listener. */
    public once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this { const wrapped: Listener<Events[K]> = (...args) => { this.off(event, wrapped); return listener(...args); }; return this.on(event, wrapped); }
    /** Removes an event listener. */
    public off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this { this.#listeners.get(event)?.delete(listener); return this; }
    /** Removes all listeners. */
    public removeAllListeners<K extends keyof Events>(event?: K): this { if (event === undefined) this.#listeners.clear(); else this.#listeners.delete(event); return this; }
    /** Emits an event and isolates consumer failures. */
    protected emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean { const listeners = this.#listeners.get(event); if (!listeners?.size) return false; for (const listener of [...listeners]) { try { const result = listener(...args); if (result && typeof (result as PromiseLike<unknown>).then === "function") void Promise.resolve(result).catch(error => this.#handleError(event, error)); } catch (error) { this.#handleError(event, error); } } return true; }
    #handleError(event: keyof Events, error: unknown): void { if (event === "error") return; const normalized = error instanceof Error ? error : new Error(String(error), { cause: error }); for (const listener of [...(this.#listeners.get("error" as keyof Events) ?? [])]) { try { void listener(normalized); } catch { /* Error handlers are isolated. */ } } }
}

/** Current client lifecycle state. */
export type ClientState = "idle" | "logging-in" | "ready" | "destroyed";

/** Lightweight Bun-first Discord client. */
export class Client extends EventEmitter<ClientEvents> implements InteractionClient {
    /** REST transport. */ public readonly rest: REST;
    /** Cached users. */ public readonly users = new Manager<string, User>();
    /** Cached guilds. */ public readonly guilds = new Manager<string, Guild>();
    /** Cached channels. */ public readonly channels = new Manager<string, Channel>();
    /** Current authenticated bot user. */ public user?: ClientUser;
    /** Current lifecycle state. */ public state: ClientState = "idle";
    readonly #gateway: Gateway;
    #loginPromise?: Promise<void>;

    /** Creates a client from Bun/TypeScript-friendly options. */
    public constructor(public readonly options: ClientOptions & { rest?: RESTOptions; gateway?: GatewayOptions }) {
        super();
        if (!options.token?.trim()) throw new TypeError("Client token is required.");
        if (!Number.isInteger(options.intents) || options.intents < 0) throw new RangeError("Client intents must be a non-negative integer.");
        this.rest = new REST({ token: options.token, ...options.rest });
        this.#gateway = new Gateway({ token: options.token, intents: options.intents, ...options.gateway });
        this.#wireGateway();
    }

    /** Logs in once and waits for the initial Gateway connection. */
    public login(): Promise<void> { if (this.state === "destroyed") return Promise.reject(new Error("Client has been destroyed.")); if (this.#loginPromise) return this.#loginPromise; this.state = "logging-in"; this.#loginPromise = this.#performLogin().catch(error => { this.state = "idle"; this.#loginPromise = undefined; throw error; }); return this.#loginPromise; }
    async #performLogin(): Promise<void> { this.user = await this.rest.get<ClientUser>(Routes.user()); await this.#gateway.connect(); this.state = "ready"; }
    /** Permanently destroys the client and closes the Gateway connection. */ public destroy(): void { if (this.state === "destroyed") return; this.state = "destroyed"; this.#gateway.close(); this.removeAllListeners(); }
    /** Sends an interaction callback. */ public postInteractionResponse(id: string, token: string, response: import("@lunibee/structures").InteractionResponse): Promise<unknown> { return this.rest.post(`/interactions/${id}/${token}/callback`, response.toJSON()); }
    /** Edits the original interaction response. */ public editInteractionReply(token: string, data: import("@lunibee/structures").InteractionReplyOptions): Promise<unknown> { if (!this.user?.id) throw new Error("Client user is unavailable; login is required."); return this.rest.patch(`/webhooks/${this.user.id}/${token}/messages/@original`, data); }
    /** Deletes the original interaction response. */ public async deleteInteractionReply(token: string): Promise<void> { if (!this.user?.id) throw new Error("Client user is unavailable; login is required."); await this.rest.delete(`/webhooks/${this.user.id}/${token}/messages/@original`); }

    #wireGateway(): void {
        const directEvents: Record<string, keyof ClientEvents> = {
            READY: "ready", RESUMED: "resume", RECONNECT: "reconnect", INVALID_SESSION: "invalidSession",
            MESSAGE_CREATE: "messageCreate", MESSAGE_UPDATE: "messageUpdate", MESSAGE_DELETE: "messageDelete", MESSAGE_DELETE_BULK: "messageDeleteBulk",
            MESSAGE_REACTION_ADD: "messageReactionAdd", MESSAGE_REACTION_REMOVE: "messageReactionRemove", MESSAGE_REACTION_REMOVE_ALL: "messageReactionRemoveAll", MESSAGE_REACTION_REMOVE_EMOJI: "messageReactionRemoveEmoji",
            THREAD_CREATE: "threadCreate", THREAD_UPDATE: "threadUpdate", THREAD_DELETE: "threadDelete", THREAD_LIST_SYNC: "threadListSync", THREAD_MEMBER_UPDATE: "threadMemberUpdate", THREAD_MEMBERS_UPDATE: "threadMembersUpdate",
            GUILD_CREATE: "guildCreate", GUILD_UPDATE: "guildUpdate", GUILD_DELETE: "guildDelete", GUILD_BAN_ADD: "guildBanAdd", GUILD_BAN_REMOVE: "guildBanRemove", GUILD_EMOJIS_UPDATE: "guildEmojisUpdate", GUILD_INTEGRATIONS_UPDATE: "guildIntegrationsUpdate",
            GUILD_MEMBER_ADD: "guildMemberAdd", GUILD_MEMBER_REMOVE: "guildMemberRemove", GUILD_MEMBER_UPDATE: "guildMemberUpdate", GUILD_MEMBERS_CHUNK: "guildMembersChunk", GUILD_ROLE_CREATE: "guildRoleCreate", GUILD_ROLE_UPDATE: "guildRoleUpdate", GUILD_ROLE_DELETE: "guildRoleDelete",
            GUILD_SCHEDULED_EVENT_CREATE: "guildScheduledEventCreate", GUILD_SCHEDULED_EVENT_UPDATE: "guildScheduledEventUpdate", GUILD_SCHEDULED_EVENT_DELETE: "guildScheduledEventDelete", GUILD_SCHEDULED_EVENT_USER_ADD: "guildScheduledEventUserAdd", GUILD_SCHEDULED_EVENT_USER_REMOVE: "guildScheduledEventUserRemove", GUILD_STICKERS_UPDATE: "guildStickersUpdate",
            INVITE_CREATE: "inviteCreate", INVITE_DELETE: "inviteDelete", PRESENCE_UPDATE: "presenceUpdate", STAGE_INSTANCE_CREATE: "stageInstanceCreate", STAGE_INSTANCE_UPDATE: "stageInstanceUpdate", STAGE_INSTANCE_DELETE: "stageInstanceDelete", TYPING_START: "typingStart", USER_UPDATE: "userUpdate", VOICE_STATE_UPDATE: "voiceStateUpdate", VOICE_SERVER_UPDATE: "voiceServerUpdate", WEBHOOKS_UPDATE: "webhooksUpdate", INTERACTION_CREATE: "interactionCreate",
            AUTO_MODERATION_RULE_CREATE: "autoModerationRuleCreate", AUTO_MODERATION_RULE_UPDATE: "autoModerationRuleUpdate", AUTO_MODERATION_RULE_DELETE: "autoModerationRuleDelete", AUTO_MODERATION_ACTION_EXECUTION: "autoModerationActionExecution", SOUNDBOARD_SOUNDS_UPDATE: "soundboardSoundsUpdate", ENTITLEMENT_CREATE: "entitlementCreate", ENTITLEMENT_UPDATE: "entitlementUpdate", ENTITLEMENT_DELETE: "entitlementDelete", MESSAGE_POLL_VOTE_ADD: "messagePollVoteAdd", MESSAGE_POLL_VOTE_REMOVE: "messagePollVoteRemove"
        };
        for (const [gatewayEvent, clientEvent] of Object.entries(directEvents)) this.#gateway.on(gatewayEvent, data => { if (clientEvent === "ready") { this.user = data as ClientUser; this.state = "ready"; this.emit("ready", this.user); } else if (clientEvent === "resume" || clientEvent === "reconnect") this.emit(clientEvent); else if (clientEvent === "invalidSession") this.emit(clientEvent, Boolean((data as any)?.d)); else if (clientEvent === "messageCreate") this.emit(clientEvent, new Message(data as any)); else if (clientEvent === "messageUpdate") this.emit(clientEvent, new Message(data as any)); else if (clientEvent === "guildCreate") this.emit(clientEvent, new Guild(data as any)); else if (clientEvent === "guildUpdate") this.emit(clientEvent, new Guild(data as any)); else if (clientEvent === "channelCreate") this.emit(clientEvent, new Channel(data as any)); else if (clientEvent === "channelUpdate") this.emit(clientEvent, new Channel(data as any)); else if (clientEvent === "interactionCreate") this.emit(clientEvent, createInteraction(this, data as any)); else this.emit(clientEvent, data as never); });
        this.#gateway.on("error", data => this.emit("error", data instanceof Error ? data : new Error(String(data))));
        for (const [gatewayEvent, clientEvent] of Object.entries(directEvents)) this.#gateway.on(gatewayEvent, data => this.emit("raw", { event: gatewayEvent, data }));
    }
}

export { Collection } from "@lunibee/collection";
export { REST, RESTError, RateLimitError, AuthenticationError, RESTTimeoutError, Routes } from "@lunibee/rest";
export { Gateway, GatewayOpcodes } from "@lunibee/ws";
export { User, Guild, Channel, Message } from "@lunibee/structures";
export { EmbedBuilder, ButtonBuilder, ActionRowBuilder, StringSelectBuilder, SlashCommandBuilder, StringOptionBuilder } from "@lunibee/builders";
export * from "@lunibee/types";
