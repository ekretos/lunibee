import { describe, expect, test } from "bun:test";
import { WebhookClient } from "../packages/rest/src/webhook.ts";
import { fakeFetch } from "./helpers/fetch.ts";

describe("WebhookClient Coverage", () => {
    test("instantiates with URL or id/token", () => {
        const clientFromUrl = new WebhookClient({
            url: "https://discord.com/api/webhooks/1234567890/token_abc",
        });
        expect(clientFromUrl.id).toBe("1234567890");
        expect(clientFromUrl.token).toBe("token_abc");

        const clientFromIdToken = new WebhookClient({
            id: "98765",
            token: "tok_xyz",
        });
        expect(clientFromIdToken.id).toBe("98765");
        expect(clientFromIdToken.token).toBe("tok_xyz");

        expect(() => new WebhookClient({})).toThrow(
            "WebhookClient requires either",
        );
        expect(() => new WebhookClient({ url: "https://invalid.com" })).toThrow(
            "Invalid Discord webhook URL",
        );
    });

    test("sends, edits, and deletes webhook messages", async () => {
        const original = globalThis.fetch;
        const client = new WebhookClient({
            id: "123456789012345678",
            token: "secret",
        });

        globalThis.fetch = fakeFetch(async (url: string, opts: RequestInit) => {
            if (opts.method === "POST") {
                return new Response(
                    JSON.stringify({
                        id: "123456789012345678",
                        content: "hello",
                    }),
                    {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    },
                );
            }
            if (opts.method === "PATCH") {
                return new Response(
                    JSON.stringify({
                        id: "123456789012345678",
                        content: "edited",
                    }),
                    {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    },
                );
            }
            if (opts.method === "DELETE") {
                return new Response(null, { status: 204 });
            }
            return new Response(null, { status: 404 });
        });

        try {
            const sent = await client.send("hello");
            expect(sent.content).toBe("hello");

            const sentWithEmbed = await client.send({
                content: "with embed",
                embeds: [{ title: "Title" }],
                thread_id: "thread_1",
            });
            expect(sentWithEmbed).toBeDefined();

            const edited = await client.editMessage("123456789012345678", {
                content: "edited",
            });
            expect(edited.content).toBe("edited");

            await client.deleteMessage("123456789012345678");
        } finally {
            globalThis.fetch = original;
        }
    });

    test("uploads files as multipart and serializes component builders", async () => {
        const original = globalThis.fetch;
        let body: RequestInit["body"];
        globalThis.fetch = fakeFetch((_url, init) => {
            body = init.body;
            return new Response(JSON.stringify({ id: "1", content: "" }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        });
        try {
            const client = new WebhookClient({ id: "1", token: "t" });
            await client.send({
                content: "file",
                files: [{ name: "a.txt", data: new TextEncoder().encode("a") }],
                components: [{ toJSON: () => ({ type: 1, components: [] }) }],
            });
            expect(body).toBeInstanceOf(FormData);
            const form = body as FormData;
            expect(form.get("files[0]")).toBeInstanceOf(Blob);
            const payload = JSON.parse(String(form.get("payload_json")));
            expect(payload.files).toBeUndefined();
            expect(payload.components).toEqual([{ type: 1, components: [] }]);
        } finally {
            globalThis.fetch = original;
        }
    });
});

describe("REST gaps closed", () => {
    const original = globalThis.fetch;
    const seen: { url: string; init: RequestInit }[] = [];
    const install = () => {
        seen.length = 0;
        globalThis.fetch = fakeFetch(async (url, init) => {
            seen.push({ url, init });
            return new Response("{}", {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        });
    };

    test("webhook send takes the wire names", async () => {
        install();
        try {
            await new WebhookClient({ id: "1", token: "t" }).send({
                content: "hi",
                avatar_url: "https://a.test/a.png",
                thread_id: "77",
                allowed_mentions: { parse: [] },
            });
            expect(seen[0]!.url).toContain("thread_id=77");
            const body = JSON.parse(String(seen[0]!.init.body));
            expect(body).toMatchObject({
                avatar_url: "https://a.test/a.png",
                allowed_mentions: { parse: [] },
            });
            expect(body).not.toHaveProperty("thread_id");
        } finally {
            globalThis.fetch = original;
        }
    });

    test("request() takes method, path, body and options", async () => {
        install();
        try {
            const { REST } = await import("../packages/rest/src/index.ts");
            const rest = new REST({ token: "a.b.c-token-0123456789" });
            await rest.request(
                "POST",
                "/channels/1/messages",
                { content: "x" },
                { query: new URLSearchParams({ a: "1" }) },
            );
            await rest.request("GET", "/users/@me");
            expect(seen[0]!.url).toContain("/channels/1/messages?a=1");
            expect(seen[0]!.init.method).toBe("POST");
            expect(String(seen[0]!.init.body)).toContain('"content":"x"');
            expect(seen[1]!.url).toContain("/users/@me");
            // The removed single-object form is refused.
            const legacy = rest.request.bind(rest) as unknown as (
                options: unknown,
            ) => Promise<unknown>;
            await expect(
                legacy({ method: "GET", path: "/users/@me" }),
            ).rejects.toThrow(TypeError);
            await expect(
                rest.request("GET", undefined as never),
            ).rejects.toThrow(TypeError);
        } finally {
            globalThis.fetch = original;
        }
    });
});

describe("webhook messages in threads", () => {
    test("edit, fetch and delete carry thread_id, and edit takes components", async () => {
        const original = globalThis.fetch;
        const urls: string[] = [];
        globalThis.fetch = fakeFetch(async (url, init) => {
            urls.push(`${init.method} ${url}`);
            return new Response("{}", {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        });
        try {
            const client = new WebhookClient({ id: "1", token: "t" });
            await client.editMessage("9", {
                content: "x",
                thread_id: "77",
                components: [],
            });
            await client.fetchMessage("9", { threadId: "77" });
            await client.deleteMessage("9", { threadId: "77" });
            expect(urls).toHaveLength(3);
            for (const line of urls) expect(line).toContain("thread_id=77");
            expect(urls[0]).toStartWith("PATCH ");
        } finally {
            globalThis.fetch = original;
        }
    });
});
