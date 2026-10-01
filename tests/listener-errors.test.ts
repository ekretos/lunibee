import { afterEach, expect, test } from "bun:test";
import { Client, ClientEvent } from "../packages/core/src/index.ts";

// Errors thrown by listeners go to `error` listeners. When nothing handles them
// they become one process warning instead of disappearing.

class TestClient extends Client {
    public fire(event: string, ...args: unknown[]): boolean {
        return (this.emit as (e: string, ...a: unknown[]) => boolean)(
            event,
            ...args,
        );
    }
}

const warnings: string[] = [];
const original = process.emitWarning;
process.emitWarning = ((warning: string | Error) => {
    warnings.push(String(warning));
}) as typeof process.emitWarning;
afterEach(() => {
    warnings.length = 0;
});

function client() {
    return new TestClient({ token: "t", intents: 0 });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an error with no error listener becomes one warning", async () => {
    const bot = client();
    bot.on(ClientEvent.Raw, () => {
        throw new Error("boom");
    });
    bot.fire(ClientEvent.Raw, "x");
    await settle();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"raw" listener threw');
    expect(warnings[0]).toContain("boom");
});

test("an error listener receives listener errors (no warning)", async () => {
    const bot = client();
    const seen: string[] = [];
    bot.on(ClientEvent.Error, (error) => void seen.push(error.message));
    bot.on(ClientEvent.Raw, async () => {
        throw new Error("async boom");
    });
    bot.fire(ClientEvent.Raw, "x");
    await settle();
    expect(seen).toEqual(["async boom"]);
    expect(warnings).toEqual([]);
});

test("a throwing or rejecting error listener warns once and never loops", async () => {
    const bot = client();
    let calls = 0;
    bot.on(ClientEvent.Error, () => {
        calls++;
        throw new Error("error listener broke");
    });
    bot.on(ClientEvent.Error, async () => {
        calls++;
        throw new Error("async error listener broke");
    });
    bot.on(ClientEvent.Raw, () => {
        throw new Error("first");
    });
    bot.fire(ClientEvent.Raw, "x");
    await settle();
    expect(calls).toBe(2);
    expect(warnings).toHaveLength(2);
    expect(warnings.join("\n")).toContain("error listener broke");
    expect(warnings.join("\n")).toContain("async error listener broke");
});

test("restore process.emitWarning", () => {
    process.emitWarning = original;
    expect(process.emitWarning).toBe(original);
});
