import { describe, expect, test } from "bun:test";
import { sleep, randomInt, isSnowflake } from "../packages/utils/src/index.ts";

describe("Utils", () => {
    test("sleep resolves after delay", async () => {
        const start = Date.now();
        await sleep(15);
        expect(Date.now() - start).toBeGreaterThanOrEqual(10);
    });

    test("randomInt generates number within inclusive bounds", () => {
        for (let i = 0; i < 50; i++) {
            const num = randomInt(5, 10);
            expect(num).toBeGreaterThanOrEqual(5);
            expect(num).toBeLessThanOrEqual(10);
            expect(Number.isInteger(num)).toBe(true);
        }
    });

    test("isSnowflake checks 16-22 digit numeric snowflakes", () => {
        expect(isSnowflake("123456789012345678")).toBe(true);
        expect(isSnowflake("1234567890123456")).toBe(true);
        expect(isSnowflake("1234567890123456789012")).toBe(true);
        expect(isSnowflake("12345")).toBe(false);
        expect(isSnowflake("abc")).toBe(false);
        expect(isSnowflake("")).toBe(false);
    });
});
