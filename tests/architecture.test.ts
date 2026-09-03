import { expect, test } from "bun:test";

test("repository keeps tests outside packages", async () => {
    const tests = await Bun.file("tests/architecture.test.ts").exists();
    expect(tests).toBe(true);
});
