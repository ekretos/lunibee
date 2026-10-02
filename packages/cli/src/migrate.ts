import { readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discover, EVENTS, eventsDir, syncHandlers } from "./handlers.js";
import { escapeRegExp, paint, type IO } from "./io.js";

export type Migration =
    | { state: "ok" }
    | { state: "fixable"; source: string }
    | { state: "manual"; reason: string };

/** Blanks comments (keeping offsets) so patterns do not match inside them. */
function maskComments(source: string): string {
    let out = "";
    let quote: string | null = null;
    for (let i = 0; i < source.length; i++) {
        const c = source[i]!;
        if (quote) {
            out += c;
            if (c === "\\") out += source[++i] ?? "";
            else if (c === quote) quote = null;
        } else if (c === '"' || c === "'" || c === "`") {
            quote = c;
            out += c;
        } else if (c === "/" && source[i + 1] === "/") {
            while (i < source.length && source[i] !== "\n") ((out += " "), i++);
            if (i < source.length) out += "\n";
        } else if (c === "/" && source[i + 1] === "*") {
            const end = source.indexOf("*/", i + 2);
            const stop = end === -1 ? source.length : end + 2;
            out += source.slice(i, stop).replace(/[^\n]/g, " ");
            i = stop - 1;
        } else out += c;
    }
    return out;
}

/** Index of the parenthesis closing the one at `open`, or -1. */
function closeParen(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth === 0) return i;
    }
    return -1;
}

/** Top-level parameters of a parameter list. */
function splitParams(list: string): string[] {
    const params: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < list.length; i++) {
        const c = list[i]!;
        if ("([{<".includes(c)) depth++;
        else if (")]}".includes(c) || (c === ">" && list[i - 1] !== "="))
            depth--;
        else if (c === "," && depth === 0) {
            params.push(list.slice(start, i));
            start = i + 1;
        }
    }
    params.push(list.slice(start));
    return params.map((p) => p.trim()).filter(Boolean);
}

/** Whether a parameter is the client: named client/bot, or typed as some *Client. */
function isClientParam(param: string): boolean {
    const [name = "", type = ""] = param
        .replace(/^\.\.\./, "")
        .split(/:(.*)/s, 2);
    return (
        /^_?(client|bot)\??$/i.test(name.trim()) ||
        /(^|[^\w$])[\w$]*Client\b(?!Events)/.test(type)
    );
}

type Target =
    | { kind: "params"; open: number }
    | { kind: "bare"; start: number; name: string }
    | { kind: "manual"; reason: string };

