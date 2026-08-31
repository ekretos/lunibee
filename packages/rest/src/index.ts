/** Error thrown when Discord rejects a REST request. */
export class RESTError extends Error {
  /** HTTP status returned by Discord. */ public readonly status: number;
  /** Discord API error code, when provided. */ public readonly code?: number;
  /** Raw Discord validation/error payload. */ public readonly errors?: unknown;
  /** HTTP method used for the failed request. */ public readonly method?: string;
  /** API path used for the failed request. */ public readonly path?: string;
  /** Creates a REST error with request context. @param message Error message. @param status HTTP status. @param code Discord error code. @param errors Raw error payload. @param options Request context and cause. */
  public constructor(
    message: string,
    status: number,
    code?: number,
    errors?: unknown,
    options: { method?: string; path?: string; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "RESTError";
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.method = options.method;
    this.path = options.path;
  }
}

/** Library version and source URL used for the Discord-compliant User-Agent. */
const LIBRARY_VERSION = "0.1.6";
const LIBRARY_URL = "https://github.com/Ekretos/lunibee";
const USER_AGENT = `DiscordBot (${LIBRARY_URL}, ${LIBRARY_VERSION})`;

/** Internal state shared by requests mapped to one Discord rate-limit bucket. */
type Bucket = { remaining: number; resetAt: number; queue: Promise<void> };
/** Options controlling an individual REST request. */
export interface RESTRequestOptions {
  /** Abort signal used to cancel the request and any queued wait. */ signal?: AbortSignal;
}

/** Configures which REST failures may be retried. */
export interface RetryPolicy {
  /** Maximum retry attempts. */ maxRetries: number;
  /** Determines whether a request may be retried. @param method HTTP method. @param status HTTP status, or zero for transport errors. @returns True when retrying is safe under the policy. */ shouldRetry(
    method: string,
    status: number,
  ): boolean;
  /** Calculates delay before the next attempt. @param attempt Zero-based retry number. @param retryAfter Server-provided delay, when available. @returns Delay in milliseconds. */ getDelay(
    attempt: number,
    retryAfter?: number,
  ): number;
}
/** Creates the default conservative REST retry policy. @param maxRetries Maximum retries. @returns Retry policy that retries rate limits and idempotent transient failures. @throws {TypeError} If maxRetries is negative or not finite. */
export function createRetryPolicy(maxRetries = 2): RetryPolicy {
  if (!Number.isFinite(maxRetries) || maxRetries < 0)
    throw new TypeError("maxRetries must be a non-negative finite number.");
  return {
    maxRetries: Math.floor(maxRetries),
    shouldRetry(method, status) {
      const normalized = method.toUpperCase();
      return (
        status === 429 ||
        (status >= 500 &&
          status <= 599 &&
          ["GET", "HEAD", "PUT", "DELETE"].includes(normalized))
      );
    },
    getDelay(attempt, retryAfter) {
      if (retryAfter !== undefined) return Math.max(0, retryAfter * 1000);
      return Math.min(10_000, 500 * 2 ** attempt) + Math.random() * 250;
    },
  };
}

/** Bun-native REST transport with Discord bucket-aware rate limiting, retries, and cancellation. */
export class REST {
  readonly #baseURL: string;
  readonly #timeout: number;
  readonly #retryPolicy: RetryPolicy;
  #token?: string;
  #globalResetAt = 0;
  readonly #buckets = new Map<string, Bucket>();
  readonly #routeBuckets = new Map<string, string>();
  /** Creates a REST transport. @param options Transport configuration. @throws {TypeError} If retry configuration is invalid. */
  public constructor(
    options: {
      token?: string;
      timeout?: number;
      retries?: number;
      retryPolicy?: RetryPolicy;
      baseURL?: string;
    } = {},
  ) {
    this.#token = options.token;
    this.#timeout = Math.max(1, options.timeout ?? 15_000);
    this.#retryPolicy =
      options.retryPolicy ?? createRetryPolicy(options.retries ?? 2);
    this.#baseURL = (options.baseURL ?? "https://discord.com/api/v10").replace(
      /\/$/,
      "",
    );
  }
  /** Sets the authentication token. @param token Discord bot token. @returns Nothing. @throws {TypeError} If token is empty. */
  public setToken(token: string): void {
    if (!token.trim()) throw new TypeError("A Discord bot token is required.");
    this.#token = token;
  }
  /** Executes an HTTP request with Discord bucket/global rate limits, retry handling, and AbortSignal support.
   * Accepts a JSON body, a FormData body (for file uploads), or undefined.
   * @param method HTTP method.
   * @param path API path.
   * @param body Optional JSON body, FormData for file uploads, or undefined.
   * @param options Cancellation options.
   * @returns Decoded response body.
   * @throws {RESTError} If Discord or transport rejects the request.
   */
  public async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RESTRequestOptions = {},
  ): Promise<T> {
    const normalizedMethod = method.toUpperCase();
    if (!normalizedMethod) throw new TypeError("REST method is required.");
    if (!path.startsWith("/"))
      throw new TypeError("REST paths must start with '/'.");
    const route = `${normalizedMethod}:${this.#normalizeRoute(path)}`;
    let bucketKey = this.#routeBuckets.get(route) ?? route;
    let bucket = this.#buckets.get(bucketKey) ?? {
      remaining: 1,
      resetAt: 0,
      queue: Promise.resolve(),
    };
    this.#buckets.set(bucketKey, bucket);
    const previous = bucket.queue;
    let release!: () => void;
    bucket.queue = new Promise((resolve) => {
      release = resolve;
    });
    await this.#abortable(previous, options.signal, path);
    try {
      for (
        let attempt = 0;
        attempt <= this.#retryPolicy.maxRetries;
        attempt++
      ) {
        await this.#wait(bucket, options.signal, path);
        await this.#waitGlobal(options.signal, path);
        const controller = new AbortController();
        const onAbort = () => controller.abort(options.signal?.reason);
        if (options.signal?.aborted)
          throw this.#abortError(path, options.signal.reason);
        options.signal?.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(
          () =>
            controller.abort(
              new DOMException("REST request timeout", "TimeoutError"),
            ),
          this.#timeout,
        );
        // Build headers and body based on whether this is a multipart request
        const isFormData =
          typeof FormData !== "undefined" && body instanceof FormData;
        const headers: Record<string, string> = {
          ...(this.#token ? { Authorization: `Bot ${this.#token}` } : {}),
          "User-Agent": USER_AGENT,
        };
        if (!isFormData) headers["Content-Type"] = "application/json";
        const fetchBody = isFormData
          ? (body as FormData)
          : body === undefined
            ? undefined
            : JSON.stringify(body);
        try {
          const response = await fetch(`${this.#baseURL}${path}`, {
            method: normalizedMethod,
            headers,
            body: fetchBody,
            signal: controller.signal,
          });
          bucket = this.#update(response, bucket, route, bucketKey);
          bucketKey = this.#routeBuckets.get(route) ?? bucketKey;
          const payload = await this.#readPayload(response);
          if (response.ok)
            return (response.status === 204 ? undefined : payload) as T;
          const data = this.#errorData(payload);
          const retryAfter =
            response.status === 429
              ? this.#retryAfter(response, data)
              : undefined;
          if (data.global && retryAfter !== undefined)
            this.#globalResetAt = Date.now() + retryAfter * 1000;
          if (
            attempt < this.#retryPolicy.maxRetries &&
            this.#retryPolicy.shouldRetry(normalizedMethod, response.status)
          ) {
            await this.#sleep(
              this.#retryPolicy.getDelay(attempt, retryAfter),
              options.signal,
              path,
            );
            continue;
          }
          throw new RESTError(
            data.message ??
              response.statusText ??
              `Discord REST request failed with status ${response.status}`,
            response.status,
            data.code,
            payload,
            { method: normalizedMethod, path },
          );
        } catch (error) {
          if (error instanceof RESTError) throw error;
          if (options.signal?.aborted)
            throw this.#abortError(path, options.signal.reason);
          const isTimeout =
            error instanceof DOMException &&
            (error.name === "TimeoutError" || error.name === "AbortError");
          if (
            !isTimeout &&
            attempt < this.#retryPolicy.maxRetries &&
            this.#retryPolicy.shouldRetry(normalizedMethod, 0)
          ) {
            await this.#sleep(
              this.#retryPolicy.getDelay(attempt),
              options.signal,
              path,
            );
            continue;
          }
          throw new RESTError(
            isTimeout
              ? `Discord REST request timed out after ${this.#timeout}ms`
              : "Discord REST request failed",
            0,
            undefined,
            undefined,
            { method: normalizedMethod, path, cause: error },
          );
        } finally {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", onAbort);
        }
      }
      throw new RESTError(
        "Discord REST request exhausted its retry attempts",
        0,
        undefined,
        undefined,
        { method: normalizedMethod, path },
      );
    } finally {
      release();
    }
  }
  /** Sends a GET request. @param path API path. @param options Cancellation options. @returns Decoded response. @throws {RESTError} When the request fails. */ public get<
    T,
  >(path: string, options?: RESTRequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, options);
  }
  /** Sends a POST request. @param path API path. @param body Optional JSON body. @param options Cancellation options. @returns Decoded response. @throws {RESTError} When the request fails. */ public post<
    T,
  >(path: string, body?: unknown, options?: RESTRequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }
  /** Sends a PATCH request. @param path API path. @param body Optional JSON body. @param options Cancellation options. @returns Decoded response. @throws {RESTError} When the request fails. */ public patch<
    T,
  >(path: string, body?: unknown, options?: RESTRequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, body, options);
  }
  /** Sends a PUT request. @param path API path. @param body Optional JSON body. @param options Cancellation options. @returns Decoded response. @throws {RESTError} When the request fails. */ public put<
    T,
  >(path: string, body?: unknown, options?: RESTRequestOptions): Promise<T> {
    return this.request<T>("PUT", path, body, options);
  }
  /** Sends a DELETE request. @param path API path. @param options Cancellation options. @returns Decoded response. @throws {RESTError} When the request fails. */ public delete<
    T,
  >(path: string, options?: RESTRequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, undefined, options);
  }
  /**
   * Sends a multipart/form-data POST request for file uploads.
   * Attaches a JSON payload as `payload_json` and files as additional fields.
   * @param path API path.
   * @param payload JSON payload (e.g. message content, embeds).
   * @param files Array of file attachments.
   * @param options Cancellation options.
   * @returns Decoded response.
   * @throws {RESTError} When the request fails.
   */
  public postWithFiles<T>(
    path: string,
    payload: unknown,
    files: Array<{
      name: string;
      data: Blob | Uint8Array | ArrayBuffer;
      contentType?: string;
    }>,
    options?: RESTRequestOptions,
  ): Promise<T> {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const blob =
        file.data instanceof Blob
          ? file.data
          : new Blob([file.data as ArrayBuffer], {
              type: file.contentType ?? "application/octet-stream",
            });
      form.append(`files[${i}]`, blob, file.name);
    }
    return this.request<T>("POST", path, form, options);
  }
  /**
   * Sends a multipart/form-data PATCH request for editing messages with files.
   * @param path API path.
   * @param payload JSON payload.
   * @param files Array of file attachments.
   * @param options Cancellation options.
   * @returns Decoded response.
   * @throws {RESTError} When the request fails.
   */
  public patchWithFiles<T>(
    path: string,
    payload: unknown,
    files: Array<{
      name: string;
      data: Blob | Uint8Array | ArrayBuffer;
      contentType?: string;
    }>,
    options?: RESTRequestOptions,
  ): Promise<T> {
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const blob =
        file.data instanceof Blob
          ? file.data
          : new Blob([file.data as ArrayBuffer], {
              type: file.contentType ?? "application/octet-stream",
            });
      form.append(`files[${i}]`, blob, file.name);
    }
    return this.request<T>("PATCH", path, form, options);
  }
  /** Waits for a route bucket while respecting cancellation. @param bucket Bucket state. @param signal Optional cancellation signal. @param path Request path for error context. @returns Promise fulfilled when sending is permitted. @throws {RESTError} If the request is aborted. */
  async #wait(
    bucket: Bucket,
    signal: AbortSignal | undefined,
    path: string,
  ): Promise<void> {
    const delay = bucket.resetAt - Date.now();
    if (bucket.remaining <= 0 && delay > 0)
      await this.#sleep(delay, signal, path);
  }
  /** Waits for the global Discord rate limit while respecting cancellation. @param signal Optional cancellation signal. @param path Request path for error context. @returns Promise fulfilled when the global limit expires. @throws {RESTError} If the request is aborted. */
  async #waitGlobal(
    signal: AbortSignal | undefined,
    path: string,
  ): Promise<void> {
    const delay = this.#globalResetAt - Date.now();
    if (delay > 0) await this.#sleep(delay, signal, path);
  }
  /** Waits for a delay or aborts immediately. @param delay Delay in milliseconds. @param signal Optional cancellation signal. @param path Request path. @returns Promise fulfilled after delay. @throws {RESTError} If aborted. */
  async #sleep(
    delay: number,
    signal: AbortSignal | undefined,
    path: string,
  ): Promise<void> {
    if (delay <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      const abort = () => {
        clearTimeout(timer);
        reject(this.#abortError(path, signal?.reason));
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
  /** Waits for a queued request or aborts. @param promise Queue predecessor. @param signal Optional cancellation signal. @param path Request path. @returns Promise fulfilled when predecessor releases. @throws {RESTError} If aborted. */
  async #abortable(
    promise: Promise<void>,
    signal: AbortSignal | undefined,
    path: string,
  ): Promise<void> {
    if (!signal) return promise;
    if (signal.aborted) throw this.#abortError(path, signal.reason);
    return Promise.race([
      promise,
      new Promise<void>((_, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(this.#abortError(path, signal.reason)),
          { once: true },
        ),
      ),
    ]);
  }
  /** Creates a consistent cancellation error. @param path Request path. @param reason Abort reason. @returns REST cancellation error. */
  #abortError(path: string, reason: unknown): RESTError {
    return new RESTError(
      reason instanceof Error
        ? reason.message
        : "Discord REST request was aborted",
      0,
      undefined,
      undefined,
      { path, cause: reason },
    );
  }
  /** Reads a Discord response payload. @param response HTTP response. @returns JSON or text payload. */
  async #readPayload(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json"))
      return response.json().catch(() => undefined);
    return response.text().catch(() => undefined);
  }
  /** Extracts retry metadata from a Discord payload. @param payload Response payload. @returns Normalized error metadata. */
  #errorData(payload: unknown): {
    message?: string;
    code?: number;
    retry_after?: number;
    global?: boolean;
  } {
    if (!payload || typeof payload !== "object") return {};
    const data = payload as Record<string, unknown>;
    return {
      message: typeof data.message === "string" ? data.message : undefined,
      code: typeof data.code === "number" ? data.code : undefined,
      retry_after:
        typeof data.retry_after === "number" ? data.retry_after : undefined,
      global: data.global === true,
    };
  }
  /** Resolves Retry-After from headers or JSON. @param response HTTP response. @param data Parsed response metadata. @returns Retry delay in seconds. */
  #retryAfter(response: Response, data: { retry_after?: number }): number {
    const header = Number(response.headers.get("Retry-After"));
    const retryAfter =
      data.retry_after ?? (Number.isFinite(header) ? header : 1);
    return Math.max(0, retryAfter);
  }
  /** Normalizes Discord routes for stable bucket discovery. @param path API path. @returns Normalized route. */
  #normalizeRoute(path: string): string {
    const queryIndex = path.indexOf("?");
    const routePath = queryIndex === -1 ? path : path.slice(0, queryIndex);
    return routePath.replace(/\/\d+(?=\/|$)/g, "/:id");
  }
  /** Updates bucket state from Discord's rate-limit headers and records the server bucket hash. @param response HTTP response. @param bucket Current bucket. @param route Normalized local route key. @param bucketKey Current bucket identifier. @returns Bucket state used for subsequent attempts. */
  #update(
    response: Response,
    bucket: Bucket,
    route: string,
    bucketKey: string,
  ): Bucket {
    const serverBucket = response.headers.get("X-RateLimit-Bucket");
    if (serverBucket) {
      this.#routeBuckets.set(route, serverBucket);
      if (serverBucket !== bucketKey) {
        const shared = this.#buckets.get(serverBucket) ?? bucket;
        this.#buckets.set(serverBucket, shared);
        bucket = shared;
      }
    }
    const remaining = Number(response.headers.get("X-RateLimit-Remaining"));
    const resetAfter = Number(response.headers.get("X-RateLimit-Reset-After"));
    const reset = Number(response.headers.get("X-RateLimit-Reset"));
    if (Number.isFinite(remaining)) bucket.remaining = Math.max(0, remaining);
    if (Number.isFinite(resetAfter))
      bucket.resetAt = Date.now() + Math.max(0, resetAfter) * 1000;
    else if (Number.isFinite(reset)) bucket.resetAt = reset * 1000;
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      if (Number.isFinite(retryAfter))
        bucket.resetAt = Math.max(
          bucket.resetAt,
          Date.now() + retryAfter * 1000,
        );
    }
    if (response.headers.get("X-RateLimit-Global") === "true") {
      const retryAfter = Number(response.headers.get("Retry-After"));
      if (Number.isFinite(retryAfter))
        this.#globalResetAt = Math.max(
          this.#globalResetAt,
          Date.now() + retryAfter * 1000,
        );
    }
    return bucket;
  }
}

export { Routes } from "./routes.js";

export {
  WebhookClient,
  type WebhookClientOptions,
  type WebhookMessageOptions,
} from "./webhook.js";
