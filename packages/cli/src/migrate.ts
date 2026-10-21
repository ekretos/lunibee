import { readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { escapeRegExp, paint, type IO } from "./io.js";

/** Names removed in 0.4.0, and the names that replace them. */
export const RENAMED: Readonly<Record<string, string>> = {
    CachedManager: "ResourceManager",
    ClientUser: "UserData",
    CreateChannelSelectMenu: "CreateChannelSelect",
    CreateMentionableSelectMenu: "CreateMentionableSelect",
    CreateMessageOptions: "MessageCreateOptions",
    CreateRoleSelectMenu: "CreateRoleSelect",
    CreateStringSelectMenu: "CreateStringSelect",
    CreateUserSelectMenu: "CreateUserSelect",
    DiscordAPIError: "RESTError",
    Events: "ClientEvent",
    FollowUpOptions: "InteractionReplyOptions",
    Intents: "IntentBits",
    InteractionUpdateOptions: "InteractionReplyOptions",
    SendBudget: "GatewaySendLimiter",
    ShardingManager: "ShardManager",
    Status: "GatewayState",
};

const VOICE_GUIDE =
    "see the voice guide: prefer `await client.voice.join({ guildId, channelId })`; `joinVoiceChannel()` needs an `adapterCreator`";

/** Removed names that have no one-to-one replacement. */
const REMOVED: Readonly<Record<string, string>> = {
    IntentsBitField:
        "an array of GatewayIntentBits, e.g. [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]",
    VoiceConnectionState: `VoiceConnectionStatus (Connected is now "ready"; ${VOICE_GUIDE})`,
    AudioStream: `nothing: createAudioResource(input, { inputType }) takes a path, URL, bytes or stream, and receiver.subscribe() returns a ReadableStream (${VOICE_GUIDE})`,
    VoiceGatewayTransport: `nothing: the voice package speaks the voice gateway itself (${VOICE_GUIDE})`,
    VoiceUdpTransport: `nothing: the voice package speaks UDP itself (${VOICE_GUIDE})`,
};

/** WebhookClient payload keys renamed to Discord's. */
const WEBHOOK_KEYS: Readonly<Record<string, string>> = {
    avatarURL: "avatar_url",
    threadId: "thread_id",
    allowedMentions: "allowed_mentions",
};

export interface Finding {
    line: number;
    found: string;
    use: string;
}

export interface FileResult {
    /** Renames applied by `--fix`. */
    fixable: Finding[];
    /** Code to change by hand; a `use` starting with "check:" is a heuristic. */
    manual: Finding[];
    /** The source with the fixable renames applied. */
    source: string;
}

/** Characters after which a `/` starts a regular expression, not a division. */
const REGEX_AFTER = new Set("(,=:[!&|?{};+-*%<>~^");
const REGEX_KEYWORDS =
    /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await)$/;

/**
 * Blanks comments, string and template text, and regular expression bodies
 * (keeping offsets and newlines), so patterns only match code. Code inside
 * `${…}` in a template literal stays visible.
 */
