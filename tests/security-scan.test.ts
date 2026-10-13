import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    RULES,
    exceptionOn,
    kindsFor,
    main,
    mask,
    scanHistory,
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
    webhook: `https://discord.com/api/webhooks/${"1".repeat(18)}/${"a".repeat(60)}`,
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
                rules: [expect.stringMatching(/token|key|webhook/)],
            });
            expect(found[0]!.excerpt).not.toContain(secret);
            expect(found[0]).toMatchObject({ file: "a.ts", line: 1 });
        }
    });

    test("a Discord webhook URL is a secret", () => {
        const found = scanText("a.ts", fake.webhook, ["secret"]);
        expect(found.map((f) => f.rule)).toEqual(["discord-webhook"]);
        expect(found[0]!.excerpt).not.toContain("a".repeat(40));
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

    test("an exception names the rule, gives a reason, and sits in a comment", () => {
        const ok = (line: string, kinds: ("secret" | "api")[] = ["api"]) =>
            scanText("p.ts", line, kinds).map((f) => f.rule);
        expect(
            ok("eval(x); // security-ok(dynamic-code): sandboxed test"),
        ).toEqual([]);
        expect(ok("exec(x); # security-ok(shell-exec): fixed command")).toEqual(
            [],
        );
        expect(ok("eval(x); /* security-ok(dynamic-code): fixture */")).toEqual(
            [],
        );
        expect(
            ok(
                `k = "${fake.github}" <!-- security-ok(github-token): revoked docs example -->`,
                ["secret"],
            ),
        ).toEqual([]);
        expect(
            ok(
                "eval(x); // security-ok(dynamic-code, shell-exec): both reviewed",
            ),
        ).toEqual([]);
        // No reason, no rule, or a different rule: still reported.
        expect(ok("eval(x); // security-ok(dynamic-code):")).toEqual([
            "dynamic-code",
        ]);
        expect(ok("eval(x); // security-ok: reason only")).toEqual([
            "dynamic-code",
        ]);
        expect(ok("eval(x); // security-ok")).toEqual(["dynamic-code"]);
        expect(ok("eval(x); // security-ok(tls-off): wrong rule")).toEqual([
            "dynamic-code",
        ]);
    });

    test("an exception covers only the rule it names", () => {
        const line =
            "eval(code); exec(cmd); // security-ok(dynamic-code): reviewed";
        expect(scanText("p.ts", line, ["api"]).map((f) => f.rule)).toEqual([
            "shell-exec",
        ]);
    });

    test("marker text inside a string or beside a secret does not hide it", () => {
        const secret = (line: string) =>
            scanText("p.ts", line, ["secret"]).map((f) => f.rule);
        expect(
            secret(
                `const t = "${fake.github}"; const s = "// security-ok(github-token): fake";`,
            ),
        ).toEqual(["github-token"]);
        expect(
            secret(
                `const s = "// security-ok(github-token): fake"; const t = "${fake.github}";`,
            ),
        ).toEqual(["github-token"]);
        expect(
            secret(`x(); // security-ok(github-token): see ${fake.github}`),
        ).toEqual(["github-token"]);
        expect(
            secret(
                `${fake.github} is described by security-ok(github-token): reviewed`,
            ),
        ).toEqual(["github-token"]);
        expect(
            secret(
                `log("${fake.github}") // note: security-ok(github-token) is not a comment form`,
            ),
        ).toEqual(["github-token"]);
    });

    test("exceptionOn reads the rules and where the comment starts", () => {
        const found = exceptionOn("code(); // security-ok(a-b, c): why");
        expect(found?.rules).toEqual(new Set(["a-b", "c"]));
        expect(found?.start).toBe(8);
        expect(exceptionOn("no marker here")).toBeUndefined();
        expect(exceptionOn('s = "// security-ok(x): y";')).toBeUndefined();
    });

    test("which rules apply to which files", () => {
        expect(kindsFor("packages/rest/src/index.ts")).toEqual([
            "secret",
            "api",
        ]);
        expect(kindsFor("tests/a.test.ts")).toEqual(["secret"]);
        expect(kindsFor("README.md")).toEqual(["secret"]);
        for (const f of [
            "server.pem",
            "a/id.key",
            ".env.local",
            ".npmrc",
            "publish.bat",
        ])
            expect({ f, k: kindsFor(f) }).toEqual({ f, k: ["secret"] });
        expect(kindsFor("bun.lock")).toEqual([]);
        expect(kindsFor("node_modules/x/index.js")).toEqual([]);
        expect(kindsFor("logo.png")).toEqual([]);
        expect(kindsFor("lunibee.js.org/src/content/docs/api/a.md")).toEqual([
            "secret",
        ]);
    });

    test("a secret on a very long line is still found, and masks keep the middle hidden", () => {
        const long = `${"z".repeat(9000)} ${fake.github} ${"y".repeat(9000)}`;
        const found = scanText("a.ts", long, ["secret"]);
        expect(found.map((f) => f.rule)).toEqual(["github-token"]);
        expect(found[0]!.excerpt).not.toContain(fake.github);
        expect(mask("short")).toBe("*****");
        expect(mask("abcdefghijklmnop")).toBe("abcd…****…op");
        expect(RULES.every((r) => r.id && r.description)).toBe(true);
    });

    test("the repository itself is clean", async () => {
        expect(await scanTree()).toEqual([]);
    });
});

