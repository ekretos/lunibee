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

/** Creates the cancellation error shared by every stage of the request pipeline. */
export function abortError(path: string, reason: unknown): RESTError {
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

/** Waits for a delay, rejecting early if the signal aborts. */
export async function sleep(
    delay: number,
    signal: AbortSignal | undefined,
    path: string,
): Promise<void> {
    if (delay <= 0) return;
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        const abort = (): void => {
            clearTimeout(timer);
            reject(abortError(path, signal?.reason));
        };
        if (signal?.aborted) return abort();
        signal?.addEventListener("abort", abort, { once: true });
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
    return Promise.race([
        promise,
        new Promise<void>((_, reject) =>
            signal.addEventListener(
                "abort",
                () => reject(abortError(path, signal.reason)),
                { once: true },
            ),
        ),
    ]);
}
