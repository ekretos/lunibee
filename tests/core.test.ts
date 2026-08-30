import { describe, expect, test } from "bun:test";
import { HandlerRegistry } from "../packages/handlers/src/index.ts";

describe("HandlerRegistry", () => {
  test("dispatches registered handlers", async () => {
    const registry = new HandlerRegistry<{ ready: string }>();
    let value = "";
    registry.on("ready", (payload) => {
      value = payload;
    });
    await registry.dispatch("ready", "ok");
    expect(value).toBe("ok");
  });

  test("removes handlers", async () => {
    const registry = new HandlerRegistry<{ ready: string }>();
    let calls = 0;
    const handler = () => {
      calls++;
    };
    registry.on("ready", handler);
    registry.off("ready", handler);
    await registry.dispatch("ready", "ok");
    expect(calls).toBe(0);
  });
});
