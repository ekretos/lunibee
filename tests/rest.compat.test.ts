import { afterEach, describe, expect, test } from "bun:test";
import {
    REST,
    RESTError,
    type RESTFileAttachment,
} from "../packages/rest/src/index.ts";
import { fakeFetch } from "./helpers/fetch.ts";

/** Captured shape of a single intercepted `fetch` call. */
interface CapturedRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}

const original = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = original;
});

/**
 * Installs a `fetch` stub that records every request and returns `response`.
 * @returns The mutable array of captured requests.
 */
function captureFetch(
    response: () => Response = () =>
        new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
        }),
): CapturedRequest[] {
    const calls: CapturedRequest[] = [];
    globalThis.fetch = fakeFetch(async (url: string, init: RequestInit) => {
        const headers = Object.fromEntries(new Headers(init.headers).entries());
        calls.push({
            url: String(url),
            method: String(init.method),
            headers,
            body: init.body,
        });
        return response();
    });
    return calls;
}

describe("REST — RESTError", () => {
    test("a rejected request throws a RESTError", async () => {
        captureFetch(
            () =>
                new Response(
                    JSON.stringify({ message: "Missing Access", code: 50001 }),
                    {
                        status: 403,
                        headers: { "content-type": "application/json" },
                    },
                ),
        );
        const rest = new REST({ token: "t", retries: 0 });
        await expect(rest.get("/users/@me")).rejects.toBeInstanceOf(RESTError);
        try {
            await rest.get("/users/@me");
        } catch (error) {
            expect(error).toBeInstanceOf(RESTError);
            expect((error as RESTError).status).toBe(403);
            expect((error as RESTError).code).toBe(50001);
        }
    });
});

describe("REST — positional body", () => {
    test("post(path, body) sends the body as JSON", async () => {
        const calls = captureFetch();
        const rest = new REST({ token: "t" });
        await rest.post("/channels/1/messages", { content: "hi" });
        expect(JSON.parse(calls[0]!.body as string)).toEqual({ content: "hi" });
        expect(calls[0]!.headers["content-type"]).toBe("application/json");
    });

    test("the removed { body } form is refused; other bodies are sent verbatim", async () => {
        const calls = captureFetch();
        const rest = new REST({ token: "t" });
        for (const call of [
            () =>
                rest.post("/channels/1/messages", { body: { content: "hi" } }),
            () =>
                rest.patch("/channels/1/messages/2", { body: {}, reason: "x" }),
            () => rest.put("/x", { files: [] }),
        ])
            await expect(call()).rejects.toThrow(
                /was removed in 0\.4\.0: call rest\.(post|patch|put)\(path, body, options\)/,
            );
        await rest.put("/guilds/1/members/2/roles/3", { reason: "x" });
        await rest.patch("/channels/1/messages/2", {
            content: "edit",
            body: "kept",
        });
        expect(calls).toHaveLength(2);
        expect(JSON.parse(calls[0]!.body as string)).toEqual({ reason: "x" });
        expect(calls[0]!.headers["x-audit-log-reason"]).toBeUndefined();
        expect(JSON.parse(calls[1]!.body as string)).toEqual({
            content: "edit",
            body: "kept",
        });
    });

    test("options go in the third argument", async () => {
        const calls = captureFetch();
        const rest = new REST({ token: "t" });
        await rest.put("/guilds/1/members/2/roles/3", undefined, {
            reason: "x",
        });
        expect(calls[0]!.body).toBeUndefined();
        expect(calls[0]!.headers["x-audit-log-reason"]).toBe("x");
    });
});

describe("REST — per-request options (query / headers / reason / auth)", () => {
    test("query option is appended to the request URL", async () => {
        const calls = captureFetch();
        const rest = new REST({ token: "t" });
        await rest.get("/channels/1/messages", {
            query: { limit: 5, before: "100", skip: undefined },
        });
        expect(calls[0]!.url).toContain("/channels/1/messages?");
        expect(calls[0]!.url).toContain("limit=5");
        expect(calls[0]!.url).toContain("before=100");
        expect(calls[0]!.url).not.toContain("skip");
    });

    test("reason option is sent as an encoded X-Audit-Log-Reason header", async () => {
        const calls = captureFetch();
        const rest = new REST({ token: "t" });
        await rest.delete("/guilds/1/bans/2", { reason: "spam & raids" });
        expect(calls[0]!.headers["x-audit-log-reason"]).toBe(
            "spam%20%26%20raids",
        );
    });

    test("auth:false omits the Authorization header", async () => {
        const calls = captureFetch();
        const rest = new REST({ token: "t" });
        await rest.get("/gateway", { auth: false });
        expect(calls[0]!.headers["authorization"]).toBeUndefined();
    });

    test("custom headers merge, but library Authorization wins", async () => {
        const calls = captureFetch();
        const rest = new REST({ token: "secret" });
        await rest.get("/users/@me", {
            headers: { "X-Custom": "yes", Authorization: "Bearer nope" },
        });
        expect(calls[0]!.headers["x-custom"]).toBe("yes");
        expect(calls[0]!.headers["authorization"]).toBe("Bot secret");
    });
});

describe("REST — multipart via options.files", () => {
    test("files in options upgrade the request to multipart/form-data", async () => {
        const calls = captureFetch();
        const rest = new REST({ token: "t" });
        const files: RESTFileAttachment[] = [
            { name: "a.txt", data: new Uint8Array([1, 2, 3]) },
        ];
        await rest.post(
            "/channels/1/messages",
            { content: "with file" },
            { files },
        );
        expect(calls[0]!.body).toBeInstanceOf(FormData);
        // multipart requests must NOT force application/json.
        expect(calls[0]!.headers["content-type"]).not.toBe("application/json");
        const form = calls[0]!.body as FormData;
        expect(JSON.parse(form.get("payload_json") as string)).toEqual({
            content: "with file",
        });
        expect(form.get("files[0]")).toBeInstanceOf(Blob);
    });
});

describe("REST — rate-limit bookkeeping", () => {
    test("onRateLimit hook fires with the global flag on a global 429", async () => {
        let seenGlobal: boolean | undefined;
        globalThis.fetch = fakeFetch(
            async () =>
                new Response(
                    JSON.stringify({
                        message: "Too Many Requests",
                        retry_after: 0.01,
                        global: true,
                    }),
                    {
                        status: 429,
                        headers: {
                            "content-type": "application/json",
                            "x-ratelimit-global": "true",
                            "retry-after": "0.01",
                        },
                    },
                ),
        );
        const rest = new REST({
            token: "t",
            retries: 0,
            hooks: {
                onRateLimit: (ctx) => {
                    seenGlobal = ctx.global;
                },
            },
        });
        await expect(rest.get("/users/@me")).rejects.toThrow(RESTError);
        expect(seenGlobal).toBe(true);
    });

    test("server X-RateLimit-Bucket hash is adopted for the normalized route", async () => {
        const calls = captureFetch(
            () =>
                new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: {
                        "content-type": "application/json",
                        "x-ratelimit-bucket": "abc123",
                        "x-ratelimit-remaining": "5",
                        "x-ratelimit-reset-after": "1",
                    },
                }),
        );
        const rest = new REST({ token: "t" });
        // Two calls on the same normalized route share the discovered bucket.
        await rest.get("/channels/1/messages/2");
        await rest.get("/channels/9/messages/8");
        expect(calls).toHaveLength(2);
    });
});
