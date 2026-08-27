import { GatewayManager } from "./gateway/manager.js";
import { REST } from "./rest.js";
import type { ClientOptions, ClientUser, GatewayPayload } from "./types.js";

type Listener = (...args: any[]) => unknown;

export class Client {
    public readonly rest: REST;
    readonly #gateway: GatewayManager;
    readonly #listeners = new Map<string, Set<Listener>>();
    #user?: ClientUser;

    public constructor(public readonly options: ClientOptions) {
        this.rest = new REST(options.token, options.rest);
        this.#gateway = new GatewayManager(options, payload => this.#handleGateway(payload));
    }

    public get user(): ClientUser | undefined {
        return this.#user;
    }

    public on(event: string, listener: Listener): this {
        let listeners = this.#listeners.get(event);
        if (!listeners) {
            listeners = new Set();
            this.#listeners.set(event, listeners);
        }
        listeners.add(listener);
        return this;
    }

    public once(event: string, listener: Listener): this {
        const wrapped = (...args: any[]) => {
            this.off(event, wrapped);
            return listener(...args);
        };
        return this.on(event, wrapped);
    }

    public off(event: string, listener: Listener): this {
        this.#listeners.get(event)?.delete(listener);
        return this;
    }

    public async login(): Promise<void> {
        this.#user = await this.rest.get<ClientUser>("/users/@me");
        await this.#gateway.connect();
    }

    public destroy(): void {
        this.#gateway.close();
    }

    #handleGateway(payload: GatewayPayload): void {
        if (!payload.t) return;
        const event = payload.t.charAt(0) + payload.t.slice(1).toLowerCase();
        const listeners = this.#listeners.get(event) ?? this.#listeners.get(payload.t);
        if (!listeners) return;
        for (const listener of listeners) void listener(payload.d);
    }
}
