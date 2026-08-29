import { Collection } from "@lunibee/collection";
import { Manager } from "@lunibee/managers";
import { REST, Routes } from "@lunibee/rest";
import { User, Guild, Channel, Message, Interaction, createInteraction, type InteractionClient } from "@lunibee/structures";
import { Gateway } from "@lunibee/ws";
import type { ClientOptions, ClientUser } from "@lunibee/types";

/** Events emitted by a Lunibee client. */
export interface ClientEvents {
    /** Fired after the Gateway sends READY. */ ready: [ClientUser];
    /** Fired for every raw Gateway dispatch. */ raw: [unknown];
    /** Fired when the Gateway reports an error. */ error: [Error];
    /** Fired when the Gateway opens. */ open: [];
    /** Fired when the Gateway closes. */ close: [{ code: number; action: string }];
    /** Fired when Discord creates a message. */ messageCreate: [Message];
    /** Fired when Discord updates a message. */ messageUpdate: [Message];
    /** Fired when Discord deletes a message. */ messageDelete: [unknown];
    /** Fired when a guild becomes available. */ guildCreate: [Guild];
    /** Fired when a guild is updated. */ guildUpdate: [Guild];
    /** Fired when a guild is removed. */ guildDelete: [unknown];
    /** Fired when a channel is created. */ channelCreate: [Channel];
    /** Fired when a channel is updated. */ channelUpdate: [Channel];
    /** Fired when a channel is deleted. */ channelDelete: [unknown];
    /** Fired when an interaction is created. */ interactionCreate: [Interaction];
}

/** Lifecycle state exposed by a Lunibee client. */
export type ClientState = "idle" | "connecting" | "ready" | "destroyed";
type Listener<T extends unknown[]> = (...args: T) => unknown;

