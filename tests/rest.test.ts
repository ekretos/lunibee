import { describe, expect, test } from "bun:test";
import { REST, RESTError } from "../packages/rest/src/index.ts";

test("REST returns JSON responses", async () => {
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () =>
    new Response(JSON.stringify({ id: "1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  try {
    const rest = new REST({ token: "token" });
    expect(await rest.get<{ id: string }>("/users/@me")).toEqual({ id: "1" });
  } finally {
    globalThis.fetch = original;
  }
});

test("REST retries idempotent server errors", async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  (globalThis as any).fetch = async () => {
    attempts++;
    if (attempts === 1)
      return new Response(JSON.stringify({ message: "busy" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const rest = new REST({ token: "token", retries: 1 });
    expect(await rest.get<{ ok: boolean }>("/users/@me")).toEqual({ ok: true });
    expect(attempts).toBe(2);
  } finally {
    globalThis.fetch = original;
  }
});

test("REST exposes rate-limit errors", async () => {
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () =>
    new Response(
      JSON.stringify({ message: "Too Many Requests", retry_after: 0.1 }),
      {
        status: 429,
        headers: { "content-type": "application/json" },
      },
    );
  try {
    const rest = new REST({ token: "token", retries: 0 });
    await expect(rest.get("/users/@me")).rejects.toThrow(RESTError);
  } finally {
    globalThis.fetch = original;
  }
});

test("REST cancels queued request waiting on rate limit", async () => {
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () =>
    new Response(
      JSON.stringify({ message: "Too Many Requests", retry_after: 2 }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset-after": "2",
        },
      },
    );
  try {
    const rest = new REST({ token: "token", retries: 0 });
    await expect(rest.get("/channels/123/messages")).rejects.toThrow();

    const controller = new AbortController();
    const abortPromise = rest.get("/channels/123/messages", {
      signal: controller.signal,
    });
    setTimeout(
      () => controller.abort(new Error("aborted during rate limit")),
      10,
    );
    await expect(abortPromise).rejects.toThrow();
  } finally {
    globalThis.fetch = original;
  }
});
