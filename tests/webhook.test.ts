import { describe, expect, test } from "bun:test";
import { WebhookClient } from "../packages/rest/src/webhook.ts";

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

    (globalThis as any).fetch = async (url: string, opts: any) => {
      if (opts.method === "POST") {
        return new Response(
          JSON.stringify({ id: "123456789012345678", content: "hello" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (opts.method === "PATCH") {
        return new Response(
          JSON.stringify({ id: "123456789012345678", content: "edited" }),
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
    };

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
});
