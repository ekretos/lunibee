import { describe, expect, test } from "bun:test";
import { HandlerRegistry } from "../packages/handlers/src/index.ts";

describe("HandlerRegistry Coverage", () => {
  test("registers, emits, and removes handlers", async () => {
    const registry = new HandlerRegistry<{
      test: [string, number];
      single: [boolean];
    }>();
    let calls = 0;
    const cb = (s: string, n: number) => {
      calls++;
      expect(s).toBe("hello");
      expect(n).toBe(42);
    };

    registry.on("test", cb);
    await registry.emit("test", "hello", 42);
    expect(calls).toBe(1);

    registry.off("test", cb);
    await registry.emit("test", "hello", 42);
    expect(calls).toBe(1); // Should not increment

    let onceCalls = 0;
    registry.once("single", (b: boolean) => {
      onceCalls++;
      expect(b).toBe(true);
    });

    await registry.emit("single", true);
    expect(onceCalls).toBe(1);

    // Second emit should do nothing since it was a 'once' handler
    await registry.emit("single", true);
    expect(onceCalls).toBe(1);
  });
});
