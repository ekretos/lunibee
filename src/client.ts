import { ShardManager } from "./gateway/sharding.js";
import { REST } from "./rest.js";
import type { ClientOptions, ClientUser, GatewayPayload } from "./types.js";

type Listener = (...args: any[]) => unknown;

export class Client {
    public readonly rest: REST;
    readonly #gateway: ShardManager;
    readonly #listeners = new Map<string, Set<Listener>>();
    #user?: ClientUser;

    public constructor(public readonly options: ClientOptions) {
        this.rest = new REST(options.token, options.rest);
        this.#gateway = new ShardManager(options, (shardId, payload) => this.#handleGateway(shardId, payload), {
            count: options.shards,
            maxConcurrency: options.maxConcurrency
        });
    }

    public get user(): ClientUser | undefined { return this.#user; }

    public get shards(): ReadonlyMap<number, import("./gateway/shard.js").Shard> { return this.#gateway.shards; }

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
        const wrapped = (...args: any[]) => { this.off(event, wrapped); return listener(...args); };
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

    public destroy(): void { this.#gateway.close(); }

    #handleGateway(shardId: number, payload: GatewayPayload): void {
        if (!payload.t) return;
        const event = payload.t.charAt(0) + payload.t.slice(1).toLowerCase();
        const listeners = this.#listeners.get(event) ?? this.#listeners.get(payload.t);
        if (!listeners) return;
        for (const listener of listeners) void listener(payload.d, shardId);
    }
}
