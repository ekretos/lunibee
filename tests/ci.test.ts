import { expect, test } from "bun:test";

test("Bun test runner is available", () => {
    expect(typeof Bun).toBe("object");
});