export function maskCode(source: string): string {
    const out = source.split("");
    const blank = (from: number, to: number) => {
        for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
    };
    /** For each open `${`, the brace depth it started at. */
    const templates: number[] = [];
    let depth = 0;
    let i = 0;
    const scanTemplate = (): void => {
        // At the first character after a backtick or after the `}` closing `${…}`.
        const start = i;
        while (i < source.length) {
            const c = source[i]!;
            if (c === "\\") i += 2;
            else if (c === "`") {
                blank(start, i);
                i++;
                return;
            } else if (c === "$" && source[i + 1] === "{") {
                blank(start, i);
                templates.push(depth);
                depth++;
                i += 2;
                return;
            } else i++;
        }
        blank(start, source.length);
    };
    while (i < source.length) {
        const c = source[i]!;
        const next = source[i + 1];
        if (c === '"' || c === "'") {
            const start = ++i;
            while (i < source.length && source[i] !== c && source[i] !== "\n")
                i += source[i] === "\\" ? 2 : 1;
            blank(start, i);
            i++;
        } else if (c === "`") {
            i++;
            scanTemplate();
        } else if (c === "/" && next === "/") {
            const end = source.indexOf("\n", i);
            const stop = end === -1 ? source.length : end;
            blank(i, stop);
            i = stop;
        } else if (c === "/" && next === "*") {
            const end = source.indexOf("*/", i + 2);
            const stop = end === -1 ? source.length : end + 2;
            blank(i, stop);
            i = stop;
        } else if (c === "/" && startsRegex(source, i)) {
            const start = ++i;
            let inClass = false;
            while (i < source.length && source[i] !== "\n") {
                const r = source[i]!;
                if (r === "\\") i += 2;
                else {
                    if (r === "[") inClass = true;
                    else if (r === "]") inClass = false;
                    else if (r === "/" && !inClass) break;
                    i++;
                }
            }
            blank(start, i);
            i++;
        } else if (c === "{") {
            depth++;
            i++;
        } else if (c === "}") {
            depth--;
            i++;
            if (templates.length && depth === templates[templates.length - 1]) {
                templates.pop();
                scanTemplate();
            }
        } else i++;
    }
    return out.join("");
}

/** Whether the `/` at `at` opens a regular expression literal. */
function startsRegex(source: string, at: number): boolean {
    let k = at - 1;
    while (k >= 0 && /\s/.test(source[k]!)) k--;
    if (k < 0) return true;
    return (
        REGEX_AFTER.has(source[k]!) ||
        REGEX_KEYWORDS.test(source.slice(Math.max(0, k - 6), k + 1))
    );
}

