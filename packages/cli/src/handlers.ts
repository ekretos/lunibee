import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ClientEvent } from "@lunibee/core";
import { CliError, closest, didYouMean, paint, type IO } from "./io.js";

const EVENTS = Object.values(ClientEvent) as ClientEvent[];
const MEMBERS = Object.keys(ClientEvent);

const RESERVED = new Set(
    "default class function export import const let var if else switch case for while do return new try catch finally throw typeof instanceof void delete".split(
        " ",
    ),
);

/** A valid JavaScript identifier derived from `value`. */
export function identifier(value: string): string {
    let result = value.replace(/[^a-zA-Z0-9_$]/g, "_");
    if (RESERVED.has(result)) result = `_${result}`;
    return /^[a-zA-Z_$]/.test(result) ? result : `handler_${result}`;
}

/** A safe `.ts` file name; rejects path separators and empty names. */
export function fileName(value: string): string {
    const trimmed = value.trim().replace(/\.ts$/, "");
    if (!trimmed) throw new CliError("Name cannot be empty.");
    if (/[\\/]|^\.+$/.test(trimmed))
        throw new CliError(
            `Invalid name: ${value}`,
            "Use a plain file name without folders.",
        );
    return `${trimmed.replace(/[^a-zA-Z0-9._-]/g, "-")}.ts`;
}

/** Resolves `messageCreate`, `messagecreate` or `MessageCreate` to a client event. */
export function resolveEvent(input: string): ClientEvent {
    const needle = input.trim().toLowerCase();
    const byValue = EVENTS.find((event) => event.toLowerCase() === needle);
    if (byValue) return byValue;
    const member = MEMBERS.find((name) => name.toLowerCase() === needle);
    if (member) return ClientEvent[member as keyof typeof ClientEvent];
    throw new CliError(
        `Unknown client event: ${input}`,
        didYouMean(input, EVENTS) ??
            "Run `lunibee list events` to see them all.",
    );
}

function eventMember(event: ClientEvent): string {
    return MEMBERS.find(
        (name) => ClientEvent[name as keyof typeof ClientEvent] === event,
    )!;
}

/** Source of a new handler: it receives the client first, then the event's arguments. */
export function handlerSource(event: ClientEvent, name: string): string {
    const fn = identifier(name.replace(/\.ts$/, ""));
    return `import type { Client, ClientEvents } from "lunibee";\n\n/** Handles the ${event} event. */\nexport default async function ${fn}(client: Client, ...args: ClientEvents["${event}"]): Promise<void> {\n  const [payload] = args;\n\n  // Add your ${event} logic here.\n  void client;\n  void payload;\n}\n`;
}

export interface Handler {
    event: ClientEvent;
    /** Path relative to src/events, e.g. `messageCreate/log.ts`. */
    file: string;
    /** Import path from src/handlers. */
    path: string;
    importName: string;
}

export interface Discovery {
    handlers: Handler[];
    /** Folders under src/events that are not a client event (typos). */
    unknownFolders: string[];
    /** Handler files without a default export (they would fail at import). */
    missingDefault: string[];
}

const SKIP = /\.(d|test|spec)\.[jt]s$/;

