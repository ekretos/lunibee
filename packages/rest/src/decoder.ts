/** Normalised shape of a Discord error payload. */
export interface DecodedError {
    message?: string;
    code?: number;
    retry_after?: number;
    global?: boolean;
}

/** Turns a raw {@link Response} into a payload and the error metadata retries need. */
export class ResponseDecoder {
    /** Reads a Discord response payload as JSON, text, or nothing for 204. */
    public async read(response: Response): Promise<unknown> {
        if (response.status === 204) return undefined;
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json"))
            return response.json().catch(() => undefined);
        return response.text().catch(() => undefined);
    }

    /** Extracts Discord's error metadata from a decoded payload. */
    public errorData(payload: unknown): DecodedError {
        if (!payload || typeof payload !== "object") return {};
        const data = payload as Record<string, unknown>;
        return {
            message:
                typeof data.message === "string" ? data.message : undefined,
            code: typeof data.code === "number" ? data.code : undefined,
            retry_after:
                typeof data.retry_after === "number"
                    ? data.retry_after
                    : undefined,
            global: data.global === true,
        };
    }

    /**
     * Resolves Retry-After (seconds) from the payload, falling back to the
     * header and finally to one second.
     *
     * An absent header is explicitly *not* a zero delay: `Number(null)` is 0,
     * which is finite, so reading it directly would answer a 429 that carries
     * no Retry-After by retrying immediately — exactly when backing off matters.
     */
    public retryAfter(response: Response, data: DecodedError): number {
        const raw = response.headers.get("Retry-After");
        const header = raw === null ? Number.NaN : Number(raw);
        const retryAfter =
            data.retry_after ?? (Number.isFinite(header) ? header : 1);
        return Math.max(0, retryAfter);
    }
}
