/** Configuration accepted by {@link Client}. */
export interface ClientOptions {
    /** Discord bot token. */
    token: string;
    /** Gateway intent bitfield. */
    intents: number;
    /** Gateway connection configuration. */
    gateway?: GatewayOptions;
    /** REST request configuration. */
    rest?: RESTOptions;
    /** Number of Gateway shards. Defaults to one. */
    shards?: number;
    /** Maximum number of shards started in one identify batch. */
    maxConcurrency?: number;
}

/** Gateway connection and reconnect configuration. */
export interface GatewayOptions {
    /** Whether disconnected shards should reconnect automatically. */
    reconnect?: boolean;
    /** Maximum number of automatic reconnect attempts. */
    maxReconnectAttempts?: number;
    /** Initial reconnect delay in milliseconds. */
    reconnectBaseDelay?: number;
    /** Maximum reconnect delay in milliseconds. */
    reconnectMaxDelay?: number;
}

/** REST request configuration. */
export interface RESTOptions {
    /** Maximum time a request may remain pending, in milliseconds. */
    timeout?: number;
    /** Maximum number of retry attempts for retryable failures. */
    retries?: number;
}

/** The authenticated bot user returned by Discord. */
export interface ClientUser {
    /** Discord user ID. */
    id: string;
    /** Discord username. */
    username: string;
    /** Legacy discriminator returned for compatible accounts. */
    discriminator: string;
    /** Display name, when set. */
    global_name?: string | null;
    /** Avatar hash, when the user has an avatar. */
    avatar?: string | null;
    /** Whether Discord identifies this account as a bot. */
    bot?: boolean;
}

/** A raw Discord Gateway payload. */
export interface GatewayPayload<T = unknown> {
    /** Gateway opcode. */
    op: number;
    /** Opcode-specific payload data. */
    d: T | null;
    /** Dispatch sequence number, when supplied by Discord. */
    s: number | null;
    /** Dispatch event name, when supplied by Discord. */
    t: string | null;
}