/** Finds handler files under `eventsDir`. A missing folder yields nothing. */
export async function discover(eventsDir: string): Promise<Discovery> {
    const result: Discovery = {
        handlers: [],
        unknownFolders: [],
        missingDefault: [],
    };
    let folders;
    try {
        folders = await readdir(eventsDir, { withFileTypes: true });
    } catch {
        return result;
    }
    const names = new Set<string>();
    for (const folder of folders) {
        if (!folder.isDirectory()) continue;
        if (!EVENTS.includes(folder.name as ClientEvent)) {
            result.unknownFolders.push(folder.name);
            continue;
        }
        const event = folder.name as ClientEvent;
        const seen = new Set<string>();
        // .ts before .js, so a.ts wins over a compiled a.js beside it.
        const files = (
            await readdir(join(eventsDir, folder.name), { withFileTypes: true })
        ).sort(
            (a, b) =>
                Number(a.name.endsWith(".js")) -
                    Number(b.name.endsWith(".js")) ||
                a.name.localeCompare(b.name),
        );
        for (const file of files) {
            if (
                !file.isFile() ||
                !/\.[jt]s$/.test(file.name) ||
                SKIP.test(file.name)
            )
                continue;
            const base = file.name.slice(0, -3);
            if (seen.has(base)) continue; // a.ts and a.js import the same path
            seen.add(base);
            const source = await Bun.file(
                join(eventsDir, folder.name, file.name),
            ).text();
            if (!/export\s+default\b|\bas\s+default\b/.test(source))
                result.missingDefault.push(`${event}/${file.name}`);
            let importName = identifier(`${event}_${base}`);
            for (let n = 2; names.has(importName); n++)
                importName = identifier(`${event}_${base}_${n}`);
            names.add(importName);
            result.handlers.push({
                event,
                file: `${event}/${file.name}`,
                path: `../events/${event}/${base}`,
                importName,
            });
        }
    }
    result.handlers.sort((a, b) => a.path.localeCompare(b.path));
    result.unknownFolders.sort();
    return result;
}

/** The generated src/handlers/event.ts for `handlers`. */
export function binderSource(handlers: readonly Handler[]): string {
    const imports = handlers
        .map((h) => `import ${h.importName} from "${h.path}";`)
        .join("\n");
    // Each handler gets the client first. `client as never` lets a handler
    // declare the bot's own Client subclass; the event arguments stay typed.
    const bindings = handlers
        .map(
            (h) =>
                `  client.on(ClientEvent.${eventMember(h.event)}, (...args) => ${h.importName}(client as never, ...args));`,
        )
        .join("\n");
    return `// Generated by \`lunibee create handler\` / \`lunibee sync handlers\`. Do not edit:\n// add, rename or remove files under src/events/<event>/ and run \`lunibee sync handlers\`.\nimport type { Client } from "lunibee";\nimport { ClientEvent } from "lunibee";\n${imports ? `\n${imports}` : ""}\n\n/** Registers every handler found under src/events with a Lunibee client. Each handler is called as handler(client, ...args). */\nexport function registerEvents(client: Client): void {\n${bindings}\n}\n`;
}

export const eventsDir = (root: string) => join(root, "src", "events");
export const binderPath = (root: string) =>
    join(root, "src", "handlers", "event.ts");

export interface BinderState {
    discovery: Discovery;
    expected: string;
    current: string | null;
    upToDate: boolean;
}

export async function binderState(root: string): Promise<BinderState> {
    const discovery = await discover(eventsDir(root));
    const expected = binderSource(discovery.handlers);
    const file = Bun.file(binderPath(root));
    const current = (await file.exists()) ? await file.text() : null;
    return { discovery, expected, current, upToDate: current === expected };
}

/** Prints warnings for typo folders and files without a default export. */
function warnDiscovery(io: IO, discovery: Discovery): void {
    for (const folder of discovery.unknownFolders) {
        const hint = closest(folder, EVENTS, 1)[0];
        io.err(
            `${paint(io, "yellow", "⚠")} events/${folder}/ is not a client event and is ignored${hint ? ` (did you mean ${hint}?)` : ""}`,
        );
    }
    for (const file of discovery.missingDefault)
        io.err(
            `${paint(io, "yellow", "⚠")} events/${file} has no default export`,
        );
}

export interface SyncOptions {
    dryRun?: boolean;
    /** Report only; exit code 1 when the binder is out of date. */
    check?: boolean;
}

