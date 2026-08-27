import { RESTError } from "./errors.js";
import type { RESTOptions } from "./types.js";

/** Discord's versioned REST API base URL. */
export const REST_BASE_URL = "https://discord.com/api/v10";

type Bucket = {
    remaining: number;
    resetAt: number;
    queue: Promise<void>;
};

/**
 * Performs authenticated requests against Discord's REST API.
 *
 * The client maintains per-route request queues, handles global and route
 * rate limits, retries idempotent server failures, and aborts timed-out calls.
 */
export class REST {
    readonly #timeout: number;
    readonly #retries: number;
    #token?: string;
    #globalResetAt = 0;
    readonly #buckets = new Map<string, Bucket>();

    /**
     * Creates a REST client.
     *
     * @param token - Discord bot token used for authentication.
     * @param options - Request timeout and retry configuration.
     */
    public constructor(token?: string, options: RESTOptions = {}) {
        this.#token = token;
        this.#timeout = options.timeout ?? 15_000;
        this.#retries = Math.max(0, options.retries ?? 2);
    }

    /**
     * Replaces the token used for future requests.
     *
     * @param token - Discord bot token.
     */
    public setToken(token: string): void {
        this.#token = token;
    }

    /**
     * Sends a request to Discord.
     *
     * @typeParam T - Expected response type.
     * @param method - HTTP method.
     * @param path - API path relative to Discord's v10 API.
     * @param body - Optional JSON request body.
     * @returns The decoded Discord response.
     * @throws {@link RESTError} When Discord returns an unsuccessful response.
     * @example
     * ```ts
     * const user = await rest.request<User>("GET", "/users/@me");
     * ```
     */
    public async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const route = this.#route(method, path);
        const bucket = this.#buckets.get(route) ?? { remaining: 1, resetAt: 0, queue: Promise.resolve() };
        this.#buckets.set(route, bucket);
        const previous = bucket.queue;
        let release!: () => void;
        bucket.queue = new Promise(resolve => { release = resolve; });
        await previous;
        try {
            return await this.#execute<T>(method, path, body, bucket);
        } finally {
            release();
        }
    }

    /**
     * Sends a GET request.
     *
     * @typeParam T - Expected response type.
     * @param path - API path.
     * @returns The decoded response.
     */
    public get<T>(path: string): Promise<T> {
        return this.request<T>("GET", path);
    }

    /**
     * Sends a POST request.
     *
     * @typeParam T - Expected response type.
     * @param path - API path.
     * @param body - Optional JSON request body.
     * @returns The decoded response.
     */
    public post<T>(path: string, body?: unknown): Promise<T> {
        return this.request<T>("POST", path, body);
    }

    /**
     * Sends a PATCH request.
     *
     * @typeParam T - Expected response type.
     * @param path - API path.
     * @param body - Optional JSON request body.
     * @returns The decoded response.
     */
    public patch<T>(path: string, body?: unknown): Promise<T> {
        return this.request<T>("PATCH", path, body);
    }

    /**
     * Sends a PUT request.
     *
     * @typeParam T - Expected response type.
     * @param path - API path.
     * @param body - Optional JSON request body.
     * @returns The decoded response.
     */
    public put<T>(path: string, body?: unknown): Promise<T> {
        return this.request<T>("PUT", path, body);
    }

    /**
     * Sends a DELETE request.
     *
     * @typeParam T - Expected response type.
     * @param path - API path.
     * @returns The decoded response.
     */
    public delete<T>(path: string): Promise<T> {
        return this.request<T>("DELETE", path);
    }

    async #execute<T>(method: string, path: string, body: unknown, bucket: Bucket): Promise<T> {
        for (let attempt = 0; attempt <= this.#retries; attempt++) {
            await this.#wait(bucket);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.#timeout);
            try {
                const response = await fetch(`${REST_BASE_URL}${path}`, {
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
                if (response.ok) {
                    if (response.status === 204) return undefined as T;
                    return await response.json() as T;
                }
                const payload = await response.json().catch(() => ({})) as { code?: number; message?: string; retry_after?: number; global?: boolean };
                if (response.status === 429) {
                    const retryAfter = payload.retry_after ?? Number(response.headers.get("Retry-After") ?? 1);
                    if (payload.global) this.#globalResetAt = Date.now() + retryAfter * 1000;
                    if (attempt < this.#retries) {
                        await Bun.sleep(Math.ceil(retryAfter * 1000));
                        continue;
                    }
                    throw new RESTError(payload.message ?? "Rate limited", 429, payload.code, payload);
                }
                if (response.status >= 500 && attempt < this.#retries && ["GET", "HEAD", "PUT", "DELETE"].includes(method)) {
                    await Bun.sleep(Math.min(10_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
                    continue;
                }
                throw new RESTError(payload.message ?? response.statusText, response.status, payload.code, payload);
            } catch (error) {
                if (error instanceof RESTError || attempt >= this.#retries || !["GET", "HEAD", "PUT", "DELETE"].includes(method)) throw error;
                await Bun.sleep(Math.min(10_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250));
            } finally {
                clearTimeout(timer);
            }
        }
        throw new RESTError("Request failed", 500);
    }

    async #wait(bucket: Bucket): Promise<void> {
        const delay = Math.max(bucket.resetAt, this.#globalResetAt) - Date.now();
        if (delay > 0) await Bun.sleep(delay);
    }

    #update(response: Response, bucket: Bucket): void {
        const remaining = Number(response.headers.get("X-RateLimit-Remaining"));
        const resetAfter = Number(response.headers.get("X-RateLimit-Reset-After"));
        if (Number.isFinite(remaining)) bucket.remaining = remaining;
        if (Number.isFinite(resetAfter)) bucket.resetAt = Date.now() + resetAfter * 1000;
    }

    #route(method: string, path: string): string {
        const normalized = path.split("?")[0]
            .replace(/\/users\/\d+/g, "/users/:id")
            .replace(/\/guilds\/\d+/g, "/guilds/:id")
            .replace(/\/channels\/\d+/g, "/channels/:id")
            .replace(/\/webhooks\/\d+\/[^/]+/g, "/webhooks/:id/:token");
        return `${method}:${normalized}`;
    }
}
