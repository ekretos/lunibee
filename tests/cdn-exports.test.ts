import { expect, test } from "bun:test";
import * as structures from "../packages/structures/src/index.ts";
import * as lunibee from "../packages/lunibee/src/index.ts";

test("CDN helpers are exported from @lunibee/structures and lunibee", () => {
    for (const source of [structures, lunibee]) {
        expect(source.CDN_BASE).toBe("https://cdn.discordapp.com");
        expect(typeof source.cdnURL).toBe("function");
    }
});

test("cdnURL builds static, animated and sized URLs", () => {
    const { cdnURL } = lunibee;
    expect(cdnURL("/icons/1", "abc")).toBe(
        "https://cdn.discordapp.com/icons/1/abc.png",
    );
    expect(cdnURL("/icons/1", "a_abc")).toBe(
        "https://cdn.discordapp.com/icons/1/a_abc.gif",
    );
    expect(
        cdnURL("/icons/1", "a_abc", {
            forceStatic: true,
            extension: "webp",
            size: 256,
        }),
    ).toBe("https://cdn.discordapp.com/icons/1/a_abc.webp?size=256");
    const options: lunibee.ImageURLOptions = { size: 64 };
    expect(cdnURL("/avatars/2", "h", options)).toBe(
        "https://cdn.discordapp.com/avatars/2/h.png?size=64",
    );
});
