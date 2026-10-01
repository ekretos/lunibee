import { readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { paint, type IO } from "./io.js";

/** Pre-0.2.2 names, removed in 0.3.0, and the names that replace them. */
export const RENAMED: Readonly<Record<string, string>> = {
    ActionRowBuilder: "CreateActionRow",
    ApplicationCommandOptionType: "ApplicationCommandOptionEnum",
    ApplicationCommandType: "ApplicationCommandEnum",
    AttachmentBuilder: "CreateAttachment",
    AttachmentOptionBuilder: "CreateAttachmentOption",
    BooleanOptionBuilder: "CreateBooleanOption",
    ButtonBuilder: "CreateButton",
    ButtonStyle: "ButtonType",
    ChannelOptionBuilder: "CreateChannelOption",
    ChannelSelectMenuBuilder: "CreateChannelSelectMenu",
    ChannelType: "ChannelEnum",
    CommandOptionBuilder: "CreateCommandOption",
    ComponentType: "ComponentEnum",
    ContainerBuilder: "CreateContainer",
    ContentInventoryEntryBuilder: "CreateContentInventoryEntry",
    ContextMenuCommandBuilder: "CreateContextMenuCommand",
    EmbedBuilder: "CreateEmbed",
    EntitySelectBuilder: "CreateEntitySelect",
    FileComponentBuilder: "CreateFileComponent",
    IntegerOptionBuilder: "CreateIntegerOption",
    InteractionResponseType: "InteractionResponseEnum",
    InteractionType: "InteractionEnum",
    MediaGalleryBuilder: "CreateMediaGallery",
    MentionableOptionBuilder: "CreateMentionableOption",
    MentionableSelectMenuBuilder: "CreateMentionableSelectMenu",
    MessageCommandBuilder: "CreateMessageCommand",
    ModalBuilder: "CreateModal",
    NumberOptionBuilder: "CreateNumberOption",
    PermissionOverwriteType: "PermissionOverwriteEnum",
    RoleOptionBuilder: "CreateRoleOption",
    RoleSelectMenuBuilder: "CreateRoleSelectMenu",
    SectionBuilder: "CreateSection",
    SeparatorBuilder: "CreateSeparator",
    SlashCommandBuilder: "CreateSlashCommand",
    StickerFormatType: "StickerFormatEnum",
    StickerType: "StickerEnum",
    StringOptionBuilder: "CreateStringOption",
    StringSelectBuilder: "CreateStringSelect",
    StringSelectMenuBuilder: "CreateStringSelectMenu",
    SubcommandBuilder: "CreateSubcommand",
    SubcommandGroupBuilder: "CreateSubcommandGroup",
    TextDisplayBuilder: "CreateTextDisplay",
    TextInputBuilder: "CreateTextInput",
    TextInputStyle: "TextInputType",
    ThumbnailBuilder: "CreateThumbnail",
    UserCommandBuilder: "CreateUserCommand",
    UserOptionBuilder: "CreateUserOption",
    UserSelectMenuBuilder: "CreateUserSelectMenu",
    WebhookType: "WebhookEnum",
};

/** Calls that are deprecated but cannot be proven to be Lunibee's from the text alone. */
const BY_HAND: readonly { pattern: RegExp; use: string }[] = [
    { pattern: /\.deleteRole\s*\(/g, use: "roles.remove(id, reason?)" },
    { pattern: /\.deleteEmoji\s*\(/g, use: "emojis.remove(id, reason?)" },
    { pattern: /\.deleteChannel\s*\(/g, use: "channels.remove(id, reason?)" },
    // One argument only: ApplicationCommandManager.deleteGuild(guildId, commandId) stays.
    { pattern: /\.deleteGuild\s*\(\s*[^,()]*\)/g, use: "guilds.remove(id)" },
    {
        pattern: /\.sendMessage\s*\(/g,
        use: "send() on a Lunibee channel or channel manager",
    },
    {
        pattern: /\.bulkDelete\s*\(/g,
        use: "channels.bulkDeleteMessages(id, ids, reason?)",
    },
    {
        pattern: /\.setDMPermission\s*\(/g,
        use: "setContexts(0) for guilds only, setContexts(0, 1) to allow the bot's DMs",
    },
    {
        pattern: /\bRoutes\.channelPins\s*\(/g,
        use: "Routes.channelMessagesPins (returns { items, has_more })",
    },
    {
        pattern: /\bwithExpiration\b/g,
        use: "nothing: Discord always returns expires_at",
    },
];

export interface Finding {
    line: number;
    found: string;
    use: string;
}

export interface FileResult {
    /** Renames applied by `--fix`. */
    fixable: Finding[];
    /** Deprecated calls to change by hand. */
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
 * Finds deprecated Lunibee APIs in one file. Old names are renamed only when
 * the file imports them from `lunibee` or `@lunibee/*`, so a discord.js
 * `EmbedBuilder` in the same project is never touched.
 */
export function scanSource(source: string): FileResult {
    const masked = maskCode(source);
    const lineOf = (index: number) => masked.slice(0, index).split("\n").length;
    const fixable: Finding[] = [];
    const manual: Finding[] = [];
    const edits: { at: number; remove: number; insert: string }[] = [];
    /** Old names imported under their own name, used bare in the file. */
    const bare = new Set<string>();
    const namespaces: string[] = [];
    let routesFromLunibee = false;

    for (const match of source.matchAll(LUNIBEE_IMPORT)) {
        if (match[3]) {
            namespaces.push(match[3]);
            continue;
        }
        const listStart = match.index + match[0].indexOf("{") + 1;
        const specifiers = match[4]!.split(",");
        const kept: string[] = [];
        const seen = new Set<string>();
        let changed = false;
        for (const raw of specifiers) {
            const spec = raw.trim();
            if (!spec) continue;
            const parts = /^(type\s+)?([\w$]+)(\s+as\s+([\w$]+))?$/.exec(spec);
            if (!parts) {
                kept.push(spec);
                continue;
            }
            const [, typePrefix = "", name = "", , alias] = parts;
            if (name === "Routes" && !alias) routesFromLunibee = true;
            const replacement = RENAMED[name];
            if (!replacement) {
                if (!seen.has(name + (alias ?? ""))) kept.push(spec);
                seen.add(name + (alias ?? ""));
                continue;
            }
            changed = true;
            fixable.push({
                line: lineOf(match.index),
                found: name,
                use: replacement,
            });
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

    // Uses of renamed names in code (imports are already handled above).
    const importSpans = [...source.matchAll(LUNIBEE_IMPORT)].map(
        (m) => [m.index, m.index + m[0].length] as const,
    );
    const inImport = (at: number) =>
        importSpans.some(([from, to]) => at >= from && at < to);
    const namePattern = (names: string[]) =>
        new RegExp(`(?<![\\w$.])(${names.join("|")})(?![\\w$])`, "g");
    if (bare.size) {
        for (const use of masked.matchAll(namePattern([...bare]))) {
            if (inImport(use.index)) continue;
            edits.push({
                at: use.index,
                remove: use[1]!.length,
                insert: RENAMED[use[1]!]!,
            });
        }
    }
    for (const ns of namespaces) {
        const pattern = new RegExp(
            `(?<![\\w$.])${ns.replace(/\$/g, "\\$")}\\.(${Object.keys(RENAMED).join("|")})(?![\\w$])`,
            "g",
        );
        for (const use of masked.matchAll(pattern)) {
            const at = use.index + ns.length + 1;
            fixable.push({
                line: lineOf(use.index),
                found: `${ns}.${use[1]}`,
                use: `${ns}.${RENAMED[use[1]!]}`,
            });
            edits.push({
                at,
                remove: use[1]!.length,
                insert: RENAMED[use[1]!]!,
            });
        }
        if (new RegExp(`\\b${ns}\\.Routes\\b`).test(masked))
            routesFromLunibee = true;
    }
    if (routesFromLunibee) {
        for (const use of masked.matchAll(/\bRoutes\.channelPin(?=\s*\()/g)) {
            fixable.push({
                line: lineOf(use.index),
                found: "Routes.channelPin",
                use: "Routes.channelMessagesPin",
            });
            edits.push({
                at: use.index + use[0].length - "channelPin".length,
                remove: "channelPin".length,
                insert: "channelMessagesPin",
            });
        }
    }

    for (const { pattern, use } of BY_HAND) {
        for (const match of masked.matchAll(pattern)) {
            if (inImport(match.index)) continue;
            manual.push({
                line: lineOf(match.index),
                found: match[0]
                    .replace(/\s*\($/, "(")
                    .replace(/^\./, "")
                    .trim(),
                use,
            });
        }
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

/** Source files under src/. */
async function sourceFiles(root: string): Promise<string[]> {
    const dir = join(root, "src");
    let entries: string[];
    try {
        entries = (await readdir(dir, { recursive: true })) as string[];
    } catch {
        return [];
    }
    return entries
        .filter(
            (file) =>
                /\.(ts|mts|cts|js|mjs|cjs)$/.test(file) &&
                !/\.d\.[mc]?ts$/.test(file) &&
                !file.split(/[\\/]/).includes("node_modules"),
        )
        .map((file) => join(dir, file))
        .sort();
}

/** `lunibee migrate [--fix] [--dry-run] [--json]`. @returns The exit code. */
export async function migrateDeprecations(
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
                `${paint(io, "yellow", "⚠")} ${f.file}:${f.line} ${f.found}: use ${f.use}`,
            );
        io.out(
            `\n${report.files} files checked, ${report.fixable.length} ${write ? "fixed" : "to fix"}, ${report.manual.length} to change by hand (removed in 0.3.0)`,
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
