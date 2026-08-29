import { describe, expect, test } from "bun:test";
import { AuthenticationError, RateLimitError, REST, RESTTimeoutError } from "../src/index.js";

const realFetch = globalThis.fetch;

describe("REST", () => {
    test("normalizes authentication failures", async () => {
        globalThis.fetch = async () => new Response(JSON.stringify({ message: "401" }), { status: 401, headers: { "content-type": "application/json" } });
        await expect(new REST({ retries: 0 }).get("/users/@me")).rejects.toBeInstanceOf(AuthenticationError);
    });

    test("normalizes exhausted rate limits", async () => {
        globalThis.fetch = async () => new Response(JSON.stringify({ retry_after: 0, global: false }), { status: 429, headers: { "content-type": "application/json", "Retry-After": "0" } });
        await expect(new REST({ retries: 0 }).get("/users/@me")).rejects.toBeInstanceOf(RateLimitError);
    });

    test("supports AbortSignal cancellation", async () => {
        const controller = new AbortController();
        globalThis.fetch = async (_input, init) => await new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
            controller.abort();
        });
        await expect(new REST({ retries: 0 }).get("/users/@me", controller.signal)).rejects.toBeDefined();
    });
});

afterAll(() => { globalThis.fetch = realFetch; });
