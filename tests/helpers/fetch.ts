/** The part of `fetch` a test stub needs to implement. */
export type FetchHandler = (
    url: string,
    init: RequestInit,
) => Response | Promise<Response>;

/** Wraps `handler` as a drop-in replacement for `globalThis.fetch`. */
export function fakeFetch(handler: FetchHandler): typeof fetch {
    return Object.assign(
        async (input: string | URL | Request, init: RequestInit = {}) =>
            handler(input instanceof Request ? input.url : String(input), init),
        { preconnect: () => {} },
    );
}
