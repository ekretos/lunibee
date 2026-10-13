import { describe, expect, test } from "bun:test";
import {
    RULES,
    kindsFor,
    mask,
    scanText,
    scanTree,
} from "../scripts/security-scan.ts";

// Fake secrets are assembled at run time so this file never contains one.
const fake = {
    discord: `${"MTA"}${"x".repeat(21)}.${"abcdef"}.${"y".repeat(27)}`,
    github: `${"ghp"}_${"A".repeat(36)}`,
    npm: `${"npm"}_${"b".repeat(36)}`,
    aws: `${"AKIA"}${"Q".repeat(16)}`,
    slack: `${"xoxb"}-${"1234567890"}-abc`,
    key: `-----BEGIN ${"RSA"} PRIVATE KEY-----`,
};

describe("security scan rules", () => {
    test("each secret rule finds its secret and hides it in the report", () => {
        for (const [name, secret] of Object.entries(fake)) {
            const found = scanText("a.ts", `const x = "${secret}";`, [
                "secret",
            ]);
            expect({ name, rules: found.map((f) => f.rule) }).toEqual({
                name,
                rules: [expect.stringMatching(/token|key/)],
            });
            expect(found[0]!.excerpt).not.toContain(secret);
            expect(found[0]).toMatchObject({ file: "a.ts", line: 1 });
        }
    });

    test("ordinary text and placeholders are not secrets", () => {
        const text = [
            "const token = process.env.DISCORD_TOKEN;",
            'new Client({ token: "a.b", intents: [] });',
            "Authorization: `Bot ${token}`",
            "https://discord.com/api/v10/gateway/bot",
        ].join("\n");
        expect(scanText("a.ts", text, ["secret", "api"])).toEqual([]);
    });

    test("risky APIs are found in package sources only when asked for", () => {
        const risky = [
            "eval(code);",
            "const f = new Function('return 1');",
            "execSync('ls');",
            "child_process.exec(cmd);",
            "{ rejectUnauthorized: false }",
            'const url = "http://api.example.org/x";',
        ];
        for (const line of risky)
            expect(scanText("p.ts", line, ["api"])).toHaveLength(1);
        expect(scanText("p.ts", risky.join("\n"), ["secret"])).toEqual([]);
    });

    test("regular expression exec(), local URLs and method calls are fine", () => {
        const fine = [
            "const m = pattern.exec(line);",
            "await db.exec(sql);",
            'const url = "http://localhost:3000";',
            'const url = "http://127.0.0.1:7070";',
            "const reviewed = Function.prototype;",
            "retrieval(x)",
        ];
        for (const line of fine)
            expect({ line, found: scanText("p.ts", line, ["api"]) }).toEqual({
                line,
                found: [],
            });
    });

    test("a reviewed exception needs a reason", () => {
        expect(
            scanText("p.ts", "eval(x); // security-ok: sandboxed test", [
                "api",
            ]),
        ).toEqual([]);
        expect(
            scanText("p.ts", "eval(x); // security-ok:", ["api"]),
        ).toHaveLength(1);
        expect(
            scanText("p.ts", "eval(x); // security-ok", ["api"]),
        ).toHaveLength(1);
    });

    test("which rules apply to which files", () => {
        expect(kindsFor("packages/rest/src/index.ts")).toEqual([
            "secret",
            "api",
        ]);
        expect(kindsFor("tests/a.test.ts")).toEqual(["secret"]);
        expect(kindsFor("README.md")).toEqual(["secret"]);
        expect(kindsFor("bun.lock")).toEqual([]);
        expect(kindsFor("node_modules/x/index.js")).toEqual([]);
        expect(kindsFor("logo.png")).toEqual([]);
        expect(kindsFor("lunibee.js.org/src/content/docs/api/a.md")).toEqual([
            "secret",
        ]);
    });

    test("long lines (data blobs) are skipped and masks keep the middle hidden", () => {
        expect(
            scanText("a.ts", `${fake.github} ${"z".repeat(5000)}`, ["secret"]),
        ).toEqual([]);
        expect(mask("short")).toBe("*****");
        expect(mask("abcdefghijklmnop")).toBe("abcd…****…op");
        expect(RULES.every((r) => r.id && r.description)).toBe(true);
    });

    test("the repository itself is clean", async () => {
        expect(await scanTree()).toEqual([]);
    });
});
