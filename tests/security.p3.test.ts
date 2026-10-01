import { describe, expect, test } from "bun:test";
import { WebhookClient } from "../packages/rest/src/index.ts";
import { cdnURL } from "../packages/structures/src/index.ts";
import { codeBlock, link } from "../packages/formatters/src/index.ts";
import { Client, ClientEvent } from "../packages/core/src/index.ts";

// Security report for 0.2.3, findings L1, L2, L3, L5 and L7 (fixed in 0.2.4).
// L4 (login returns the token) and L6 (ShardBus) are documented, accepted risks.

describe("L1: webhook URLs must be Discord's", () => {
    test("look-alike hosts and embedded URLs are refused", () => {
        for (const url of [
            "https://notdiscord.com/api/webhooks/1/tok",
            "https://evil.example/?q=discord.com/api/webhooks/9/embedded",
            "http://discord.com/api/webhooks/1/tok",
            "https://discord.com.evil.example/api/webhooks/1/tok",
        ])
            expect(() => new WebhookClient({ url })).toThrow();
    });

    test("Discord's webhook URLs are accepted", () => {
        for (const url of [
            "https://discord.com/api/webhooks/123/abc-DEF_9",
            "https://canary.discord.com/api/v10/webhooks/123/abc",
            "https://discordapp.com/api/webhooks/123/abc?thread_id=1",
        ]) {
            const client = new WebhookClient({ url });
            expect(client.id).toBe("123");
        }
    });
});

test("L2: thread_id cannot inject query parameters", async () => {
    const urls: string[] = [];
    const client = new WebhookClient({ id: "1", token: "tok" });
    // WebhookClient makes its own REST instance, so fetch is swapped globally.
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
        urls.push(String(url));
        return new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    }) as typeof fetch;
    try {
        await client.send({ content: "hi", thread_id: "1&wait=false" });
    } finally {
        globalThis.fetch = original;
    }
    const query = new URL(urls[0]!).searchParams;
    expect(query.getAll("wait")).toEqual(["true"]);
    expect(query.get("thread_id")).toBe("1&wait=false");
});

test("L3: an asset hash cannot change the CDN path", () => {
    const url = new URL(cdnURL("/avatars/1", "../../evil?x=1#y"));
    expect(url.pathname.startsWith("/avatars/1/")).toBe(true);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
    expect(cdnURL("/avatars/1", "a_abc123")).toBe(
        "https://cdn.discordapp.com/avatars/1/a_abc123.gif",
    );
});

test("L5: an unhandled listener error never prints the bot token", async () => {
    const token = "MTIz.secret-bot-token.abc";
    const warnings: string[] = [];
    const original = process.emitWarning;
    process.emitWarning = ((warning: string, options?: { detail?: string }) => {
        warnings.push(`${warning}\n${options?.detail ?? ""}`);
    }) as typeof process.emitWarning;
    try {
        class TestClient extends Client {
            public fire(): void {
                (this.emit as (e: string, ...a: unknown[]) => boolean)(
                    ClientEvent.Raw,
                    {},
                );
            }
        }
        const bot = new TestClient({ token, intents: 0 });
        bot.on(ClientEvent.Raw, () => {
            throw new Error(`request failed for Bot ${token}`);
        });
        bot.fire();
        await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
        process.emitWarning = original;
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Bot [token]");
    expect(warnings[0]).not.toContain(token);
});

describe("L7: formatter output cannot break out of its markup", () => {
    test("link escapes the label and encodes the URL", () => {
        expect(link("a](https://evil) [b", "https://x")).toBe(
            "[a\\](https://evil) \\[b](https://x)",
        );
        expect(link("ok", "https://x.com/a (1)")).toBe(
            "[ok](https://x.com/a%20%281%29)",
        );
    });

    test("codeBlock text cannot close the block", () => {
        const block = codeBlock("x```\n@everyone```", "js\n@here");
        expect(block.startsWith("```js")).toBe(true);
        expect(block.match(/```/g)).toHaveLength(2);
    });
});
