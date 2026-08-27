/** Options accepted by a REST request. */
export interface RequestOptions {
    /** Additional request headers. */
    headers?: HeadersInit;
    /** Request body. Objects are encoded as JSON. */
    body?: unknown;
    /** Abort signal used to cancel the request. */
    signal?: AbortSignal;
    /** Request timeout in milliseconds. Overrides the client default. */
    timeout?: number;
    /** Number of retry attempts. Overrides the client default. */
    retries?: number;
}

/** Result metadata returned by Discord rate-limit headers. */
export interface RateLimitInfo {
    /** Route bucket identifier. */
    bucket: string | null;
    /** Number of requests remaining in the bucket. */
    remaining: number | null;
    /** Number of requests allowed by the bucket. */
    limit: number | null;
    /** Seconds until the bucket resets. */
    resetAfter: number | null;
    /** Whether the response was globally rate limited. */
    global: boolean;
}