const LUNIBEE_IMPORT =
    /import\s+(type\s+)?(\*\s+as\s+([\w$]+)|\{([^}]*)\})\s*from\s*(["'])(lunibee|@lunibee\/[\w-]+)\5\s*;?/g;

/**
 * The top-level arguments of the call whose `(` is at `open`, as `[from, to)`
 * spans of `code` (masked, so brackets in strings do not count); null when the
 * call is not closed.
 */
function callArgs(code: string, open: number): [number, number][] | null {
    const args: [number, number][] = [];
    let depth = 0;
    let start = open + 1;
    for (let i = open; i < code.length; i++) {
        const c = code[i]!;
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") {
            if (--depth === 0) {
                if (code.slice(start, i).trim()) args.push([start, i]);
                return args;
            }
        } else if (c === "," && depth === 1) {
            args.push([start, i]);
            start = i + 1;
        }
    }
    return null;
}

/**
 * The top-level keys of an object literal argument (`...` for a spread), or
 * null when the argument is not an object literal.
 */
function objectKeys(code: string, span: [number, number]): string[] | null {
    const text = code.slice(span[0], span[1]).trim();
    if (!text.startsWith("{") || !text.endsWith("}")) return null;
    const keys: string[] = [];
    const take = (part: string) => {
        const entry = part.trim();
        if (entry.startsWith("...")) keys.push("...");
        else {
            const key = /^(?:async\s+|get\s+|set\s+)?([\w$]+)/.exec(entry);
            if (key) keys.push(key[1]!);
        }
    };
    let depth = 0;
    let start = 1;
    for (let i = 1; i < text.length - 1; i++) {
        const c = text[i]!;
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (c === "," && depth === 0) {
            take(text.slice(start, i));
            start = i + 1;
        }
    }
    take(text.slice(start, text.length - 1));
    return keys;
}

/** Whether the name at `at` is an object literal key (`{ Name: …`), not a use. */
function isKey(code: string, at: number, length: number): boolean {
    let before = at - 1;
    while (before >= 0 && /\s/.test(code[before]!)) before--;
    let after = at + length;
    while (after < code.length && /\s/.test(code[after]!)) after++;
    return (
        (code[before] === "{" || code[before] === ",") &&
        code[after] === ":" &&
        code[after + 1] !== ":"
    );
}

/**
 * Finds APIs removed in 0.4.0 in one file. Old names are renamed only when
 * the file imports them from `lunibee` or `@lunibee/*` (an `import { X as Y }`
 * keeps its local name `Y`), so a discord.js `Events` in the same project is
 * never touched. A file without such an import is not checked at all.
 */
export function scanSource(source: string): FileResult {
    const masked = maskCode(source);
    const lineOf = (index: number) => masked.slice(0, index).split("\n").length;
    const fixable: Finding[] = [];
    const manual: Finding[] = [];
    const edits: { at: number; remove: number; insert: string }[] = [];
    /** Renamed names imported under their own name, used bare in the file. */
    const bare = new Set<string>();
    /** Local name → removed name, for names without a replacement. */
    const removed = new Map<string, string>();
    /** Every local name imported from Lunibee. */
    const imported = new Set<string>();
    const namespaces: string[] = [];

    // A match inside a comment is blanked in `masked`.
    const imports = [...source.matchAll(LUNIBEE_IMPORT)].filter((m) =>
        masked.startsWith("import", m.index),
    );
    if (!imports.length) return { fixable, manual, source };
    for (const match of imports) {
        if (match[3]) {
            namespaces.push(match[3]);
            continue;
        }
        const listStart = match.index + match[0].indexOf("{") + 1;
        const kept: string[] = [];
        const seen = new Set<string>();
        let changed = false;
        let offset = 0;
        for (const raw of match[4]!.split(",")) {
            const at =
                listStart + offset + (raw.length - raw.trimStart().length);
            offset += raw.length + 1;
            const spec = raw.trim();
            if (!spec) continue;
            const parts = /^(type\s+)?([\w$]+)(\s+as\s+([\w$]+))?$/.exec(spec);
            if (!parts) {
                kept.push(spec);
                continue;
            }
            const [, typePrefix = "", name = "", , alias] = parts;
            imported.add(alias ?? name);
            const gone = REMOVED[name];
            if (gone) {
                removed.set(alias ?? name, name);
                manual.push({ line: lineOf(at), found: name, use: gone });
            }
            const replacement = RENAMED[name];
            if (!replacement) {
                if (!seen.has(name + (alias ?? ""))) kept.push(spec);
                seen.add(name + (alias ?? ""));
                continue;
            }
            changed = true;
            fixable.push({ line: lineOf(at), found: name, use: replacement });
            if (!alias) bare.add(name);
            const key = replacement + (alias ?? "");
            if (seen.has(key)) continue;
            seen.add(key);
            kept.push(
                `${typePrefix}${replacement}${alias ? ` as ${alias}` : ""}`,
            );
        }
        if (changed) {
            const multiline = match[4]!.includes("\n");
            edits.push({
                at: listStart,
                remove: match[4]!.length,
                insert: multiline
                    ? `\n    ${kept.join(",\n    ")},\n`
                    : ` ${kept.join(", ")} `,
            });
        }
    }

    const importSpans = imports.map(
        (m) => [m.index, m.index + m[0].length] as const,
    );
    const inImport = (at: number) =>
        importSpans.some(([from, to]) => at >= from && at < to);
    const namePattern = (names: Iterable<string>) =>
        new RegExp(
            `(?<![\\w$.])(${[...names].map(escapeRegExp).join("|")})(?![\\w$])`,
            "g",
        );
    /** Whether `name` is imported from Lunibee, directly or through a namespace. */
    const fromLunibee = (name: string) =>
        imported.has(name) ||
        namespaces.some((ns) =>
            new RegExp(`(?<![\\w$.])${escapeRegExp(ns)}\\.${name}\\b`).test(
                masked,
            ),
        );

    // Uses of renamed names (imports are handled above).
    if (bare.size)
        for (const use of masked.matchAll(namePattern(bare))) {
            if (inImport(use.index) || isKey(masked, use.index, use[1]!.length))
                continue;
            edits.push({
                at: use.index,
                remove: use[1]!.length,
                insert: RENAMED[use[1]!]!,
            });
        }
    // Uses of removed names, one finding per line.
    if (removed.size) {
        const reported = new Set<string>();
        for (const use of masked.matchAll(namePattern(removed.keys()))) {
            if (inImport(use.index) || isKey(masked, use.index, use[1]!.length))
                continue;
            const line = lineOf(use.index);
            if (reported.has(`${line}:${use[1]}`)) continue;
            reported.add(`${line}:${use[1]}`);
            manual.push({
                line,
                found: use[1]!,
                use: REMOVED[removed.get(use[1]!)!]!,
            });
        }
    }
    for (const ns of namespaces) {
        const prefix = `(?<![\\w$.])${escapeRegExp(ns)}\\.`;
        const renamed = new RegExp(
            `${prefix}(${Object.keys(RENAMED).join("|")})(?![\\w$])`,
            "g",
        );
        for (const use of masked.matchAll(renamed)) {
            fixable.push({
                line: lineOf(use.index),
                found: `${ns}.${use[1]}`,
                use: `${ns}.${RENAMED[use[1]!]}`,
            });
            edits.push({
                at: use.index + ns.length + 1,
                remove: use[1]!.length,
                insert: RENAMED[use[1]!]!,
            });
        }
        const gone = new RegExp(
            `${prefix}(${Object.keys(REMOVED).join("|")})(?![\\w$])`,
            "g",
        );
        for (const use of masked.matchAll(gone))
            manual.push({
                line: lineOf(use.index),
                found: `${ns}.${use[1]}`,
                use: REMOVED[use[1]!]!,
            });
    }

    const report = (at: number, found: string, use: string) =>
        manual.push({ line: lineOf(at), found, use });
    /** Each call matching `pattern` (which must end at its `(`), with its arguments. */
    const calls = function* (pattern: RegExp) {
        for (const match of masked.matchAll(pattern)) {
            const args = callArgs(masked, match.index + match[0].length - 1);
            if (args) yield { at: match.index, match, args };
        }
    };

    // 0.3 voice transports.
    for (const { at } of calls(/\.attachTransports\s*\(/g))
        report(at, "attachTransports()", `nothing: ${VOICE_GUIDE}`);
    if (fromLunibee("joinVoiceChannel"))
        for (const { at, args } of calls(
            /(?<![\w$])(?:[\w$]+\.)?joinVoiceChannel\s*\(/g,
        )) {
            const keys = args[0] ? objectKeys(masked, args[0]) : [];
            if (
                keys &&
                !keys.includes("...") &&
                !keys.includes("adapterCreator")
            )
                report(
                    at,
                    "joinVoiceChannel()",
                    "check: it needs an adapterCreator; with a Lunibee Client, use `await client.voice.join({ guildId, channelId })`",
                );
        }

    // REST: the body is positional.
    for (const { at, match, args } of calls(/\.(post|put|patch)\s*\(/g)) {
        const keys = args[1] && objectKeys(masked, args[1]);
        if (keys?.includes("body"))
            report(
                at + 1,
                `${match[1]}(path, { body })`,
                `${match[1]}(path, body, options): the body is the second argument; files, reason and query go in the third`,
            );
    }
    for (const { at, args } of calls(/\.request\s*\(/g)) {
        const keys = args[0] && objectKeys(masked, args[0]);
        if (
            keys?.includes("method") &&
            (keys.includes("path") || keys.includes("fullRoute"))
        )
            report(
                at + 1,
                "request({ method, path })",
                "request(method, path, body, options)",
            );
    }

    // WebhookClient payloads take Discord's key names.
    if (fromLunibee("WebhookClient"))
        for (const use of masked.matchAll(
            namePattern(Object.keys(WEBHOOK_KEYS)),
        ))
            if (isKey(masked, use.index, use[1]!.length))
                report(
                    use.index,
                    `${use[1]}:`,
                    `check: in a WebhookClient payload, use ${WEBHOOK_KEYS[use[1]!]}`,
                );

    // A Client in a cluster worker needs to know its shards.
    if (fromLunibee("ClusterWorker") || fromLunibee("ShardBus"))
        for (const { at, args } of calls(
            /(?<![\w$.])new\s+(?:[\w$]+\.)?Client\s*\(/g,
        )) {
            const keys = args[0] ? objectKeys(masked, args[0]) : [];
            if (keys && !keys.includes("...") && !keys.includes("gateway"))
                report(
                    at,
                    "new Client()",
                    "check: a Client in a cluster worker needs gateway: { shardId, shardCount } (one of ClusterWorker.current()!.context.shardIds), or use ShardManager",
                );
        }

    let result = source;
    for (const edit of edits.sort((a, b) => b.at - a.at))
        result =
            result.slice(0, edit.at) +
            edit.insert +
            result.slice(edit.at + edit.remove);
    fixable.sort((a, b) => a.line - b.line);
    manual.sort((a, b) => a.line - b.line);
    return { fixable, manual, source: result };
}

export interface MigrateOptions {
    fix?: boolean;
    dryRun?: boolean;
    json?: boolean;
}

/** TypeScript and JavaScript source files under src/. */
async function sourceFiles(root: string): Promise<string[]> {
    const dir = join(root, "src");
    let entries: string[];
    try {
        entries = await readdir(dir, { recursive: true });
    } catch {
        return [];
    }
    return entries
        .filter(
            (file) =>
                /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file) &&
                !/\.d\.[mc]?ts$/.test(file) &&
                !file.split(/[\\/]/).includes("node_modules"),
        )
        .map((file) => join(dir, file))
        .sort();
}

/** `lunibee migrate [--fix] [--dry-run] [--json]`: moves a project to 0.4.0. @returns The exit code. */
export async function migrate(
    io: IO,
    root: string,
    options: MigrateOptions = {},
): Promise<number> {
    const write = options.fix === true && !options.dryRun;
    const report: {
        fixable: (Finding & { file: string })[];
        manual: (Finding & { file: string })[];
        files: number;
    } = { fixable: [], manual: [], files: 0 };
    for (const path of await sourceFiles(root)) {
        report.files++;
        const source = await Bun.file(path).text();
        const result = scanSource(source);
        const file = relative(root, path);
        report.fixable.push(...result.fixable.map((f) => ({ file, ...f })));
        report.manual.push(...result.manual.map((f) => ({ file, ...f })));
        if (write && result.source !== source)
            await writeFile(path, result.source);
    }

    if (options.json) io.out(JSON.stringify(report));
    else {
        const verb = write
            ? "renamed"
            : options.fix
              ? "would rename"
              : "rename";
        for (const f of report.fixable)
            io.out(
                `${paint(io, "green", "✓")} ${f.file}:${f.line} ${verb} ${f.found} → ${f.use}`,
            );
        for (const f of report.manual)
            io.out(
                `${paint(io, "yellow", "⚠")} ${f.file}:${f.line} ${f.found}: ${f.use.startsWith("check:") ? f.use : `use ${f.use}`}`,
            );
        io.out(
            `\n${report.files} files checked, ${report.fixable.length} ${write ? "fixed" : "to fix"}, ${report.manual.length} to change by hand (0.4.0)`,
        );
        if (report.manual.some((f) => f.use.startsWith("check:")))
            io.out(
                paint(
                    io,
                    "dim",
                    "Lines marked check: are guesses; leave them if the code is already right.",
                ),
            );
        if (!options.fix && report.fixable.length)
            io.out(
                paint(
                    io,
                    "dim",
                    "Run `lunibee migrate --fix` to apply the renames.",
                ),
            );
    }
    return report.manual.length || (!write && report.fixable.length) ? 1 : 0;
}
