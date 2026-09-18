import { RESTError, abortError } from "./errors.js";

/** Minimal fetch shape the transport depends on, so a stub needs no extras. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** One HTTP attempt, fully resolved: no routing, retry or rate-limit concerns. */
export interface TransportRequest {
    /** Uppercased HTTP method. */ method: string;
    /** Path with query string, relative to the transport's base URL. */ path: string;
    /** Request headers, already including authorization. */ headers: Record<
        string,
        string
    >;
    /** Encoded body, or undefined for a bodyless request. */ body?: BodyInit;
    /** Caller cancellation signal. */ signal?: AbortSignal;
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
            timeout?: number;
            fetch?: FetchLike;
        } = {},
    ) {
        this.#baseURL = (
            options.baseURL ?? "https://discord.com/api/v10"
        ).replace(/\/$/, "");
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
                error,
            );
        } finally {
            clearTimeout(timer);
            request.signal?.removeEventListener("abort", onAbort);
        }
    }
}
