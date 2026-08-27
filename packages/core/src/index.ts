import { Collection } from "@lunibee/collection";
import { Manager } from "@lunibee/managers";
import { REST, RESTError } from "@lunibee/rest";
import { User, Guild, Channel, Message } from "@lunibee/structures";
import { Gateway } from "@lunibee/ws";
import type { ClientOptions, ClientUser } from "@lunibee/types";

/** Events emitted by the client. */
export interface ClientEvents {
    /** Emitted after the Gateway sends READY. */
    ready: [ClientUser];
    /** Emitted for every raw Gateway dispatch. */
    raw: [unknown];
    /** Emitted when the Gateway reports an error. */
    error: [Error];
    /** Emitted when Discord creates a message. */
    messageCreate: [Message];
}

type Listener<T extends unknown[]> = (...args: T) => unknown;

/** A typed event emitter used by the client. */
class EventEmitter<Events extends Record<string, unknown[]>> {
    readonly #listeners = new Map<keyof Events, Set<Listener<any>>>();

    /** Registers an event listener. */
    public on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
        let listeners = this.#listeners.get(event);
        if (!listeners) { listeners = new Set(); this.#listeners.set(event, listeners); }
        listeners.add(listener);
        return this;
    }

    /** Registers a listener that is removed after its first invocation. */
    public once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
        const wrapped = (...args: Events[K]) => { this.off(event, wrapped); return listener(...args); };
        return this.on(event, wrapped);
    }

    /** Removes an event listener. */
    public off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
        this.#listeners.get(event)?.delete(listener);
        return this;
    }

    protected emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
        for (const listener of this.#listeners.get(event) ?? []) void listener(...args);
    }
}

/** A lightweight, Bun-first Discord client. */
export class Client extends EventEmitter<ClientEvents> {
    /** REST transport. */
    public readonly rest: REST;
    /** Cached users. */
    public readonly users = new Manager<string, User>();
    /** Cached guilds. */
    public readonly guilds = new Manager<string, Guild>();
    /** Cached channels. */
    public readonly channels = new Manager<string, Channel>();
    /** Current bot user. */
    public user?: ClientUser;
    readonly #gateway: Gateway;

    /** Creates a Lunibee client. */
    public constructor(public readonly options: ClientOptions) {
        super();
        this.rest = new REST({ token: options.token, ...options.rest });
        this.#gateway = new Gateway({ token: options.token, intents: options.intents, ...options.gateway });
        this.#gateway.on("READY", data => { this.user = data as ClientUser; this.emit("ready", this.user); });
        this.#gateway.on("MESSAGE_CREATE", data => this.emit("messageCreate", data as Message));
        this.#gateway.on("error", data => this.emit("error", data as Error));
    }

    /** Logs the client into Discord. */
    public async login(): Promise<void> {
        this.user = await this.rest.get<ClientUser>("/users/@me");
        await this.#gateway.connect();
    }

    /** Permanently closes the client's Gateway connection. */
    public destroy(): void { this.#gateway.close(); }
}

export { Collection } from "@lunibee/collection";
export { REST, RESTError } from "@lunibee/rest";
export { Gateway, GatewayOpcodes } from "@lunibee/ws";
export { User, Guild, Channel, Message } from "@lunibee/structures";
export { EmbedBuilder, ButtonBuilder } from "@lunibee/builders";
export * from "@lunibee/types";
