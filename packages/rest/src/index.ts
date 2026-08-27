/** Base error for Discord REST failures. */
export class RESTError extends Error {
    /** HTTP status returned by Discord. */
    public readonly status: number;
    /** Discord API error code, when provided. */
    public readonly code?: number;
    /** Raw Discord error payload. */
    public readonly errors?: unknown;

    /** Creates a REST error. */
    public constructor(message: string, status: number, code?: number, errors?: unknown) {
        super(message);
        this.name = "RESTError";
        this.status = status;
        this.code = code;
        this.errors = errors;
    }
}

/** Error returned when Discord rejects the supplied credentials. */
export class AuthenticationError extends RESTError {
    /** Creates an authentication error. */
    public constructor(message = "Discord authentication failed", code?: number, errors?: unknown) {
        super(message, 401, code, errors);
        this.name = "AuthenticationError";
    }
}

/** Error returned when a request exhausts a Discord rate-limit bucket. */
export class RateLimitError extends RESTError {
    /** Seconds until the bucket can be used again. */
    public readonly retryAfter: number;
    /** Whether Discord marked the limit as global. */
    public readonly global: boolean;

    /** Creates a rate-limit error. */
    public constructor(message: string, retryAfter: number, global: boolean, code?: number, errors?: unknown) {
        super(message, 429, code, errors);
        this.name = "RateLimitError";
        this.retryAfter = retryAfter;
        this.global = global;
    }
}

type Bucket = { remaining: number; resetAt: number; queue: Promise<void> };

/** Options for an individual REST request. */
export interface RequestOptions {
    /** Request body. */
    body?: unknown;
    /** Abort signal for the request. */
    signal?: AbortSignal;
    /** Request timeout in milliseconds. `0` disables the timeout. */
    timeout?: number;
}

/** Options for a REST client. */
export interface RESTOptions {
    /** Discord bot token. */
    token?: string;
    /** Default request timeout in milliseconds. @default 15000 */
    timeout?: number;
    /** Number of retries for recoverable failures. @default 2 */
    retries?: number;
    /** Discord API base URL. */
    baseURL?: string;
}

/** A Bun-native Discord REST transport with route and global limit handling. */
export class REST {
    readonly #baseURL: string;
    readonly #timeout: number;
    readonly #retries: number;
    #token?: string;
    #globalResetAt = 0;
    readonly #buckets = new Map<string, Bucket>();

    /** Creates a REST client. */
    public constructor(options: RESTOptions = {}) {
        this.#token = options.token;
        this.#timeout = Math.max(0, options.timeout ?? 15_000);
        this.#retries = Math.max(0, options.retries ?? 2);
        this.#baseURL = (options.baseURL ?? "https://discord.com/api/v10").replace(/\/$/, "");
    }

    /** Updates the bot token used by future requests. */
    public setToken(token: string): void {
        this.#token = token;
    }

    /** Sends a request to Discord. */
    public async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
        const normalizedMethod = method.toUpperCase();
        const route = `${normalizedMethod}:${path.split("?")[0].replace(/\/\d+(?=\/|$)/g, "/:id")}`;
        const bucket = this.#buckets.get(route) ?? { remaining: 1, resetAt: 0, queue: Promise.resolve() };
        this.#buckets.set(route, bucket);
        const previous = bucket.queue;
        let release!: () => void;
        bucket.queue = new Promise(resolve => {
            release = resolve;
        });
        await previous;

