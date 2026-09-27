import { describe, expect, test } from "bun:test";
import { GatewaySession } from "../packages/ws/src/index.ts";
import { REST, RESTError, redactPath } from "../packages/rest/src/index.ts";

describe("Gateway sequence", () => {
    test("a stale lower sequence cannot roll back the resume point", () => {
        const session = new GatewaySession();
        const token = session.beginConnection();
        expect(session.recordSequence(10, token)).toBe(true);
        expect(session.recordSequence(4, token)).toBe(false);
        expect(session.recordSequence(10, token)).toBe(true);
        expect(session.sequence).toBe(10);
        session.invalidate(token);
        expect(session.recordSequence(1, token)).toBe(true);
        expect(session.sequence).toBe(1);
    });
});

describe("token redaction", () => {
    test("webhook and interaction tokens never reach errors or hooks", async () => {
        expect(
            redactPath("/webhooks/123/secret-token/messages/@original"),
        ).toBe("/webhooks/123/:token/messages/@original");
        expect(redactPath("/interactions/1/tok/callback")).toBe(
            "/interactions/1/:token/callback",
        );
        expect(redactPath("/webhooks/123")).toBe("/webhooks/123");
        expect(redactPath("/channels/1/messages")).toBe("/channels/1/messages");
        expect(
            new RESTError("x", 404, undefined, undefined, {
                path: "/webhooks/1/abc?wait=true",
            }).path,
        ).toBe("/webhooks/1/:token?wait=true");

        const seen: string[] = [];
        const rest = new REST({
            token: "t",
            hooks: { onRequest: ({ path }) => seen.push(path) },
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(
                JSON.stringify({ message: "Unknown Webhook", code: 10015 }),
                {
                    status: 404,
                    headers: { "Content-Type": "application/json" },
                },
            )) as never;
        try {
            const error = await rest
                .get("/webhooks/1/super-secret")
                .catch((e: unknown) => e as RESTError);
            expect((error as RESTError).path).toBe("/webhooks/1/:token");
            expect(JSON.stringify(error)).not.toContain("super-secret");
        } finally {
            globalThis.fetch = originalFetch;
        }
        await Bun.sleep(1);
        expect(seen).toEqual(["/webhooks/1/:token"]);
    });
});