describe("secrets in other shapes", () => {
    const rules = (text: string) =>
        scanText("a.md", text, ["secret"]).map((f) => f.rule);

    test("credentials inside a URL, but not placeholders or example hosts", () => {
        expect(
            rules(
                `DATABASE_URL=${"postgres"}://admin:${"s3cretpass"}@db.internal/app`,
            ),
        ).toEqual(["url-credentials"]);
        expect(
            rules(`${"wss"}://bot:${"longpassword"}@gateway.internal`),
        ).toEqual(["url-credentials"]);
        expect(rules("https://user:pass@host.test")).toEqual([]);
        expect(rules("https://username:password@host.test")).toEqual([]);
        expect(rules("https://alice:hunter2@example.org")).toEqual([]);
        expect(rules("https://alice:hunter2@localhost:3000")).toEqual([]);
        expect(rules("https://discord.com/api/v10/users/@me")).toEqual([]);
        expect(rules("mailto:someone@host.test")).toEqual([]);
    });

    test("a private key, plain or base64-encoded, and its multi-line block", () => {
        const pem = [
            fake.key,
            "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
            "-----END RSA PRIVATE KEY-----",
        ].join("\n");
        // The header line is what identifies the block, wherever it sits in the file.
        expect(
            scanText("k.md", pem, ["secret"]).map((f) => [f.rule, f.line]),
        ).toEqual([["private-key", 1]]);
        const encoded = Buffer.from(`${fake.key}\nMIIEvQIBADANBg`).toString(
            "base64",
        );
        expect(rules(`key: ${encoded}`)).toEqual(["encoded-private-key"]);
    });
});

describe("scanning a repository", () => {
    const dirs: string[] = [];
    afterAll(async () => {
        for (const dir of dirs) await rm(dir, { recursive: true, force: true });
    });
    const run = (cwd: string, ...args: string[]) => {
        const result = Bun.spawnSync(["git", ...args], {
            cwd,
            env: {
                ...process.env,
                GIT_AUTHOR_NAME: "t",
                GIT_AUTHOR_EMAIL: "t@example.org",
                GIT_COMMITTER_NAME: "t",
                GIT_COMMITTER_EMAIL: "t@example.org",
            },
        });
        if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    };
    async function repo(): Promise<string> {
        const dir = await mkdtemp(join(tmpdir(), "lunibee-scan-"));
        dirs.push(dir);
        run(dir, "init", "-q", "-b", "main");
        return dir;
    }
    const capture = () => {
        const out: string[] = [];
        const err: string[] = [];
        return {
            out,
            err,
            log: {
                out: (l: string) => out.push(l),
                err: (l: string) => err.push(l),
            },
        };
    };

    test("a secret that was committed and later removed is still found in the history", async () => {
        const dir = await repo();
        await writeFile(
            join(dir, "config.ts"),
            `export const token = "${fake.github}";\n`,
        );
        run(dir, "add", "-A");
        run(dir, "commit", "-qm", "oops");
        await writeFile(
            join(dir, "config.ts"),
            "export const token = process.env.TOKEN;\n",
        );
        run(dir, "commit", "-qam", "fix");

        expect(await scanTree(dir)).toEqual([]);
        const found = await scanHistory(dir);
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ rule: "github-token", line: 1 });
        expect(found[0]!.file).toMatch(/^[0-9a-f]+:config\.ts$/);
        expect(found[0]!.excerpt).not.toContain(fake.github);

        const clean = capture();
        expect(await main([], dir, clean.log)).toBe(0);
        expect(clean.out).toEqual(["Security scan passed."]);
        const dirty = capture();
        expect(await main(["--history"], dir, dirty.log)).toBe(1);
        expect(dirty.err.join("\n")).toMatch(/github-token/);
        expect(dirty.err.join("\n")).not.toContain(fake.github);
        expect(dirty.err.at(-1)).toMatch(/1 finding/);
    });

    test("a clean repository passes with and without history, and the tree scan reports a secret that is still there", async () => {
        const dir = await repo();
        await writeFile(join(dir, "a.ts"), "export const a = 1;\n");
        run(dir, "add", "-A");
        run(dir, "commit", "-qm", "init");
        const ok = capture();
        expect(await main(["--history"], dir, ok.log)).toBe(0);
        expect(ok.out).toEqual([
            "Security scan passed (working tree and history).",
        ]);

        await writeFile(join(dir, "b.ts"), `const k = "${fake.aws}";\n`);
        run(dir, "add", "-A");
        const bad = capture();
        expect(await main([], dir, bad.log)).toBe(1);
        expect(bad.err[0]).toMatch(/^b\.ts:1 {2}aws-key/);
    });
});
