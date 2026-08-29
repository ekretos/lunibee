import { Collection } from "@lunibee/collection";
import { Manager } from "@lunibee/managers";
import { REST, Routes, type RESTOptions } from "@lunibee/rest";
import { User, Guild, Channel, Message, Interaction, createInteraction, type InteractionClient } from "@lunibee/structures";
import { Gateway, type GatewayOptions } from "@lunibee/ws";
import type { ClientOptions, ClientUser } from "@lunibee/types";

type Listener<T extends unknown[]> = (...args: T) => unknown;

/** Events emitted by the Lunibee client. */
export interface ClientEvents {
    ready: [ClientUser];
    raw: [unknown];
    error: [Error];
    messageCreate: [Message];
    messageUpdate: [Message];
    messageDelete: [unknown];
    guildCreate: [Guild];
    guildUpdate: [Guild];
    guildDelete: [unknown];
    channelCreate: [Channel];
    channelUpdate: [Channel];
    channelDelete: [unknown];
    interactionCreate: [Interaction];
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
    /** Removes all listeners for an event or for the entire emitter. */
    public removeAllListeners<K extends keyof Events>(event?: K): this { if (event === undefined) this.#listeners.clear(); else this.#listeners.delete(event); return this; }
    /** Emits an event and isolates consumer failures. */
    protected emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean { const listeners = this.#listeners.get(event); if (!listeners?.size) return false; for (const listener of [...listeners]) { try { const result = listener(...args); if (result && typeof (result as PromiseLike<unknown>).then === "function") void Promise.resolve(result).catch(error => this.#handleError(event, error)); } catch (error) { this.#handleError(event, error); } } return true; }
    #handleError(event: keyof Events, error: unknown): void { if (event === "error") return; const normalized = error instanceof Error ? error : new Error(String(error), { cause: error }); for (const listener of [...(this.#listeners.get("error" as keyof Events) ?? [])]) { try { void listener(normalized); } catch { /* Error listeners are intentionally isolated. */ } } }
}

/** Current lifecycle state of a client. */
export type ClientState = "idle" | "logging-in" | "ready" | "destroyed";

/** Lightweight Bun-first Discord client. */
export class Client extends EventEmitter<ClientEvents> implements InteractionClient {
    /** REST transport. */ public readonly rest: REST;
    /** Cached users. */ public readonly users = new Manager<string, User>();
    /** Cached guilds. */ public readonly guilds = new Manager<string, Guild>();
    /** Cached channels. */ public readonly channels = new Manager<string, Channel>();
    /** Current authenticated bot user. */ public user?: ClientUser;
    /** Current client lifecycle state. */ public state: ClientState = "idle";
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

    /** Logs in exactly once and waits for the initial Gateway connection. */
    public login(): Promise<void> {
        if (this.state === "destroyed") return Promise.reject(new Error("Client has been destroyed."));
        if (this.#loginPromise) return this.#loginPromise;
        this.state = "logging-in";
        this.#loginPromise = this.#performLogin().catch(error => { this.state = "idle"; this.#loginPromise = undefined; throw error; });
        return this.#loginPromise;
    }

    async #performLogin(): Promise<void> {
        this.user = await this.rest.get<ClientUser>(Routes.user());
        await this.#gateway.connect();
        this.state = "ready";
    }

    /** Permanently destroys the client and closes its Gateway connection. */
    public destroy(): void { if (this.state === "destroyed") return; this.state = "destroyed"; this.#gateway.close(); this.removeAllListeners(); }
    /** Sends an interaction callback. */
    public postInteractionResponse(id: string, token: string, response: import("@lunibee/structures").InteractionResponse): Promise<unknown> { return this.rest.post(`/interactions/${id}/${token}/callback`, response.toJSON()); }
    /** Edits the original interaction response. */
    public editInteractionReply(token: string, data: import("@lunibee/structures").InteractionReplyOptions): Promise<unknown> { if (!this.user?.id) throw new Error("Client user is unavailable; login is required."); return this.rest.patch(`/webhooks/${this.user.id}/${token}/messages/@original`, data); }
    /** Deletes the original interaction response. */
    public async deleteInteractionReply(token: string): Promise<void> { if (!this.user?.id) throw new Error("Client user is unavailable; login is required."); await this.rest.delete(`/webhooks/${this.user.id}/${token}/messages/@original`); }

    #wireGateway(): void {
        this.#gateway.on("READY", data => { this.user = data as ClientUser; this.state = "ready"; this.emit("ready", this.user); });
        const constructors = {
            MESSAGE_CREATE: (data: unknown) => this.emit("messageCreate", new Message(data as any)),
            MESSAGE_UPDATE: (data: unknown) => this.emit("messageUpdate", new Message(data as any)),
            GUILD_CREATE: (data: unknown) => this.emit("guildCreate", new Guild(data as any)),
            GUILD_UPDATE: (data: unknown) => this.emit("guildUpdate", new Guild(data as any)),
            CHANNEL_CREATE: (data: unknown) => this.emit("channelCreate", new Channel(data as any)),
            CHANNEL_UPDATE: (data: unknown) => this.emit("channelUpdate", new Channel(data as any)),
            INTERACTION_CREATE: (data: unknown) => this.emit("interactionCreate", createInteraction(this, data as any))
        } as const;
        for (const [event, handler] of Object.entries(constructors)) this.#gateway.on(event, handler);
        this.#gateway.on("MESSAGE_DELETE", data => this.emit("messageDelete", data));
        this.#gateway.on("GUILD_DELETE", data => this.emit("guildDelete", data));
        this.#gateway.on("CHANNEL_DELETE", data => this.emit("channelDelete", data));
        this.#gateway.on("error", data => this.emit("error", data instanceof Error ? data : new Error(String(data))));
        for (const event of ["READY", "MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "GUILD_CREATE", "GUILD_UPDATE", "GUILD_DELETE", "CHANNEL_CREATE", "CHANNEL_UPDATE", "CHANNEL_DELETE", "INTERACTION_CREATE"]) this.#gateway.on(event, data => this.emit("raw", { event, data }));
    }
}

export { Collection } from "@lunibee/collection";
export { REST, RESTError, RateLimitError, AuthenticationError, RESTTimeoutError, Routes } from "@lunibee/rest";
export { Gateway, GatewayOpcodes } from "@lunibee/ws";
export { User, Guild, Channel, Message } from "@lunibee/structures";
export { EmbedBuilder, ButtonBuilder, ActionRowBuilder, StringSelectBuilder, SlashCommandBuilder, StringOptionBuilder } from "@lunibee/builders";
export * from "@lunibee/types";
