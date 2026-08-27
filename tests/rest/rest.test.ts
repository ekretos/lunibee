import { afterEach, describe, expect, mock, test } from "bun:test";
import { AuthenticationError, RateLimitError, REST } from "@lunibee/rest";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("REST", () => {
    test("returns JSON responses", async () => {
        globalThis.fetch = mock(async () => new Response(JSON.stringify({ id: "1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        }));

        const rest = new REST({ baseURL: "https://example.test" });
        await expect(rest.get("/users/@me")).resolves.toEqual({ id: "1" });
    });

    test("throws AuthenticationError for 401", async () => {
        globalThis.fetch = mock(async () => new Response(JSON.stringify({ message: "401: Unauthorized", code: 0 }), {
            status: 401,
            headers: { "Content-Type": "application/json" }
        }));

        const rest = new REST({ baseURL: "https://example.test", retries: 0 });
        await expect(rest.get("/users/@me")).rejects.toBeInstanceOf(AuthenticationError);
    });

    test("retries a 429 and returns the next response", async () => {
        let calls = 0;
        globalThis.fetch = mock(async () => {
            calls++;
            if (calls === 1) {
                return new Response(JSON.stringify({ retry_after: 0, global: false }), {
                    status: 429,
                    headers: { "Content-Type": "application/json", "Retry-After": "0" }
                });
            }
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        });

        const rest = new REST({ baseURL: "https://example.test", retries: 1 });
        await expect(rest.get("/users/@me")).resolves.toEqual({ ok: true });
        expect(calls).toBe(2);
    });

    test("throws RateLimitError when retries are exhausted", async () => {
        globalThis.fetch = mock(async () => new Response(JSON.stringify({ retry_after: 0.01, global: true }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": "0.01" }
        }));

        const rest = new REST({ baseURL: "https://example.test", retries: 0 });
        await expect(rest.get("/users/@me")).rejects.toBeInstanceOf(RateLimitError);
    });

    test("honors an aborted request", async () => {
        const controller = new AbortController();
        controller.abort(new Error("cancelled"));
        const rest = new REST({ baseURL: "https://example.test" });
        await expect(rest.get("/users/@me", { signal: controller.signal })).rejects.toThrow("cancelled");
    });
});
