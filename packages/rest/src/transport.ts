import { RESTError, abortError, sanitizeCause } from "./errors.js";

/** Minimal fetch shape the transport depends on, so a stub needs no extras. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** One HTTP attempt, fully resolved: no routing, retry or rate-limit concerns. */
export interface TransportRequest {
    /** Uppercased HTTP method. */
    method: string;
    /** Path with query string, relative to the transport's base URL. */
    path: string;
    /** Request headers, already including authorization. */
    headers: Record<string, string>;
    /** Encoded body, or undefined for a bodyless request. */
    body?: BodyInit;
    /** Caller cancellation signal. */
    signal?: AbortSignal;
}

/** Hosts that are this machine, where cleartext is acceptable. */
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Checks a base URL before the bot token is sent to it. It must be an
 * `https:` URL with no credentials, query or fragment; `http:` is accepted
 * for this machine, or anywhere with `allowInsecure`.
 * @throws {TypeError} Without repeating any credentials the URL contained.
 */
export function parseBaseURL(raw: string, allowInsecure = false): string {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new TypeError("baseURL must be an absolute http(s) URL.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new TypeError("baseURL must use https.");
    if (url.username || url.password)
        throw new TypeError("baseURL must not contain credentials.");
    if (url.search || url.hash || /[?#]/.test(raw))
        throw new TypeError("baseURL must not contain a query or fragment.");
    if (
        url.protocol === "http:" &&
        !allowInsecure &&
        !LOOPBACK.test(url.hostname)
    )
        throw new TypeError(
            "baseURL must use https: the bot token would travel in cleartext (allowInsecureBaseURL: true overrides this for a trusted network).",
        );
    return url.href.replace(/\/$/, "");
}

/** Thrown by {@link HttpTransport} when the attempt never produced a response. */
export class TransportError extends Error {
    /** Whether the attempt was cut short by the transport timeout or an abort. */
    public readonly timedOut: boolean;
    public constructor(message: string, timedOut: boolean, cause?: unknown) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = "TransportError";
        this.timedOut = timedOut;
    }
}

/**
 * Sends one HTTP attempt and returns the raw {@link Response}.
 *
 * Everything above it — routing, rate limiting, retries, decoding — is somebody
 * else's job, which is what makes the layer substitutable in tests.
 */
export class HttpTransport {
    readonly #baseURL: string;
    readonly #timeout: number;
    readonly #fetch: FetchLike;

    public constructor(
        options: {
            baseURL?: string;
            /** Allow a cleartext `http://` base URL on a network you trust (a REST proxy). Default false. */
            allowInsecureBaseURL?: boolean;
            timeout?: number;
            fetch?: FetchLike;
        } = {},
    ) {
        this.#baseURL = parseBaseURL(
            options.baseURL ?? "https://discord.com/api/v10",
            options.allowInsecureBaseURL,
        );
        this.#timeout = Math.max(1, options.timeout ?? 15_000);
        this.#fetch =
            options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    }

    /** Base URL every request path is resolved against. */
    public get baseURL(): string {
        return this.#baseURL;
    }
    /** Per-attempt timeout in milliseconds. */
    public get timeout(): number {
        return this.#timeout;
    }

    /**
     * Performs the attempt.
     * @throws {RESTError} If the caller's signal was already aborted.
     * @throws {TransportError} If the attempt times out or the transport fails.
     */
    public async send(request: TransportRequest): Promise<Response> {
        if (request.signal?.aborted)
            throw abortError(request.path, request.signal.reason);

        const controller = new AbortController();
        const onAbort = (): void => controller.abort(request.signal?.reason);
        request.signal?.addEventListener("abort", onAbort, { once: true });
        const timer = setTimeout(
            () =>
                controller.abort(
                    new DOMException("REST request timeout", "TimeoutError"),
                ),
            this.#timeout,
        );
        try {
            return await this.#fetch(`${this.#baseURL}${request.path}`, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                signal: controller.signal,
                // Discord's API does not redirect; one that does is not
                // something to send the token to.
                redirect: "error",
            });
        } catch (error) {
            if (error instanceof RESTError) throw error;
            const timedOut =
                error instanceof DOMException &&
                (error.name === "TimeoutError" || error.name === "AbortError");
            throw new TransportError(
                timedOut
                    ? `Discord REST request timed out after ${this.#timeout}ms`
                    : "Discord REST request failed",
                timedOut,
                sanitizeCause(error),
            );
        } finally {
            clearTimeout(timer);
            request.signal?.removeEventListener("abort", onAbort);
        }
    }
}
