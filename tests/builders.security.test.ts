import { describe, expect, test } from "bun:test";
import { CreateEmbed } from "../packages/builders/src/index.ts";
import { link } from "../packages/formatters/src/index.ts";
import { parsePrefixArgs } from "../packages/utils/src/index.ts";

describe("embed size", () => {
    test("the text of an embed adds up to at most 6000 characters", () => {
        const embed = new CreateEmbed()
            .setTitle("t".repeat(256))
            .setDescription("d".repeat(4000))
            .addFields(
                { name: "n", value: "v".repeat(870) },
                { name: "m", value: "v".repeat(870) },
            );
        // 256 + 4000 + 2 * (1 + 870) = 5998
        expect(() => embed.toJSON()).not.toThrow();
        embed.setFooter({ text: "f".repeat(3) });
        expect(() => embed.toJSON()).toThrow(
            /6000 characters in total \(this one has 6001\)/,
        );
        expect(() => embed.data).toThrow(RangeError);
    });

    test("every counted part is counted", () => {
        const big = (embed: CreateEmbed) =>
            expect(() => embed.toJSON()).toThrow(/6000/);
        big(
            new CreateEmbed()
                .setDescription("d".repeat(4096))
                .addFields(
                    { name: "n", value: "v".repeat(1024) },
                    { name: "m", value: "v".repeat(900) },
                ),
        );
        big(
            new CreateEmbed()
                .setDescription("d".repeat(4096))
                .setFooter({ text: "f".repeat(2048) }),
        );
        big(
            new CreateEmbed()
                .setDescription("d".repeat(4096))
                .setAuthor({ name: "a".repeat(256) })
                .setTitle("t".repeat(256))
                .setFooter({ text: "f".repeat(1500) }),
        );
    });

    test("an embed under the limit serializes as before", () => {
        const json = new CreateEmbed()
            .setTitle("hello")
            .setDescription("world")
            .toJSON();
        expect(json).toEqual({ title: "hello", description: "world" });
    });
});

describe("audit F-E/F-F", () => {
    test("spliceFields validates like addFields", () => {
        const embed = new CreateEmbed();
        expect(() =>
            embed.spliceFields(0, 0, { name: "x".repeat(300), value: "v" }),
        ).toThrow();
        expect(() =>
            embed.spliceFields(0, 0, { name: "", value: "v" }),
        ).toThrow();
    });

    test("link() title cannot close the link", () => {
        expect(
            link("a", "https://x.test", 'T") [evil](https://e.test'),
        ).not.toContain(") [evil]");
    });

    test("a prefix option named __proto__ is kept as a plain value", () => {
        const r = parsePrefixArgs("hello", [
            { name: "__proto__", type: "string", required: true },
        ] as never);
        expect(r.ok && Object.keys(r.values)).toEqual(["__proto__"]);
        expect(r.ok && r.values["__proto__"]).toBe("hello");
    });
});
