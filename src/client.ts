import { ShardManager } from "./gateway/sharding.js";
import { REST } from "./rest.js";
import { EventEmitter } from "./events.js";
import type { ClientOptions, ClientUser, GatewayPayload } from "./types.js";
import type { Shard } from "./gateway/shard.js";

/** Events emitted by {@link Client}. */
export interface ClientEvents {
    /** Emitted when the bot receives a Discord `READY` dispatch. */
    ready: [user: ClientUser, shardId: number];
    /** Emitted for every Discord Gateway dispatch. */
    raw: [payload: GatewayPayload, shardId: number];
    /** Emitted when Discord sends a dispatch event. */
    [event: string]: unknown[];
}

/**
 * The main Lunibee client.
 *
 * The client combines the REST API, Gateway connections, sharding, and typed
 * event dispatch into a small Bun-first interface.
 */
export class Client extends EventEmitter<ClientEvents> {
    /** The REST client used for Discord HTTP requests. */
    public readonly rest: REST;

    readonly #gateway: ShardManager;
    #user?: ClientUser;

    /**
     * Creates a Lunibee client.
     *
     * @param options - Client, Gateway, REST, and sharding configuration.
     */
    public constructor(public readonly options: ClientOptions) {
        super();
        this.rest = new REST(options.token, options.rest);
        this.#gateway = new ShardManager(options, (shardId, payload) => this.#handleGateway(shardId, payload), {
            count: options.shards,
            maxConcurrency: options.maxConcurrency
        });
    }

    /** The bot user returned by Discord after login. */
    public get user(): ClientUser | undefined {
        return this.#user;
    }

    /** All currently created Gateway shards. */
    public get shards(): ReadonlyMap<number, Shard> {
        return this.#gateway.shards;
    }

    /**
     * Logs the client into Discord.
     *
     * @returns A promise that resolves after the Gateway connection process starts.
     * @throws {@link RESTError} When the bot token cannot retrieve the current user.
     * @throws {@link GatewayError} When Gateway information cannot be retrieved.
     * @example
     * ```ts
     * await client.login();
     * ```
     */
    public async login(): Promise<void> {
        this.#user = await this.rest.get<ClientUser>("/users/@me");
        await this.#gateway.connect();
    }

    /**
     * Closes all Gateway connections and stops reconnect attempts.
     */
    public destroy(): void {
        this.#gateway.close();
    }

    #handleGateway(shardId: number, payload: GatewayPayload): void {
        this.emit("raw", payload, shardId);
        if (!payload.t) return;

        const event = payload.t.charAt(0).toLowerCase() + payload.t.slice(1);
        if (event === "ready" && this.#user) this.emit("ready", this.#user, shardId);
        this.emit(event, payload.d, shardId);
    }
}