        try {
            for (let attempt = 0; attempt <= this.#retries; attempt++) {
                await this.#wait(bucket, options.signal);
                await this.#waitGlobal(options.signal);

                const controller = new AbortController();
                const signal = this.#combineSignals(controller.signal, options.signal);
                const timeout = options.timeout ?? this.#timeout;
                const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : undefined;

                try {
                    const response = await fetch(`${this.#baseURL}${path}`, {
                        method: normalizedMethod,
                        headers: {
                            ...(this.#token ? { Authorization: `Bot ${this.#token}` } : {}),
                            "Content-Type": "application/json",
                            "User-Agent": "Lunibee/0.1.0"
                        },
                        body: options.body === undefined ? undefined : JSON.stringify(options.body),
                        signal
                    });
                    this.#update(response, bucket);
                    const payload = await response.json().catch(() => undefined);
                    if (response.ok) return (response.status === 204 ? undefined : payload) as T;

                    const data = payload as { message?: string; code?: number; retry_after?: number; global?: boolean } | undefined;
                    if (response.status === 401) throw new AuthenticationError(data?.message, data?.code, data);

                    if (response.status === 429) {
                        const retryAfter = this.#retryAfter(response, data);
                        const global = data?.global === true || response.headers.get("X-RateLimit-Global") === "true";
                        if (global) this.#globalResetAt = Date.now() + retryAfter * 1000;
                        if (attempt < this.#retries) {
                            await this.#sleep(retryAfter * 1000, options.signal);
                            continue;
                        }
                        throw new RateLimitError(data?.message ?? "Discord rate limit exceeded", retryAfter, global, data?.code, data);
                    }

                    if (response.status >= 500 && attempt < this.#retries && ["GET", "HEAD", "PUT", "DELETE"].includes(normalizedMethod)) {
                        await this.#sleep(Math.min(10_000, 500 * 2 ** attempt) + Math.random() * 250, options.signal);
                        continue;
                    }

                    throw new RESTError(data?.message ?? response.statusText, response.status, data?.code, data);
                } finally {
                    if (timer) clearTimeout(timer);
                }
            }
            throw new RESTError("Request failed", 500);
        } finally {
            release();
        }
    }

    /** Sends a GET request. */
    public get<T>(path: string, options?: Omit<RequestOptions, "body">): Promise<T> { return this.request<T>("GET", path, options); }
    /** Sends a POST request. */
    public post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">): Promise<T> { return this.request<T>("POST", path, { ...options, body }); }
    /** Sends a PATCH request. */
    public patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">): Promise<T> { return this.request<T>("PATCH", path, { ...options, body }); }
    /** Sends a PUT request. */
    public put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">): Promise<T> { return this.request<T>("PUT", path, { ...options, body }); }
    /** Sends a DELETE request. */
    public delete<T>(path: string, options?: Omit<RequestOptions, "body">): Promise<T> { return this.request<T>("DELETE", path, options); }

    async #wait(bucket: Bucket, signal?: AbortSignal): Promise<void> {
        if (bucket.remaining > 0 || bucket.resetAt <= Date.now()) return;
        await this.#sleep(bucket.resetAt - Date.now(), signal);
    }

    async #waitGlobal(signal?: AbortSignal): Promise<void> {
        if (this.#globalResetAt <= Date.now()) return;
        await this.#sleep(this.#globalResetAt - Date.now(), signal);
    }

    async #sleep(ms: number, signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, Math.max(0, ms));
            const abort = () => {
                clearTimeout(timer);
                reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
            };
            signal?.addEventListener("abort", abort, { once: true });
        });
    }

    #retryAfter(response: Response, data?: { retry_after?: number }): number {
        const value = data?.retry_after ?? Number(response.headers.get("Retry-After") ?? 1);
        return Number.isFinite(value) && value >= 0 ? value : 1;
    }

    #update(response: Response, bucket: Bucket): void {
        const remaining = Number(response.headers.get("X-RateLimit-Remaining"));
        const resetAfter = Number(response.headers.get("X-RateLimit-Reset-After"));
        if (Number.isFinite(remaining)) bucket.remaining = remaining;
        if (Number.isFinite(resetAfter)) bucket.resetAt = Date.now() + resetAfter * 1000;
    }

    #combineSignals(timeoutSignal: AbortSignal, requestSignal?: AbortSignal): AbortSignal {
        if (!requestSignal) return timeoutSignal;
        if (typeof AbortSignal.any === "function") return AbortSignal.any([timeoutSignal, requestSignal]);
        const controller = new AbortController();
        const abort = (event: Event) => controller.abort((event.target as AbortSignal).reason);
        timeoutSignal.addEventListener("abort", abort, { once: true });
        requestSignal.addEventListener("abort", abort, { once: true });
        return controller.signal;
    }
}

/** Discord REST route helpers. */
export const Routes = {
    user: () => "/users/@me",
    channel: (id: string) => `/channels/${id}`,
    channelMessages: (id: string) => `/channels/${id}/messages`,
    message: (channelId: string, messageId: string) => `/channels/${channelId}/messages/${messageId}`,
    guild: (id: string) => `/guilds/${id}`,
    guildChannels: (id: string) => `/guilds/${id}/channels`,
    interactionCallback: (id: string, token: string) => `/interactions/${id}/${token}/callback`,
    webhookMessage: (id: string, token: string) => `/webhooks/${id}/${token}/messages/@original`
} as const;
