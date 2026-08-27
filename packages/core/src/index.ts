import { Collection } from "@lunibee/collection";
import { Manager } from "@lunibee/managers";
import { REST, RESTError, Routes } from "@lunibee/rest";
import { User, Guild, Channel, Message, Interaction, createInteraction, type InteractionClient } from "@lunibee/structures";
import { Gateway, GatewayError } from "@lunibee/ws";
import type { ClientOptions, ClientUser } from "@lunibee/types";
import { ClientState, type ClientStatus } from "./client-state.js";

/** Events emitted by a Lunibee client. */
export interface ClientEvents {
    /** Fired after the Gateway sends READY. */ ready: [ClientUser];
    /** Fired when the Gateway socket opens. */ connecting: [];
    /** Fired when the Gateway socket closes. */ disconnect: [number];
    /** Fired after the client is fully disconnected. */ disconnected: [];
    /** Fired for every raw Gateway dispatch. */ raw: [unknown];
    /** Fired when the Gateway reports an error. */ error: [Error];
    /** Fired when Discord creates a message. */ messageCreate: [Message];
    /** Fired when Discord updates a message. */ messageUpdate: [Message];
    /** Fired when Discord deletes a message. */ messageDelete: [unknown];
    /** Fired when a guild becomes available. */ guildCreate: [Guild];
    /** Fired when a guild is updated. */ guildUpdate: [Guild];
    /** Fired when a guild becomes unavailable or is removed. */ guildDelete: [unknown];
    /** Fired when a channel is created. */ channelCreate: [Channel];
    /** Fired when a channel is updated. */ channelUpdate: [Channel];
    /** Fired when a channel is deleted. */ channelDelete: [unknown];
    /** Fired when an interaction is created. */ interactionCreate: [Interaction];
}

type Listener<T extends unknown[]> = (...args: T) => unknown;

/** Small typed event emitter used by the client runtime. */
class EventEmitter<Events extends Record<string, unknown[]>> {
    readonly #listeners = new Map<keyof Events, Set<Listener<any>>>();

    /** Registers an event listener. */
    public on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
        let listeners = this.#listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.#listeners.set(event, listeners);
        }
        listeners.add(listener);
        return this;
    }

    /** Registers a listener that is removed after its first invocation. */
    public once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
        const wrapped = (...args: Events[K]) => {
            this.off(event, wrapped);
            return listener(...args);
        };
        return this.on(event, wrapped);
    }

    /** Removes an event listener. */
    public off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
        this.#listeners.get(event)?.delete(listener);
        return this;
    }

    /** Emits an event. */
    protected emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
        for (const listener of this.#listeners.get(event) ?? []) {
            try {
                void listener(...args);
            } catch (error) {
                if (event !== "error") this.emit("error", error instanceof Error ? error : new Error(String(error)));
            }
        }
    }
}

/** A lightweight, Bun-first Discord client. */
export class Client extends EventEmitter<ClientEvents> implements InteractionClient {
    /** REST transport. */
    public readonly rest: REST;
    /** Cached users. */
    public readonly users = new Manager<string, User>();
    /** Cached guilds. */
    public readonly guilds = new Manager<string, Guild>();
    /** Cached channels. */
    public readonly channels = new Manager<string, Channel>();
    /** Client lifecycle state. */
    public readonly state = new ClientState();
    /** Current bot user. */
    public user?: ClientUser;
    readonly #gateway: Gateway;

    /** Creates a Lunibee client. */
    public constructor(public readonly options: ClientOptions) {
        super();
        this.rest = new REST({ token: options.token, ...options.rest });
        this.#gateway = new Gateway({ token: options.token, intents: options.intents, ...options.gateway });
        this.#gateway.on("open", () => {
            this.state.transition("connecting");
            this.emit("connecting");
        });
        this.#gateway.on("READY", data => {
            this.user = data as ClientUser;
            this.state.transition("ready");
            this.emit("ready", this.user);
        });
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
        for (const event of ["READY", "MESSAGE_CREATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "GUILD_CREATE", "GUILD_UPDATE", "GUILD_DELETE", "CHANNEL_CREATE", "CHANNEL_UPDATE", "CHANNEL_DELETE", "INTERACTION_CREATE"]) {
            this.#gateway.on(event, data => this.emit("raw", { event, data }));
        }
        this.#gateway.on("close", code => {
            const closeCode = Number(code);
            if (this.state.canTransition("disconnected")) this.state.transition("disconnected");
            this.emit("disconnect", closeCode);
            this.emit("disconnected");
        });
        this.#gateway.on("error", data => this.emit("error", data instanceof GatewayError ? data : data as Error));
    }

    /** Current client lifecycle status. */
    public get status(): ClientStatus {
        return this.state.status;
    }

    /** Logs the client into Discord. */
    public async login(): Promise<void> {
        if (this.state.status === "ready") return;
        if (this.state.status === "connecting") return;
        this.state.transition("connecting");
        try {
            this.user = await this.rest.get<ClientUser>(Routes.user());
            await this.#gateway.connect();
        } catch (error) {
            if (this.state.canTransition("disconnected")) this.state.transition("disconnected");
            throw error;
        }
    }

    /** Permanently closes the client's Gateway connection. */
    public destroy(): void {
        if (this.state.status === "disconnected") return;
        if (this.state.canTransition("disconnecting")) this.state.transition("disconnecting");
        this.#gateway.close();
        if (this.state.canTransition("disconnected")) this.state.transition("disconnected");
    }

    /** Sends the initial interaction callback. */
    public postInteractionResponse(id: string, token: string, response: import("@lunibee/structures").InteractionResponse): Promise<unknown> {
        return this.rest.post(`/interactions/${id}/${token}/callback`, response.toJSON());
    }

    /** Edits the original interaction response. */
    public editInteractionReply(token: string, data: import("@lunibee/structures").InteractionReplyOptions): Promise<unknown> {
        return this.rest.patch(`/webhooks/${this.user?.id ?? "@me"}/${token}/messages/@original`, data);
    }

    /** Deletes the original interaction response. */
    public async deleteInteractionReply(token: string): Promise<void> {
        await this.rest.delete(`/webhooks/${this.user?.id ?? "@me"}/${token}/messages/@original`);
    }
}

export { ClientState } from "./client-state.js";
export { Collection } from "@lunibee/collection";
export { REST, RESTError, Routes } from "@lunibee/rest";
export { Gateway, GatewayError, GatewayOpcodes } from "@lunibee/ws";
export { User, Guild, Channel, Message } from "@lunibee/structures";
export { EmbedBuilder, ButtonBuilder, ActionRowBuilder, StringSelectBuilder, SlashCommandBuilder, StringOptionBuilder } from "@lunibee/builders";
export * from "@lunibee/types";
