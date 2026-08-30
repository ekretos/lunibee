import { expect, test } from "bun:test";
import { REST, RESTError } from "../src/index.js";

test("REST returns JSON responses", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ id: "1" }), { status: 200 });
  try {
    const rest = new REST("token");
    expect(await rest.get<{ id: string }>("/users/@me")).toEqual({ id: "1" });
  } finally {
    globalThis.fetch = original;
  }
});

test("REST retries idempotent server errors", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls < 2)
      return new Response(JSON.stringify({ message: "busy" }), { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    const rest = new REST("token", { retries: 1 });
    expect(await rest.get<{ ok: boolean }>("/users/@me")).toEqual({ ok: true });
    expect(calls).toBe(2);
  } finally {
    globalThis.fetch = original;
  }
});

test("REST exposes rate-limit errors", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "slow down", code: 20028 }), {
      status: 429,
      headers: { "Retry-After": "0" },
    });
  try {
    const rest = new REST("token", { retries: 0 });
    await expect(rest.get("/users/@me")).rejects.toBeInstanceOf(RESTError);
  } finally {
    globalThis.fetch = original;
  }
});
