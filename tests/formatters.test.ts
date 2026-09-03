import { describe, expect, test } from "bun:test";
import {
    userMention,
    channelMention,
    roleMention,
    timestamp,
    escapeMarkdown,
} from "../packages/formatters/src/index.ts";

describe("Formatters", () => {
    test("userMention formats valid snowflake and rejects invalid", () => {
        expect(userMention("123456789012345678")).toBe("<@123456789012345678>");
        expect(() => userMention("abc")).toThrow(TypeError);
        expect(() => userMention("")).toThrow(TypeError);
    });

    test("channelMention formats valid snowflake and rejects invalid", () => {
        expect(channelMention("123456789012345678")).toBe(
            "<#123456789012345678>",
        );
        expect(() => channelMention("invalid")).toThrow(TypeError);
    });

    test("roleMention formats valid snowflake and rejects invalid", () => {
        expect(roleMention("123456789012345678")).toBe(
            "<@&123456789012345678>",
        );
        expect(() => roleMention("bad-id")).toThrow(TypeError);
    });

    test("timestamp formats unix timestamp with and without style", () => {
        const unix = 1620000000;
        expect(timestamp(unix)).toBe("<t:1620000000>");
        expect(timestamp(unix, "R")).toBe("<t:1620000000:R>");
        expect(timestamp(unix, "d")).toBe("<t:1620000000:d>");
        expect(timestamp(unix, "F")).toBe("<t:1620000000:F>");
        expect(() => timestamp(NaN)).toThrow(TypeError);
        expect(() => timestamp(unix, "invalid")).toThrow(RangeError);
    });

    test("escapeMarkdown escapes markdown control characters", () => {
        expect(
            escapeMarkdown(
                "*bold* _italic_ `code` ~strike~ |spoiler| >quote \\escape",
            ),
        ).toBe(
            "\\*bold\\* \\_italic\\_ \\`code\\` \\~strike\\~ \\|spoiler\\| \\>quote \\\\escape",
        );
        expect(escapeMarkdown("plain text")).toBe("plain text");
    });
});
