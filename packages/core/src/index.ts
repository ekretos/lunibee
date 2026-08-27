import { REST } from "@lunibee/rest";
import { Gateway } from "@lunibee/ws";
import type { ClientOptions, ClientUser } from "@lunibee/types";

/** A lightweight Discord client designed for Bun. */
export class Client {
    /** REST transport used by the client. */
    public readonly rest: REST;
    /** Current bot user after login. */
    public user?: ClientUser;
    readonly #gateway: Gateway;
    readonly #listeners = new Map<string, Set<(data: unknown) => void>>();

    /** Creates a Discord client. */
    public constructor(public readonly options: ClientOptions) {
        this.rest = new REST({ token: options.token, ...options.rest });
        this.#gateway = new Gateway({ token: options.token, intents: options.intents, ...options.gateway });
        this.#gateway.on("ready", data => {
            this.user = data as ClientUser;
            this.#emit("ready", data);
        });
        this.#gateway.on("error", error => this.#emit("error", error));
    }

    /** Registers a listener for a Discord event. */
    public on(event: string, listener: (data: unknown) => void): this {
        let listeners = this.#listeners.get(event);
        if (!listeners) { listeners = new Set(); this.#listeners.set(event, listeners); }
        listeners.add(listener);
        this.#gateway.on(event, listener);
        return this;
    }

    /** Registers a listener that is removed after its first invocation. */
    public once(event: string, listener: (data: unknown) => void): this {
        const wrapped = (data: unknown) => { this.off(event, wrapped); listener(data); };
        return this.on(event, wrapped);
    }

    /** Removes a registered event listener. */
    public off(event: string, listener: (data: unknown) => void): this {
        this.#listeners.get(event)?.delete(listener);
        return this;
    }

    /** Logs the bot into Discord. */
    public async login(): Promise<void> {
        this.user = await this.rest.get<ClientUser>("/users/@me");
        await this.#gateway.connect();
    }

    /** Permanently closes the client's Gateway connection. */
    public destroy(): void { this.#gateway.close(); }

    #emit(event: string, data: unknown): void {
        for (const listener of this.#listeners.get(event) ?? []) void listener(data);
    }
}

export { GatewayIntentBits } from "@lunibee/types";
export { REST, RESTError } from "@lunibee/rest";
export { Gateway, GatewayOpcodes } from "@lunibee/ws";
export { Collection } from "@lunibee/collection";
export * from "@lunibee/types";
