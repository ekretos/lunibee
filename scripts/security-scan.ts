/**
 * Repository security checks that need no third-party service.
 *
 *   bun scripts/security-scan.ts             tracked files: secrets and risky APIs
 *   bun scripts/security-scan.ts --history   also every line ever added on any branch
 *
 * What it is: a fast, dependency-free tripwire for the secret formats and
 * risky calls listed in RULES, run on every line (long lines included) of every
 * tracked text file, and, with `--history`, on every line any commit ever added.
 * CI runs it with `--history`, so a secret that was committed and then removed
 * is still reported. It finds PEM private-key headers (also base64-encoded),
 * tokens in URLs, and the token formats named below.
 *
 * What it is not: proof that a repository holds no secret. It matches known
 * shapes with regular expressions; a secret in an unknown format, split across
 * lines, encrypted or obfuscated is not found, and binary files are skipped.
 * Keep GitHub secret scanning with push protection and CodeQL as independent
 * checks, and rotate anything real it ever reports: deleting it is not enough.
 *
 * An exception is a comment at the end of the line that names the rule and
 * gives a reason: `// security-ok(shell-exec): runs a fixed command`,
 * `# security-ok(plain-http): …` or `<!-- security-ok(github-token): … -->`.
 * It covers only the named rules, and only matches that come before the
 * comment, so text in a string, another finding on the same line, or a
 * secret placed inside the reason is still reported.
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
        id: "discord-webhook",
        description: "Discord webhook URL (the path holds its token)",
        pattern:
            /discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d{15,}\/[A-Za-z0-9_-]{40,}/,
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
        id: "url-credentials",
        description: "credentials inside a URL",
        pattern:
            /\b[a-z][a-z0-9+.-]{1,15}:\/\/(?!(?:user|username):(?:pass|password)@)[^\s/:@"'`<>]+:[^\s/@"'`<>]{3,}@(?!example\.|localhost\b|\$\{)[^\s"'`<>]+/i,
        kind: "secret",
    },
    {
        id: "encoded-private-key",
        description: "base64-encoded private key block",
        pattern: /LS0tLS1CRUdJTi[A-Za-z0-9+/=]{20,}/,
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

/**
 * `security-ok(rule[, rule…]): reason` after a comment opener, running to the
 * end of the line (or to the end of an HTML or block comment). The reason must be present and must not
 * end in a quote or bracket, which would mean the "comment" is really text in a
 * string literal.
 */
const EXCEPTION =
    /(?:\/\/|#|<!--|\/\*)[ \t]*security-ok\(([a-z][a-z0-9, -]*)\):[ \t]*(\S.*?)[ \t]*(?:-->|\*\/)?[ \t]*$/;

/** The exception on a line: the rules it names and where its comment starts. */
export function exceptionOn(
    line: string,
): { rules: Set<string>; start: number } | undefined {
    const match = EXCEPTION.exec(line);
    if (!match) return undefined;
    const reason = match[2]!;
    // A reason that closes a string or call (`fake";`, `x')`) means the marker
    // sits inside code, not in a comment.
    if (/["'`)\]};,]$/.test(reason)) return undefined;
    return {
        rules: new Set(match[1]!.split(/[ ,]+/).filter(Boolean)),
        start: match.index,
    };
}

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
        const exception = exceptionOn(line);
        for (const rule of RULES) {
            if (!kinds.includes(rule.kind)) continue;
            const match = rule.pattern.exec(line);
            if (!match) continue;
            // Reviewed: the rule is named and the match is in the code part.
            if (exception?.rules.has(rule.id) && match.index < exception.start)
                continue;
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
        !/(\.(ts|tsx|js|mjs|cjs|json|md|mdx|yml|yaml|toml|txt|sh|env|pem|key|crt|cer|p12|bat|cmd|ps1|ini|cfg|properties)|(^|\/)\.(env|npmrc|netrc)(\..*)?)$/.test(
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
        ["log", "--all", "-m", "-p", "--no-color", "-U0", "--format=commit %h"],
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
            `\n${findings.length} finding(s). Remove the secret and rotate it, or add "security-ok(<rule>): <reason>" in a comment for a reviewed exception.`,
        );
        return 1;
    }
    log.out(
        `Security scan passed${history ? " (working tree and history)" : ""}.`,
    );
    return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
