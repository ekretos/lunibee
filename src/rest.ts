import { RESTError } from "./errors.js";
import type { RESTOptions } from "./types.js";

const BASE_URL = "https://discord.com/api/v10";

export class REST {
    readonly #timeout: number;
    readonly #retries: number;
    #token?: string;

    public constructor(token?: string, options: RESTOptions = {}) {
        this.#token = token;
        this.#timeout = options.timeout ?? 15_000;
        this.#retries = Math.max(0, options.retries ?? 2);
    }

    public setToken(token: string): void {
        this.#token = token;
    }

    public async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        for (let attempt = 0; attempt <= this.#retries; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.#timeout);

            try {
                const response = await fetch(`${BASE_URL}${path}`, {
                    method,
                    headers: {
                        Authorization: `Bot ${this.#token}`,
                        "Content-Type": "application/json",
                        "User-Agent": "Lunibee/0.1.0"
                    },
                    body: body === undefined ? undefined : JSON.stringify(body),
                    signal: controller.signal
                });

                if (response.ok) {
                    if (response.status === 204) return undefined as T;
                    return await response.json() as T;
                }

                const payload = await response.json().catch(() => ({})) as {
                    code?: number;
                    message?: string;
                    retry_after?: number;
                    global?: boolean;
                };

                if (response.status === 429) {
                    const retryAfter = payload.retry_after ?? Number(response.headers.get("Retry-After") ?? 1);
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
            } finally {
                clearTimeout(timer);
            }
        }

        throw new RESTError("Request failed", 500);
    }

    public get<T>(path: string): Promise<T> {
        return this.request<T>("GET", path);
    }
}
