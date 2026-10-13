/** Why a REST request failed, for handling without matching on status codes. */
export type RESTErrorKind =
    /** Cancelled through an AbortSignal. */
    | "aborted"
    /** The attempt exceeded the transport timeout. */
    | "timeout"
    /** No response: DNS, TLS, connection reset. */
    | "network"
    /** 429 that outlived the retry budget. */
    | "rateLimited"
    /** 401: invalid or revoked token. */
    | "authentication"
    /** 403: missing access or permissions. */
    | "permission"
    /** 404: unknown resource. */
    | "notFound"
    /** 400 / 422: the request body or parameters were rejected. */
    | "validation"
    /** 5xx: Discord failed to handle the request. */
    | "server"
    /** Any other 4xx. */
    | "client";

function kindFromStatus(status: number): RESTErrorKind {
    if (status === 429) return "rateLimited";
    if (status === 401) return "authentication";
    if (status === 403) return "permission";
    if (status === 404) return "notFound";
    if (status === 400 || status === 422) return "validation";
    if (status >= 500) return "server";
    if (status === 0) return "network";
    return "client";
}

/**
 * Replaces the token segment of webhook and interaction paths with `:token`,
 * so request paths can appear in errors, hooks and logs without leaking a
 * credential.
 */
export function redactPath(path: string): string {
    return (
        path
            // The ID segment is matched loosely: a malformed ID must not stop the
            // token that follows it from being redacted.
            .replace(/^(\/webhooks\/[^/?]+\/)[^/?]+/i, "$1:token")
            .replace(/^(\/interactions\/[^/?]+\/)[^/?]+/i, "$1:token")
    );
}

/** Webhook and interaction tokens inside any text, such as the URL in a network error's message. */
const TOKEN_IN_TEXT =
    /(\/(?:webhooks|interactions)\/[^/\s?"'`]+\/)[^/\s?"'`]+/gi;

/** Hides webhook and interaction tokens in free text. */
export function redactText(text: string): string {
    return text.replace(TOKEN_IN_TEXT, "$1:token");
}

/**
 * A copy of a lower-level error that is safe to attach as a `cause`: the same
 * name and code, with tokens removed from the message and stack. Runtimes put
 * the request URL in network error messages, and the URL holds webhook tokens.
 */
export function sanitizeCause(error: unknown): unknown {
    if (!(error instanceof Error)) return undefined;
    const copy = new Error(redactText(error.message));
    copy.name = error.name;
    if (error.stack) copy.stack = redactText(error.stack);
    for (const key of ["code", "errno", "syscall"] as const) {
        const value = (error as unknown as Record<string, unknown>)[key];
        if (typeof value === "string" || typeof value === "number")
            (copy as unknown as Record<string, unknown>)[key] = value;
    }
    return copy;
}

/** What to check when Discord refuses an action the bot attempted. */
const HINTS: Readonly<Record<number, string>> = {
    50001: "The bot cannot see this resource: check that it is in the guild and has View Channel there.",
    50013: "The bot lacks a permission for this action, or the target role or member is at or above the bot's highest role.",
};

/** Error thrown when Discord rejects a REST request. */
export class RESTError extends Error {
    /** Failure category. */
    public readonly kind: RESTErrorKind;
    /** HTTP status returned by Discord. */
    public readonly status: number;
    /** Discord API error code, when provided. */
    public readonly code?: number;
    /** Raw Discord validation/error payload. */
    public readonly errors?: unknown;
    /** HTTP method used for the failed request. */
    public readonly method?: string;
    /** API path used for the failed request. */
    public readonly path?: string;
    /** What to check next, for errors with a common cause (missing access or permissions). */
    public readonly hint?: string;
    /** Creates a REST error with request context. @param message Error message. @param status HTTP status. @param code Discord error code. @param errors Raw error payload. @param options Request context and cause. */
    public constructor(
        message: string,
        status: number,
        code?: number,
        errors?: unknown,
        options: {
            method?: string;
            path?: string;
            cause?: unknown;
            kind?: RESTErrorKind;
        } = {},
    ) {
        super(
            message,
            options.cause === undefined ? undefined : { cause: options.cause },
        );
        this.name = "RESTError";
        this.status = status;
        this.kind = options.kind ?? kindFromStatus(status);
        this.code = code;
        this.hint = code === undefined ? undefined : HINTS[code];
        this.errors = errors;
        this.method = options.method;
        this.path =
            options.path === undefined ? undefined : redactPath(options.path);
    }

    /** Whether sending the same request again later could succeed. Validation,
     * permission, authentication and not-found failures never will. */
    public get retryable(): boolean {
        return (
            this.kind === "rateLimited" ||
            this.kind === "server" ||
            this.kind === "network" ||
            this.kind === "timeout"
        );
    }
}

/** Creates the cancellation error shared by every stage of the request pipeline. */
export function abortError(path: string, reason: unknown): RESTError {
    return new RESTError(
        reason instanceof Error
            ? reason.message
            : "Discord REST request was aborted",
        0,
        undefined,
        undefined,
        { path, cause: reason, kind: "aborted" },
    );
}

/** Waits for a delay, rejecting early if the signal aborts. */
export async function sleep(
    delay: number,
    signal: AbortSignal | undefined,
    path: string,
): Promise<void> {
    if (delay <= 0) return;
    await new Promise<void>((resolve, reject) => {
        // Every way out clears the timer and removes the listener, so a signal
        // shared by many requests does not collect one listener per wait.
        const finish = (error?: Error): void => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            if (error) reject(error);
            else resolve();
        };
        const onAbort = (): void => finish(abortError(path, signal?.reason));
        const timer = setTimeout(finish, delay);
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/** Awaits a promise, rejecting early if the signal aborts. */
export async function abortable(
    promise: Promise<void>,
    signal: AbortSignal | undefined,
    path: string,
): Promise<void> {
    if (!signal) return promise;
    if (signal.aborted) throw abortError(path, signal.reason);
    return new Promise<void>((resolve, reject) => {
        const onAbort = (): void => reject(abortError(path, signal.reason));
        signal.addEventListener("abort", onAbort, { once: true });
        // Whichever settles first, the listener goes.
        promise.then(
            () => {
                signal.removeEventListener("abort", onAbort);
                resolve();
            },
            (error: unknown) => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}