/** `lunibee sync handlers`. @returns The exit code. */
export async function syncHandlers(
    io: IO,
    root: string,
    options: SyncOptions = {},
): Promise<number> {
    const state = await binderState(root);
    warnDiscovery(io, state.discovery);
    const count = state.discovery.handlers.length;
    const summary = `${count} handler${count === 1 ? "" : "s"}`;
    if (state.upToDate) {
        io.out(
            `${paint(io, "green", "✓")} handlers/event.ts is up to date (${summary})`,
        );
        return 0;
    }
    if (options.check) {
        io.err(
            `${paint(io, "red", "✗")} handlers/event.ts is out of date. Run \`lunibee sync handlers\`.`,
        );
        return 1;
    }
    if (options.dryRun) {
        io.out(`• would update handlers/event.ts (${summary})`);
        return 0;
    }
    await mkdir(join(root, "src", "handlers"), { recursive: true });
    await writeFile(binderPath(root), state.expected);
    io.out(`${paint(io, "green", "✓")} updated handlers/event.ts (${summary})`);
    return 0;
}

export interface CreateHandlerOptions {
    name?: string;
    force?: boolean;
    dryRun?: boolean;
}

/** Parses "1,3", "messageCreate, ready" or "all" against the event list. */
export function pickEvents(answer: string): ClientEvent[] {
    if (answer.trim().toLowerCase() === "all") return [...EVENTS];
    const picked = answer
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((part) => {
            const index = Number(part);
            if (Number.isInteger(index)) {
                const event = EVENTS[index - 1];
                if (!event) throw new CliError(`No event number ${part}.`);
                return event;
            }
            return resolveEvent(part);
        });
    return [...new Set(picked)];
}

/** `lunibee create handler [events…] [--name]`. @returns The exit code. */
export async function createHandlers(
    io: IO,
    root: string,
    inputs: readonly string[],
    options: CreateHandlerOptions = {},
): Promise<number> {
    let events: ClientEvent[];
    const interactive = inputs.length === 0;
    if (interactive) {
        if (!io.interactive)
            throw new CliError(
                "No event given.",
                "Pass one, e.g. `lunibee create handler messageCreate`, or run it in a terminal to pick from a list.",
            );
        io.out(`\n${paint(io, "bold", "🐝 Lunibee handler generator")}\n`);
        EVENTS.forEach((event, i) =>
            io.out(`  ${String(i + 1).padStart(3)}. ${event}`),
        );
        const answer = io
            .prompt("\nEvents (numbers or names, comma-separated, or all):")
            ?.trim();
        if (!answer) return 0;
        events = pickEvents(answer);
    } else events = pickEvents(inputs.join(","));
    if (!events.length) throw new CliError("No events were selected.");
    if (options.name && events.length > 1)
        throw new CliError(
            "--name applies to a single event.",
            "Create one event at a time, or drop --name.",
        );

    const dir = eventsDir(root);
    const existing = (await discover(dir)).handlers;
    let created = 0;
    for (const event of events) {
        const already = existing.filter((h) => h.event === event).length;
        let name = options.name ?? (already ? "handler" : event);
        if (interactive && !options.name) {
            if (already)
                io.out(`\n${event} already has ${already} handler(s).`);
            name =
                io.prompt(`Handler name for ${event} [${name}]:`)?.trim() ||
                name;
        }
        const file = fileName(name);
        const target = join(dir, event, file);
        if ((await Bun.file(target).exists()) && !options.force) {
            io.out(
                `${paint(io, "dim", "↳")} skipped events/${event}/${file} (exists; --force overwrites)`,
            );
            continue;
        }
        if (options.dryRun) {
            io.out(`• would create events/${event}/${file}`);
            continue;
        }
        await mkdir(join(dir, event), { recursive: true });
        await writeFile(target, handlerSource(event, name));
        io.out(`${paint(io, "green", "✓")} created events/${event}/${file}`);
        created++;
    }
    if (options.dryRun) return 0;
    return created || !(await binderState(root)).upToDate
        ? syncHandlers(io, root)
        : 0;
}

export { EVENTS };
