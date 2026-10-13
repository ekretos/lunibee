import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    RULES,
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
