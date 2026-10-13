/**
 * Repository security checks that need no third-party service.
 *
 *   bun scripts/security-scan.ts             tracked files: secrets and risky APIs
 *   bun scripts/security-scan.ts --history   also every line ever added on any branch
 *
 * A line may opt out with `security-ok: <reason>` in a comment next to it;
 * the reason is required so the exception can be reviewed.
 */

/** One thing the scan looks for. */
export interface Rule {
    id: string;
    description: string;
    pattern: RegExp;
    /** `secret` rules run on every tracked text file; `api` rules only on package sources. */
    kind: "secret" | "api";
}

export interface Finding {
    rule: string;
    description: string;
    file: string;
    line: number;
    /** The matching text with its middle hidden, so a report never repeats a secret. */
    excerpt: string;
}

export const RULES: Rule[] = [
    {
        id: "discord-token",
        description: "Discord bot token",
        pattern:
            /\b[MNO][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}\b/,
        kind: "secret",
    },
    {
        id: "github-token",
        description: "GitHub token",
        pattern:
            /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/,
        kind: "secret",
    },
    {
        id: "npm-token",
        description: "npm access token",
        pattern: /\bnpm_[A-Za-z0-9]{36}\b/,
        kind: "secret",
    },
    {
        id: "aws-key",
        description: "AWS access key ID",
        pattern: /\bAKIA[0-9A-Z]{16}\b/,
        kind: "secret",
    },
    {
        id: "slack-token",
        description: "Slack token",
        pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
        kind: "secret",
    },
    {
        id: "private-key",
        description: "Private key block",
        pattern:
            /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
        kind: "secret",
    },
    {
        id: "dynamic-code",
        description: "eval() or new Function() runs strings as code",
        pattern: /(?<![\w.$])eval\s*\(|\bnew\s+Function\s*\(/,
        kind: "api",
    },
    {
        id: "shell-exec",
        description:
            "child_process exec/execSync runs a shell; use spawn with an argument list",
        pattern:
            /(?<![.\w$])(?:exec|execSync)\s*\(|\bchild_process\.exec(?:Sync)?\b/,
        kind: "api",
    },
    {
        id: "tls-off",
        description: "TLS certificate verification disabled",
        pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/,
        kind: "api",
    },
    {
        id: "plain-http",
        description: "plain http:// URL to a non-local host",
        pattern:
            /["'`]http:\/\/(?!localhost\b|127\.0\.0\.1\b|\[::1\]|0\.0\.0\.0\b|example\.|\$\{)[A-Za-z0-9]/,
        kind: "api",
    },
];

const OPT_OUT = /security-ok:\s*\S/;

/** Hides the middle of a match. */
export function mask(text: string): string {
    return text.length <= 12
        ? "*".repeat(text.length)
        : `${text.slice(0, 4)}…${"*".repeat(4)}…${text.slice(-2)}`;
}

/** Scans one file's text. @param kinds Which rule kinds apply to it. */
export function scanText(
    file: string,
    text: string,
    kinds: readonly Rule["kind"][],
): Finding[] {
    const findings: Finding[] = [];
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
        if (line.length > 4000) continue; // minified or data blobs
        if (OPT_OUT.test(line)) continue;
        for (const rule of RULES) {
            if (!kinds.includes(rule.kind)) continue;
            const match = rule.pattern.exec(line);
            if (match)
                findings.push({
                    rule: rule.id,
                    description: rule.description,
                    file,
                    line: index + 1,
                    excerpt: mask(match[0]),
                });
        }
    }
    return findings;
}

/** Which rule kinds apply to a path. */
export function kindsFor(file: string): Rule["kind"][] {
    if (
        /(^|\/)(bun\.lock|node_modules|dist|\.types)\//.test(file) ||
        file.endsWith("bun.lock")
    )
        return [];
    if (
        !/\.(ts|tsx|js|mjs|cjs|json|md|mdx|yml|yaml|toml|txt|sh|env)$/.test(
            file,
        )
    )
        return [];
    // Archived docs and generated API pages quote old versions verbatim.
    if (/^lunibee\.js\.org\/src\/content\/docs\/(0\.|api\/)/.test(file))
        return ["secret"];
    return /^packages\/[^/]+\/src\/.*\.ts$/.test(file)
        ? ["secret", "api"]
        : ["secret"];
}

async function git(args: string[], cwd?: string): Promise<string> {
    const process = Bun.spawn(["git", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, code] = await Promise.all([
        new Response(process.stdout).text(),
        process.exited,
    ]);
    if (code !== 0) throw new Error(`git ${args.join(" ")} failed`);
    return out;
}

/** Scans every tracked file in the working tree of `cwd` (default: the current directory). */
export async function scanTree(cwd?: string): Promise<Finding[]> {
    const files = (await git(["ls-files"], cwd)).split("\n").filter(Boolean);
    const findings: Finding[] = [];
    for (const file of files) {
        const kinds = kindsFor(file);
        if (kinds.length === 0) continue;
        const text = await Bun.file(cwd ? `${cwd}/${file}` : file)
            .text()
            .catch(() => "");
        findings.push(...scanText(file, text, kinds));
    }
    return findings;
}

/** Scans every line added in any commit of any branch (secrets only). */
export async function scanHistory(cwd?: string): Promise<Finding[]> {
    const log = await git(
        ["log", "--all", "-p", "--no-color", "-U0", "--format=commit %h"],
        cwd,
    );
    const findings: Finding[] = [];
    let commit = "";
    let file = "";
    let line = 0;
    for (const text of log.split("\n")) {
        if (text.startsWith("commit ")) commit = text.slice(7);
        else if (text.startsWith("+++ b/")) file = text.slice(6);
        else if (text.startsWith("@@"))
            line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0);
        else if (text.startsWith("+") && !text.startsWith("+++")) {
            if (kindsFor(file).length > 0)
                for (const found of scanText(
                    `${commit}:${file}`,
                    text.slice(1),
                    ["secret"],
                ))
                    findings.push({ ...found, line });
            line++;
        }
    }
    return findings;
}

/**
 * Runs the scan and reports it.
 * @returns The process exit code: 0 when clean, 1 when there are findings.
 */
export async function main(
    argv: readonly string[],
    cwd?: string,
    log: { out(line: string): void; err(line: string): void } = {
        out: (line) => console.log(line),
        err: (line) => console.error(line),
    },
): Promise<number> {
    const history = argv.includes("--history");
    const findings = [
        ...(await scanTree(cwd)),
        ...(history ? await scanHistory(cwd) : []),
    ];
    for (const f of findings)
        log.err(
            `${f.file}:${f.line}  ${f.rule}: ${f.description} (${f.excerpt})`,
        );
    if (findings.length > 0) {
        log.err(
            `\n${findings.length} finding(s). Remove the secret and rotate it, or add "security-ok: <reason>" for a reviewed exception.`,
        );
        return 1;
    }
    log.out(
        `Security scan passed${history ? " (working tree and history)" : ""}.`,
    );
    return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
