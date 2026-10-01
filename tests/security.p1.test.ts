import { describe, expect, test } from "bun:test";
import {
    HttpTransport,
    REST,
    Routes,
    createRouteKey,
    redactPath,
} from "../packages/rest/src/index.ts";
import { ChannelManager, UserManager } from "../packages/managers/src/index.ts";
import { Client } from "../packages/core/src/index.ts";
import { GatewaySession } from "../packages/ws/src/session.ts";

// Security report for 0.2.3, findings H1-H3 (fixed in 0.2.4).

function recordingRest() {
    const urls: string[] = [];
    const paths: string[] = [];
    const rest = new REST({
        token: "BOTTOKEN",
        retries: 0,
        transport: new HttpTransport({
            fetch: async (url) => {
                urls.push(String(url));
                return new Response("{}", {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        }),
    });
    rest.setHooks({ onRequest: (event) => void paths.push(event.path) });
    return { rest, urls, paths };
}

describe("H1: a path cannot be rewritten into another route", () => {
    test("dot segments, encoded dots and backslashes are refused before any request", async () => {
        const { rest, urls } = recordingRest();
        for (const path of [
            "/users/@me/guilds/../../../channels/999/messages/888",
            "/users/@me/guilds/%2e%2e/%2e%2e/channels/5",
            "/users/@me/guilds/%2E%2E/channels/5",
            "/channels/1/./messages",
            "/channels/1\\..\\2",
        ])
            await expect(rest.get(path)).rejects.toThrow(TypeError);
        expect(urls).toEqual([]);
        // Dots inside a segment, and in the query string, are fine.
        await rest.get("/guilds/1/members/search?query=..a.b");
        expect(urls).toHaveLength(1);
    });

    test("public methods validate ids instead of interpolating them", async () => {
        const { rest, urls } = recordingRest();
        await expect(
            new UserManager(rest).leaveGuild("../../../channels/5"),
        ).rejects.toThrow(TypeError);
        await expect(
            new ChannelManager(rest).removeReaction(
                "100000000000000001",
                "100000000000000002",
                "👍",
                "../../../../channels/5",
            ),
        ).rejects.toThrow(TypeError);
        const client = new Client({ token: "t", intents: 0 });
        (client as unknown as { rest: REST }).rest = rest;
        await expect(client.fetchGuildPreview("../x")).rejects.toThrow(
            TypeError,
        );
        await expect(client.fetchSticker("../x")).rejects.toThrow(TypeError);
        await expect(client.fetchWebhook("../x")).rejects.toThrow(TypeError);
        expect(urls).toEqual([]);
    });

    test("tokens are encoded, so a '/' in a token cannot split the path", async () => {
        expect(Routes.webhook("1", "a/../../b")).toBe(
            "/webhooks/1/a%2F..%2F..%2Fb",
        );
        const { rest, urls } = recordingRest();
        const client = new Client({ token: "t", intents: 0 });
        (client as unknown as { rest: REST }).rest = rest;
        await client.fetchWebhook("1", "tok/en");
        expect(urls[0]).toEndWith("/webhooks/1/tok%2Fen");
    });
});

describe("H2: tokens never reach rate-limit keys, errors or hooks", () => {
    test("route keys hold no webhook or interaction token", () => {
        for (const path of [
            "/webhooks/123/super-secret-token",
            "/Webhooks/123/super-secret-token",
            "/interactions/123/interact.token.secret/callback",
            "/INTERACTIONS/123/interact.token.secret/callback",
        ]) {
            const key = createRouteKey("POST", path);
            expect(`${key.route} ${key.major}`).not.toContain("secret");
        }
    });

    test("redaction ignores case, so hooks never see the token", async () => {
        expect(redactPath("/Webhooks/123/super-secret-token?x=1")).toBe(
            "/Webhooks/123/:token?x=1",
        );
        const { rest, paths } = recordingRest();
        await rest.get("/Webhooks/123/super-secret-token?x=1");
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(paths.join(" ")).not.toContain("super-secret-token");
    });
});

describe("H3: the resume host must be Discord's", () => {
    const resumeTo = (url: string) => {
        const session = new GatewaySession();
        const token = session.beginConnection();
        session.activate({ session_id: "s", resume_gateway_url: url }, token);
        session.recordSequence(1, token);
        return session.connectURL("wss://gateway.discord.gg/?v=10");
    };

    test("untrusted resume URLs fall back to the default gateway", () => {
        for (const url of [
            "http://169.254.169.254/latest/meta-data",
            "ws://gateway-us-east1-b.discord.gg",
            "wss://evil.example",
            "wss://discord.gg.evil.example",
            "wss://user:pass@gateway-us-east1-b.discord.gg",
            "not a url",
        ])
            expect(resumeTo(url)).toBe("wss://gateway.discord.gg/?v=10");
    });

    test("Discord's resume hosts and the fallback's host are used", () => {
        expect(resumeTo("wss://gateway-us-east1-b.discord.gg")).toBe(
            "wss://gateway-us-east1-b.discord.gg",
        );
        expect(resumeTo("wss://GATEWAY.discord.gg/?v=10")).toBe(
            "wss://GATEWAY.discord.gg/?v=10",
        );
    });
});