/** Small typed emitter that isolates synchronous throws and async rejections. */
class EventEmitter<Events extends Record<string, unknown[]>> {
    readonly #listeners = new Map<keyof Events, Set<Listener<any>>>();
    /** Registers an event listener. */
    public on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this { if (typeof listener !== "function") throw new TypeError("Event listener must be a function."); let listeners = this.#listeners.get(event); if (!listeners) this.#listeners.set(event, listeners = new Set()); listeners.add(listener); return this; }
    /** Registers a listener that is removed after its first invocation. */
    public once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this { const wrapped: Listener<Events[K]> = (...args) => { this.off(event, wrapped); return listener(...args); }; return this.on(event, wrapped); }
    /** Removes a listener. */
    public off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this { this.#listeners.get(event)?.delete(listener); return this; }
    /** Removes every listener, optionally for one event. */
    public removeAllListeners<K extends keyof Events>(event?: K): this { if (event === undefined) this.#listeners.clear(); else this.#listeners.delete(event); return this; }
    /** Emits an event without allowing consumer code to break the runtime. */
    protected emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean { const listeners = this.#listeners.get(event); if (!listeners?.size) return false; for (const listener of [...listeners]) { try { const result = listener(...args); if (result && typeof (result as PromiseLike<unknown>).then === "function") void Promise.resolve(result).catch(error => this.#handleError(event, error)); } catch (error) { this.#handleError(event, error); } } return true; }
    /** Forwards consumer failures to the error event while preventing recursion. */
    #handleError(event: keyof Events, error: unknown): void { if (event === "error") return; const normalized = error instanceof Error ? error : new Error(String(error), { cause: error }); for (const listener of [...(this.#listeners.get("error" as keyof Events) ?? [])]) { try { void listener(normalized); } catch { /* Error handlers are intentionally isolated. */ } } }
}

/** Lightweight, Bun-first Discord client. */
export class Client extends EventEmitter<ClientEvents> implements InteractionClient {
    /** REST transport. */ public readonly rest: REST;
    /** Cached users. */ public readonly users = new Manager<string, User>();
    /** Cached guilds. */ public readonly guilds = new Manager<string, Guild>();
    /** Cached channels. */ public readonly channels = new Manager<string, Channel>();
    /** Current authenticated bot user. */ public user?: ClientUser;
    /** Time at which the client became ready. */ public readyAt?: Date;
    /** Current lifecycle state. */ public state: ClientState = "idle";
    readonly #gateway: Gateway;

    /** Creates a client and wires Gateway dispatches to typed events. */
    public constructor(public readonly options: ClientOptions) {
        super();
        if (!options.token?.trim()) throw new TypeError("Client token is required.");
        this.rest = new REST({ token: options.token, ...options.rest });
        this.#gateway = new Gateway({ token: options.token, intents: options.intents, ...options.gateway });
        this.#gateway.on("READY", data => { this.user = data as ClientUser; this.readyAt = new Date(); this.state = "ready"; this.emit("ready", this.user); });
        this.#gateway.on("open", () => this.emit("open"));
        this.#gateway.on("close", data => { if (this.state !== "destroyed") this.state = "idle"; this.emit("close", data as { code: number; action: string }); });
        this.#gateway.on("MESSAGE_CREATE", data => this.emit("messageCreate", new Message(data as any)));
        this.#gateway.on("MESSAGE_UPDATE", data => this.emit("messageUpdate", new Message(data as any)));
        this.#gateway.on("MESSAGE_DELETE", data => this.emit("messageDelete", data));
        this.#gateway.on("GUILD_CREATE", data => this.emit("guildCreate", new Guild(data as any)));
        this.#gateway.on("GUILD_UPDATE", data => this.emit("guildUpdate", new Guild(data as any)));
        this.#gateway.on("GUILD_DELETE", data => this.emit("guildDelete", data));
        this.#gateway.on("CHANNEL_CREATE", data => this.emit("channelCreate", new Channel(data as any)));
        this.#gateway.on("CHANNEL_UPDATE", data => this.emit("channelUpdate", new Channel(data as any)));
        this.#gateway.on("CHANNEL_DELETE", data => this.emit("channelDelete", data));
        this.#gateway.on("INTERACTION_CREATE", data => this.emit("interactionCreate", createInteraction(this, data as any)));
        this.#gateway.on("error", data => this.emit("error", data as Error));
        for (const event of ["READY", "MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "GUILD_CREATE", "GUILD_UPDATE", "GUILD_DELETE", "CHANNEL_CREATE", "CHANNEL_UPDATE", "CHANNEL_DELETE", "INTERACTION_CREATE"]) this.#gateway.on(event, data => this.emit("raw", { event, data }));
    }

    /** Returns true after the Gateway READY dispatch has initialized the client user. */
    public isReady(): this is Client & { user: ClientUser; readyAt: Date } { return this.state === "ready" && this.user !== undefined && this.readyAt !== undefined; }
    /** Fetches the bot user and opens the Gateway connection. */
    public async login(): Promise<void> { if (this.state === "destroyed") throw new Error("Cannot login a destroyed client."); if (this.state === "connecting" || this.state === "ready") return; this.state = "connecting"; try { this.user = await this.rest.get<ClientUser>(Routes.user()); await this.#gateway.connect(); } catch (error) { this.state = "idle"; throw error; } }
    /** Permanently closes the Gateway connection. */
    public destroy(): void { if (this.state === "destroyed") return; this.#gateway.close(); this.state = "destroyed"; this.readyAt = undefined; this.user = undefined; }
    /** Sends an interaction callback. */
    public postInteractionResponse(id: string, token: string, response: import("@lunibee/structures").InteractionResponse): Promise<unknown> { return this.rest.post(`/interactions/${id}/${token}/callback`, response.toJSON()); }
    /** Edits the original interaction response. */
    public editInteractionReply(token: string, data: import("@lunibee/structures").InteractionReplyOptions): Promise<unknown> { if (!this.user?.id) throw new Error("Client user is unavailable; login is required."); return this.rest.patch(`/webhooks/${this.user.id}/${token}/messages/@original`, data); }
    /** Deletes the original interaction response. */
    public async deleteInteractionReply(token: string): Promise<void> { if (!this.user?.id) throw new Error("Client user is unavailable; login is required."); await this.rest.delete(`/webhooks/${this.user.id}/${token}/messages/@original`); }
}

export { Collection } from "@lunibee/collection";
export { REST, RESTError, Routes } from "@lunibee/rest";
export { Gateway, GatewayError, GatewayOpcodes } from "@lunibee/ws";
export { User, Guild, Channel, Message } from "@lunibee/structures";
export { EmbedBuilder, ButtonBuilder, ActionRowBuilder, StringSelectBuilder, SlashCommandBuilder, StringOptionBuilder } from "@lunibee/builders";
export * from "@lunibee/types";