/** Finds the parameter list of the default-exported handler. */
function findTarget(text: string): Target {
    const direct =
        /export\s+default\s+(?:async\s+)?function\s*\*?\s*[\w$]*\s*(?:<[^>]*>)?\s*\(/.exec(
            text,
        ) ?? /export\s+default\s+(?:async\s+)?\(/.exec(text);
    if (direct)
        return { kind: "params", open: direct.index + direct[0].length - 1 };
    const bare = /export\s+default\s+(?:async\s+)?([\w$]+)\s*=>/.exec(text);
    if (bare)
        return {
            kind: "bare",
            start: bare.index + bare[0].indexOf(bare[1]!, 15),
            name: bare[1]!,
        };
    const named =
        /export\s+default\s+([\w$]+)\s*;?\s*$/m.exec(text)?.[1] ??
        /export\s*\{[^}]*?\b([\w$]+)\s+as\s+default\b/.exec(text)?.[1];
    if (!named || ["class", "async", "function"].includes(named))
        return { kind: "manual", reason: "no default-exported function found" };
    const escaped = escapeRegExp(named);
    const declared =
        new RegExp(
            `function\\s*\\*?\\s*${escaped}\\s*(?:<[^>]*>)?\\s*\\(`,
        ).exec(text) ??
        new RegExp(
            `(?:const|let|var)\\s+${escaped}\\s*(?::[^=]+)?=\\s*(?:async\\s+)?\\(`,
        ).exec(text);
    if (declared)
        return {
            kind: "params",
            open: declared.index + declared[0].length - 1,
        };
    const arrow = new RegExp(
        `(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s+)?([\\w$]+)\\s*=>`,
    ).exec(text);
    if (arrow)
        return {
            kind: "bare",
            start: arrow.index + arrow[0].lastIndexOf(arrow[1]!),
            name: arrow[1]!,
        };
    return {
        kind: "manual",
        reason: `could not find the declaration of ${named}`,
    };
}

/** Adds `Client` to a lunibee import, or a new type import; null when already imported. */
function importEdit(text: string): { at: number; insert: string } | null {
    const imports = [...text.matchAll(/^\s*import\s[^;]*?;/gm)];
    if (imports.some((m) => /[{,]\s*(?:type\s+)?Client\s*[,}]/.test(m[0])))
        return null;
    const lunibee = imports.find(
        (m) => /from\s*["']lunibee["']/.test(m[0]) && /\{/.test(m[0]),
    );
    if (lunibee) {
        const brace = lunibee.index + lunibee[0].indexOf("{") + 1;
        return {
            at: brace,
            insert: /^\s*import\s+type\s/.test(lunibee[0])
                ? " Client,"
                : " type Client,",
        };
    }
    const last = imports.at(-1);
    if (last)
        return {
            at: last.index + last[0].length,
            insert: '\nimport type { Client } from "lunibee";',
        };
    const shebang = /^#!.*\n/.exec(text);
    return {
        at: shebang ? shebang[0].length : 0,
        insert: 'import type { Client } from "lunibee";\n\n',
    };
}

/**
 * Rewrites a pre-0.2.2 handler `(…args)` into `(_client: Client, …args)`.
 * Handlers that already take the client (a first parameter named client/bot
 * or typed as a Client) or take no parameters are left alone.
 */
export function migrateHandler(source: string, typescript = true): Migration {
    const text = maskComments(source);
    const target = findTarget(text);
    if (target.kind === "manual")
        return { state: "manual", reason: target.reason };
    const client = typescript ? "_client: Client" : "_client";
    const edits: { at: number; remove?: number; insert: string }[] = [];
    if (target.kind === "bare") {
        edits.push({
            at: target.start,
            remove: target.name.length,
            insert: `(${client}, ${target.name})`,
        });
    } else {
        const close = closeParen(text, target.open);
        if (close === -1)
            return { state: "manual", reason: "unbalanced parameter list" };
        const params = splitParams(text.slice(target.open + 1, close));
        if (!params.length || isClientParam(params[0]!)) return { state: "ok" };
        edits.push({ at: target.open + 1, insert: `${client}, ` });
    }
    if (typescript) {
        const imported = importEdit(text);
        if (imported) edits.push(imported);
    }
    let result = source;
    for (const edit of edits.sort((a, b) => b.at - a.at))
        result =
            result.slice(0, edit.at) +
            edit.insert +
            result.slice(edit.at + (edit.remove ?? 0));
    return { state: "fixable", source: result };
}

export interface HandlerReport {
    /** Files rewritten (or that would be) to take the client first. */
    migrated: string[];
    /** Folders renamed to the event's exact name. */
    renamed: string[];
    /** What needs a hand: unknown folders, missing default exports, unrecognised shapes. */
    manual: string[];
    ok: number;
}

export interface FixOptions {
    fix?: boolean;
    dryRun?: boolean;
    json?: boolean;
}

/** `lunibee handler [--fix] [--dry-run] [--json]`. @returns The exit code. */
export async function fixHandlers(
    io: IO,
    root: string,
    options: FixOptions = {},
): Promise<number> {
    const dir = eventsDir(root);
    const write = options.fix && !options.dryRun;
    const report: HandlerReport = {
        migrated: [],
        renamed: [],
        manual: [],
        ok: 0,
    };

    // Folders that differ from an event only by case (messagecreate/) are renamed.
    const before = await discover(dir);
    for (const folder of before.unknownFolders) {
        const event = EVENTS.find(
            (e) => e.toLowerCase() === folder.toLowerCase(),
        );
        if (!event) {
            report.manual.push(`events/${folder}/: not a client event`);
            continue;
        }
        const taken = (await readdir(dir)).includes(event);
        if (taken) {
            report.manual.push(
                `events/${folder}/: merge it into events/${event}/ by hand`,
            );
            continue;
        }
        report.renamed.push(`events/${folder}/ → events/${event}/`);
        if (write) {
            // Two steps, so case-insensitive file systems rename too.
            const temp = join(dir, `${folder}.lunibee-rename`);
            await rename(join(dir, folder), temp);
            await rename(temp, join(dir, event));
        }
    }

    // Folder on disk → event name, including folders about to be renamed.
    const folders = new Map<string, string>(
        [...new Set(before.handlers.map((h) => h.event))].map((e) => [e, e]),
    );
    for (const line of report.renamed) {
        const [from, to] = line.split(" → ").map((p) => p.slice(7, -1));
        folders.set(write ? to! : from!, to!);
    }
    for (const [folder, event] of [...folders].sort()) {
        const seen = new Set<string>();
        const files = (
            await readdir(join(dir, folder), { withFileTypes: true })
        )
            .filter(
                (f) =>
                    f.isFile() &&
                    /\.[jt]s$/.test(f.name) &&
                    !/\.(d|test|spec)\.[jt]s$/.test(f.name),
            )
            .map((f) => f.name)
            .sort(
                (a, b) =>
                    Number(a.endsWith(".js")) - Number(b.endsWith(".js")) ||
                    a.localeCompare(b),
            );
        for (const file of files) {
            const base = file.slice(0, -3);
            if (seen.has(base)) continue;
            seen.add(base);
            const path = join(dir, folder, file);
            const result = migrateHandler(
                await Bun.file(path).text(),
                file.endsWith(".ts"),
            );
            const label = `events/${event}/${file}`;
            if (result.state === "ok") report.ok++;
            else if (result.state === "manual")
                report.manual.push(`${label}: ${result.reason}`);
            else {
                report.migrated.push(label);
                if (write) await writeFile(path, result.source);
            }
        }
    }

    const pending = report.migrated.length + report.renamed.length;
    if (options.json) io.out(JSON.stringify(report));
    else {
        const verb = write ? "" : options.fix ? "would " : "needs ";
        for (const line of report.renamed)
            io.out(`${paint(io, "green", "✓")} ${verb}rename ${line}`);
        for (const line of report.migrated)
            io.out(
                `${paint(io, "green", "✓")} ${write ? "updated" : `${verb}update`} ${line} (client first)`,
            );
        for (const line of report.manual)
            io.out(`${paint(io, "yellow", "⚠")} ${line}`);
        io.out(
            `\n${report.ok} up to date, ${pending} ${write ? "fixed" : "to fix"}, ${report.manual.length} to check by hand`,
        );
        if (!options.fix && pending)
            io.out(paint(io, "dim", "Run `lunibee handler --fix` to apply."));
    }
    if (write) {
        await syncHandlers(options.json ? { ...io, out: () => {} } : io, root);
    }
    return report.manual.length || (!write && pending) ? 1 : 0;
}
