/** Error thrown when Discord rejects a REST request. */
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

type Bucket = { remaining: number; resetAt: number; queue: Promise<void> };

/** A small Bun-native Discord REST transport with route and global limit handling. */
export class REST {
    readonly #baseURL: string;
    readonly #timeout: number;
    readonly #retries: number;
    #token?: string;
    #globalResetAt = 0;
    readonly #buckets = new Map<string, Bucket>();

    /** Creates a REST client. */
    public constructor(options: { token?: string; timeout?: number; retries?: number; baseURL?: string } = {}) {
        this.#token = options.token;
        this.#timeout = options.timeout ?? 15_000;
        this.#retries = Math.max(0, options.retries ?? 2);
        this.#baseURL = options.baseURL ?? "https://discord.com/api/v10";
    }

    /** Updates the bot token used by future requests. */
    public setToken(token: string): void {
        this.#token = token;
    }

    /** Sends a request to Discord. */
    public async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const route = `${method.toUpperCase()}:${path.split("?")[0].replace(/\/\d+(?=\/|$)/g, "/:id")}`;
        const bucket = this.#buckets.get(route) ?? { remaining: 1, resetAt: 0, queue: Promise.resolve() };
        this.#buckets.set(route, bucket);
        const previous = bucket.queue;
        let release!: () => void;
        bucket.queue = new Promise(resolve => { release = resolve; });
        await previous;
        try {
            for (let attempt = 0; attempt <= this.#retries; attempt++) {
                await this.#wait(bucket);
                if (this.#globalResetAt > Date.now()) await Bun.sleep(this.#globalResetAt - Date.now());
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), this.#timeout);
                try {
                    const response = await fetch(`${this.#baseURL}${path}`, {
                        method,
                        headers: {
                            Authorization: `Bot ${this.#token}`,
                            "Content-Type": "application/json",
                            "User-Agent": "Lunibee/0.1.0"
                        },
                        body: body === undefined ? undefined : JSON.stringify(body),
                        signal: controller.signal
                    });
                    this.#update(response, bucket);
                    const payload = await response.json().catch(() => undefined);
                    if (response.ok) return (response.status === 204 ? undefined : payload) as T;
                    const data = payload as { message?: string; code?: number; retry_after?: number; global?: boolean } | undefined;
                    if (response.status === 429) {
                        const retryAfter = data?.retry_after ?? Number(response.headers.get("Retry-After") ?? 1);
                        if (data?.global) this.#globalResetAt = Date.now() + retryAfter * 1000;
                        if (attempt < this.#retries) { await Bun.sleep(retryAfter * 1000); continue; }
                    }
                    if (response.status >= 500 && attempt < this.#retries && ["GET", "HEAD", "PUT", "DELETE"].includes(method.toUpperCase())) {
                        await Bun.sleep(Math.min(10_000, 500 * 2 ** attempt) + Math.random() * 250);
                        continue;
                    }
                    throw new RESTError(data?.message ?? response.statusText, response.status, data?.code, data);
                } finally {
                    clearTimeout(timer);
                }
            }
            throw new RESTError("Request failed", 500);
        } finally {
            release();
        }
    }

    /** Sends a GET request. */
    public get<T>(path: string): Promise<T> { return this.request<T>("GET", path); }
    /** Sends a POST request. */
    public post<T>(path: string, body?: unknown): Promise<T> { return this.request<T>("POST", path, body); }
    /** Sends a PATCH request. */
    public patch<T>(path: string, body?: unknown): Promise<T> { return this.request<T>("PATCH", path, body); }
    /** Sends a PUT request. */
    public put<T>(path: string, body?: unknown): Promise<T> { return this.request<T>("PUT", path, body); }
    /** Sends a DELETE request. */
    public delete<T>(path: string): Promise<T> { return this.request<T>("DELETE", path); }

    async #wait(bucket: Bucket): Promise<void> {
        if (bucket.remaining > 0 || bucket.resetAt <= Date.now()) return;
        await Bun.sleep(bucket.resetAt - Date.now());
    }

    #update(response: Response, bucket: Bucket): void {
        const remaining = Number(response.headers.get("X-RateLimit-Remaining"));
        const resetAfter = Number(response.headers.get("X-RateLimit-Reset-After"));
        if (Number.isFinite(remaining)) bucket.remaining = remaining;
        if (Number.isFinite(resetAfter)) bucket.resetAt = Date.now() + resetAfter * 1000;
    }
}
