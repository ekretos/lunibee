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

describe("audit backlog batch", () => {
    test("timestamp rejects values that print in scientific notation", async () => {
        const { timestamp } =
            await import("../packages/formatters/src/index.ts");
        expect(() => timestamp(1e21)).toThrow(RangeError);
        expect(timestamp(5)).toBe("<t:5>");
    });

    test("HandlerRegistry runs every handler even when one fails", async () => {
        const { HandlerRegistry } =
            await import("../packages/handlers/src/index.ts");
        const registry = new HandlerRegistry<{ x: [number] }>();
        const seen: number[] = [];
        registry.on("x", () => {
            throw new Error("boom");
        });
        registry.on("x", (n: number) => void seen.push(n));
        await expect(registry.dispatch("x", 1)).rejects.toThrow("boom");
        expect(seen).toEqual([1]);
    });

    test("the CLI component kind guard ignores inherited names", async () => {
        const { binderSource } =
            await import("../packages/cli/src/handlers.ts");
        const src = binderSource([
            {
                event: "ready",
                file: "r",
                path: '../events/ready/x";evil//',
                importName: "h",
            },
        ] as never);
        expect(src).toContain('from "../events/ready/x\\";evil//"');
    });
});

describe("attachment root", () => {
    test("a missing root gives a clear error and a dotfile name is allowed", async () => {
        const { mkdtemp, writeFile } = await import("node:fs/promises");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const { CreateAttachment } =
            await import("../packages/builders/src/index.ts");
        await expect(
            new CreateAttachment("a.txt", {
                root: "/definitely/not/here",
            }).toBuffer(),
        ).rejects.toThrow(/root folder was not found/);
        const dir = await mkdtemp(join(tmpdir(), "lb-"));
        await writeFile(join(dir, "..dotfile"), "x");
        const outside = join(dir, "..", "lb-outside.txt");
        await writeFile(outside, "y");
        expect(
            (await new CreateAttachment("..dotfile", { root: dir }).toBuffer())
                .length,
        ).toBe(1);
        await expect(
            new CreateAttachment(outside, { root: dir }).toBuffer(),
        ).rejects.toThrow(/outside/);
    });
});
