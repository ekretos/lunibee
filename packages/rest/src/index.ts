/** Error thrown when Discord rejects a REST request. */
export class RESTError extends Error {
    /** HTTP status returned by Discord. */ public readonly status: number;
    /** Discord API error code, when provided. */ public readonly code?: number;
    /** Raw Discord validation/error payload. */ public readonly errors?: unknown;
    /** HTTP method used for the failed request. */ public readonly method?: string;
    /** API path used for the failed request. */ public readonly path?: string;
    /** Creates a REST error with request context. */
    public constructor(message: string, status: number, code?: number, errors?: unknown, options: { method?: string; path?: string; cause?: unknown } = {}) { super(message, options.cause === undefined ? undefined : { cause: options.cause }); this.name = "RESTError"; this.status = status; this.code = code; this.errors = errors; this.method = options.method; this.path = options.path; }
}

type Bucket = { remaining: number; resetAt: number; queue: Promise<void> };

/** Bun-native REST transport with route/global rate-limit coordination and safe retries. */
export class REST {
    readonly #baseURL: string; readonly #timeout: number; readonly #retries: number; #token?: string; #globalResetAt = 0;
    readonly #buckets = new Map<string, Bucket>();
    /** Creates a REST transport. */
    public constructor(options: { token?: string; timeout?: number; retries?: number; baseURL?: string } = {}) { this.#token = options.token; this.#timeout = Math.max(1, options.timeout ?? 15_000); this.#retries = Math.max(0, options.retries ?? 2); try { this.#baseURL = new URL(options.baseURL ?? "https://discord.com/api/v10").toString().replace(/\/$/, ""); } catch (error) { throw new TypeError("REST baseURL must be a valid URL.", { cause: error }); } }
    /** Sets the authentication token. */
    public setToken(token: string): void { if (!token.trim()) throw new TypeError("A Discord bot token is required."); this.#token = token; }
    /** Executes an HTTP request with route and global rate-limit handling. */
    public async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const normalizedMethod = method.toUpperCase(); if (!/^[A-Z]+$/.test(normalizedMethod)) throw new TypeError("REST method must contain only letters."); if (!path.startsWith("/")) throw new TypeError("REST paths must start with '/'.");
        const route = `${normalizedMethod}:${this.#normalizeRoute(path)}`; const bucket = this.#buckets.get(route) ?? { remaining: 1, resetAt: 0, queue: Promise.resolve() }; this.#buckets.set(route, bucket); const previous = bucket.queue; let release!: () => void; bucket.queue = new Promise(resolve => { release = resolve; }); await previous;
        try {
            for (let attempt = 0; attempt <= this.#retries; attempt++) {
                await this.#wait(bucket); await this.#waitGlobal(); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.#timeout);
                try {
                    const response = await fetch(`${this.#baseURL}${path}`, { method: normalizedMethod, headers: { ...(this.#token ? { Authorization: `Bot ${this.#token}` } : {}), "Content-Type": "application/json", "User-Agent": "Lunibee/0.1.0" }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
                    this.#update(response, bucket); const payload = await this.#readPayload(response); if (response.ok) return (response.status === 204 ? undefined : payload) as T;
                    const data = this.#errorData(payload);
                    if (response.status === 429) { const retryAfter = this.#retryAfter(response, data); if (data.global) this.#globalResetAt = Date.now() + retryAfter * 1000; if (attempt < this.#retries) { await Bun.sleep(retryAfter * 1000); continue; } }
                    const retryable = response.status >= 500 && response.status <= 599 && ["GET", "HEAD", "PUT", "DELETE"].includes(normalizedMethod); if (retryable && attempt < this.#retries) { await Bun.sleep(this.#backoff(attempt)); continue; }
                    throw new RESTError(data.message ?? response.statusText ?? `Discord REST request failed with status ${response.status}`, response.status, data.code, payload, { method: normalizedMethod, path });
                } catch (error) {
                    if (error instanceof RESTError) throw error; const retryable = ["GET", "HEAD", "PUT", "DELETE"].includes(normalizedMethod); if (retryable && attempt < this.#retries) { await Bun.sleep(this.#backoff(attempt)); continue; }
                    const isAbort = error instanceof DOMException && error.name === "AbortError"; throw new RESTError(isAbort ? `Discord REST request timed out after ${this.#timeout}ms` : "Discord REST request failed", 0, undefined, undefined, { method: normalizedMethod, path, cause: error });
                } finally { clearTimeout(timer); }
            }
            throw new RESTError("Discord REST request exhausted its retry attempts", 0, undefined, undefined, { method: normalizedMethod, path });
        } finally { release(); }
    }
    /** Sends a GET request. */ public get<T>(path: string): Promise<T> { return this.request<T>("GET", path); }
    /** Sends a POST request. */ public post<T>(path: string, body?: unknown): Promise<T> { return this.request<T>("POST", path, body); }
    /** Sends a PATCH request. */ public patch<T>(path: string, body?: unknown): Promise<T> { return this.request<T>("PATCH", path, body); }
    /** Sends a PUT request. */ public put<T>(path: string, body?: unknown): Promise<T> { return this.request<T>("PUT", path, body); }
    /** Sends a DELETE request. */ public delete<T>(path: string): Promise<T> { return this.request<T>("DELETE", path); }
    async #wait(bucket: Bucket): Promise<void> { const delay = bucket.resetAt - Date.now(); if (bucket.remaining <= 0 && delay > 0) await Bun.sleep(delay); }
    async #waitGlobal(): Promise<void> { const delay = this.#globalResetAt - Date.now(); if (delay > 0) await Bun.sleep(delay); }
    async #readPayload(response: Response): Promise<unknown> { if (response.status === 204) return undefined; const contentType = response.headers.get("content-type") ?? ""; if (contentType.includes("application/json")) return response.json().catch(() => undefined); return response.text().catch(() => undefined); }
    #errorData(payload: unknown): { message?: string; code?: number; retry_after?: number; global?: boolean } { if (!payload || typeof payload !== "object") return {}; const data = payload as Record<string, unknown>; return { message: typeof data.message === "string" ? data.message : undefined, code: typeof data.code === "number" ? data.code : undefined, retry_after: typeof data.retry_after === "number" ? data.retry_after : undefined, global: data.global === true }; }
    #retryAfter(response: Response, data: { retry_after?: number }): number { const header = Number(response.headers.get("Retry-After")); return Math.max(0, data.retry_after ?? (Number.isFinite(header) ? header : 1)); }
    #backoff(attempt: number): number { return Math.min(10_000, 500 * 2 ** attempt) + Math.random() * 250; }
    #normalizeRoute(path: string): string { const queryIndex = path.indexOf("?"); return (queryIndex === -1 ? path : path.slice(0, queryIndex)).replace(/\/\d+(?=\/|$)/g, "/:id"); }
    #update(response: Response, bucket: Bucket): void { const remaining = Number(response.headers.get("X-RateLimit-Remaining")); const resetAfter = Number(response.headers.get("X-RateLimit-Reset-After")); if (Number.isFinite(remaining)) bucket.remaining = remaining; if (Number.isFinite(resetAfter)) bucket.resetAt = Date.now() + resetAfter * 1000; if (response.headers.get("X-RateLimit-Global") === "true") { const retryAfter = Number(response.headers.get("Retry-After")); if (Number.isFinite(retryAfter)) this.#globalResetAt = Date.now() + retryAfter * 1000; } }
}
