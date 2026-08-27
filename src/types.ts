export interface ClientOptions {
    token: string;
    intents: number;
    gateway?: GatewayOptions;
    rest?: RESTOptions;
}

export interface GatewayOptions {
    reconnect?: boolean;
    maxReconnectAttempts?: number;
    reconnectBaseDelay?: number;
    reconnectMaxDelay?: number;
}

export interface RESTOptions {
    timeout?: number;
    retries?: number;
}

export interface ClientUser {
    id: string;
    username: string;
    discriminator: string;
    global_name?: string | null;
    avatar?: string | null;
    bot?: boolean;
}

export interface GatewayPayload<T = unknown> {
    op: number;
    d: T | null;
    s: number | null;
    t: string | null;
}
