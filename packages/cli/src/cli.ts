import { resolve } from "node:path";
import { assertFlags, flag, parseArgs, value, type Args } from "./args.js";
import { createHandlers, resolveEvent, syncHandlers } from "./handlers.js";
import {
    check,
    doctor,
    info,
    list,
    LIST_KINDS,
    type ListKind,
} from "./inspect.js";
import { CliError, didYouMean, paint, type IO } from "./io.js";
import { publish, status } from "./maintainer.js";
import { migrateDeprecations } from "./deprecations.js";
import { fixHandlers } from "./migrate.js";
import { findProjectRoot } from "./project.js";
import { createCommand, createComponent } from "./scaffold.js";

export interface MainOptions {
    version: string;
    /** The Lunibee monorepo, for `status` and `publish`. */
    lunibeeRoot: string;
}

interface Context {
    io: IO;
    args: Args;
    /** Positionals after the command path. */
    rest: string[];
    root: string;
    options: MainOptions;
}

interface Command {
    path: string[];
    usage: string;
    summary: string;
    flags: string[];
    details?: string;
    run(ctx: Context): Promise<number>;
}

const COMMON = ["help", "cwd", "no-color"];

const COMMANDS: Command[] = [
    {
        path: ["create", "handler"],
        usage: "lunibee create handler [event…] [name] [--name <file>] [--force] [--dry-run]",
        summary:
            "Create src/events/<event>/<name>.ts and update src/handlers/event.ts",
        flags: ["name", "force", "dry-run"],
        details:
            "Events may be given as values (messageCreate), member names (MessageCreate), any case,\nor comma-separated. Without an event, pick from a numbered list (terminal only).\nHandlers are called as handler(client, ...args).",
        async run({ io, args, rest, root }) {
            let events = rest;
            let name = value(args, "name");
            // Compatibility: `create handler <event> <name>`.
            if (!name && rest.length === 2 && !isEvent(rest[1]!)) {
                events = [rest[0]!];
                name = rest[1];
            }
            return createHandlers(io, root, events, {
                name,
                force: flag(args, "force"),
                dryRun: flag(args, "dry-run"),
            });
        },
    },
    {
        path: ["handler"],
        usage: "lunibee handler [--fix] [--dry-run] [--json]",
        summary: "Find handlers not in the current format; --fix updates them",
        flags: ["fix", "dry-run", "json"],
        details:
            "Handlers from before 0.2.2 received only the event arguments. --fix adds a first\n`_client: Client` parameter (and the import), renames event folders whose case is wrong\n(messagecreate/ → messageCreate/), then regenerates src/handlers/event.ts. Handlers whose\nfirst parameter is already the client (named client/bot or typed as a Client) are left\nalone. Without --fix it only reports, exiting 1 when something needs fixing.",
        run: ({ io, args, root }) =>
            fixHandlers(io, root, {
                fix: flag(args, "fix"),
                dryRun: flag(args, "dry-run"),
                json: flag(args, "json"),
            }),
    },
    {
        path: ["migrate"],
        usage: "lunibee migrate [--fix] [--dry-run] [--json]",
        summary:
            "Find APIs removed in 0.3.0; --fix renames the old Lunibee names",
        flags: ["fix", "dry-run", "json"],
        details:
            "Checks every file under src/. --fix renames the pre-0.2.2 names (ButtonBuilder →\nCreateButton, ChannelType → ChannelEnum…) only where the file imports them from lunibee\nor @lunibee/*, so discord.js names are never touched, and Routes.channelPin →\nRoutes.channelMessagesPin. Calls that cannot be proven to be Lunibee's (deleteRole,\nsendMessage, bulkDelete, setDMPermission, Routes.channelPins, withExpiration…) are\nlisted with their replacement to change by hand. Exits 1 while anything is left.",
        run: ({ io, args, root }) =>
            migrateDeprecations(io, root, {
                fix: flag(args, "fix"),
                dryRun: flag(args, "dry-run"),
                json: flag(args, "json"),
            }),
    },
    {
        path: ["sync", "handlers"],
        usage: "lunibee sync handlers [--check] [--dry-run]",
        summary:
            "Regenerate src/handlers/event.ts from the files under src/events",
        flags: ["check", "dry-run"],
        details:
            "Writes only when the content changes. --check exits 1 when the file is out of date\n(for pre-commit hooks), without writing.",
        run: ({ io, args, root }) =>
            syncHandlers(io, root, {
                check: flag(args, "check"),
                dryRun: flag(args, "dry-run"),
            }),
    },
    {
        path: ["create", "command"],
        usage: "lunibee create command [name] [--description <text>] [--category <folder>] [--force] [--dry-run]",
        summary:
            "Create src/commands/[category/]<name>.ts with data and execute()",
        flags: ["description", "category", "force", "dry-run"],
        details:
            "The name follows Discord's rules: 1-32 lowercase letters, digits, - or _.",
        run: ({ io, args, rest, root }) =>
            createCommand(io, root, rest[0], {
                description: value(args, "description"),
                category: value(args, "category"),
                force: flag(args, "force"),
                dryRun: flag(args, "dry-run"),
            }),
    },
    {
        path: ["create", "component"],
        usage: "lunibee create component [button|select|modal] [name] [--force] [--dry-run]",
        summary:
            "Create src/components/<name>.ts with the builder and a handle() function",
        flags: ["force", "dry-run"],
        details:
            "The name is also the component's custom ID (1-100 of a-z A-Z 0-9 _ - : .).",
        run: ({ io, args, rest, root }) =>
            createComponent(io, root, rest[0], rest[1], {
                force: flag(args, "force"),
                dryRun: flag(args, "dry-run"),
            }),
    },
    {
        path: ["list"],
        usage: `lunibee list <${LIST_KINDS.join("|")}> [--json]`,
        summary: "List handlers, commands, components, or every client event",
        flags: ["json"],
        async run({ io, args, rest, root }) {
            const kind = rest[0];
            if (!kind || !LIST_KINDS.includes(kind as ListKind))
                throw new CliError(
                    kind ? `Unknown list: ${kind}` : "What should be listed?",
                    (kind && didYouMean(kind, LIST_KINDS)) ||
                        `Use one of: ${LIST_KINDS.join(", ")}.`,
                );
            return list(io, root, kind as ListKind, flag(args, "json"));
        },
    },
    {
        path: ["check"],
        usage: "lunibee check [--json]",
        summary:
            "Check the project layout, handler binder and .env safety (exit 1 on errors)",
        flags: ["json"],
        run: ({ io, args, root }) => check(io, root, flag(args, "json")),
    },
    {
        path: ["doctor"],
        usage: "lunibee doctor [--json]",
        summary:
            "Everything check does, plus Bun, installed versions and tsconfig",
        flags: ["json"],
        run: ({ io, args, root }) => doctor(io, root, flag(args, "json")),
    },
    {
        path: ["info"],
        usage: "lunibee info [--json]",
        summary:
            "Print the project, Lunibee versions, counts, runtime and CLI version",
        flags: ["json"],
        run: ({ io, args, root, options }) =>
            info(io, root, options.version, flag(args, "json")),
    },
    {
        path: ["status"],
        usage: "lunibee status [--json]",
        summary: "Maintainers: list the Lunibee monorepo packages and versions",
        flags: ["json"],
        run: ({ io, args, options }) =>
            status(io, options.lunibeeRoot, flag(args, "json")),
    },
    {
        path: ["publish"],
        usage: "lunibee publish [--dry-run] [--yes] [--tag <tag>] [--otp <code>]",
        summary:
            "Maintainers: publish every non-private package, dependencies first",
        flags: ["dry-run", "yes", "tag", "otp"],
        details:
            "Refuses mixed versions. Asks for confirmation unless --yes or --dry-run.",
        run: ({ io, args, options }) =>
            publish(io, options.lunibeeRoot, {
                dryRun: flag(args, "dry-run"),
                yes: flag(args, "yes"),
                tag: value(args, "tag"),
                otp: value(args, "otp"),
            }),
    },
];

function isEvent(input: string): boolean {
    try {
        resolveEvent(input);
        return true;
    } catch {
        return false;
    }
}

function find(positionals: readonly string[]): Command | undefined {
    if (positionals[0] === "handlers")
        positionals = ["handler", ...positionals.slice(1)];
    return COMMANDS.filter((c) =>
        c.path.every((part, i) => positionals[i] === part),
    ).sort((a, b) => b.path.length - a.path.length)[0];
}

function commandHelp(io: IO, command: Command): void {
    io.out(
        `${paint(io, "bold", "Usage:")} ${command.usage}\n\n${command.summary}.`,
    );
    if (command.details) io.out(`\n${command.details}`);
    io.out(
        `\nOptions:\n  --cwd <dir>   Run in another project directory\n  -h, --help    Show this help`,
    );
}

function help(io: IO, version: string, group?: string): void {
    const shown = group
        ? COMMANDS.filter((c) => c.path[0] === group)
        : COMMANDS;
    const width = Math.max(...shown.map((c) => c.path.join(" ").length));
    io.out(
        `${paint(io, "bold", "🐝 Lunibee CLI")} ${paint(io, "dim", `v${version}`)}\n\nUsage: lunibee <command> [options]\n\nCommands:`,
    );
    for (const c of shown)
        io.out(`  ${c.path.join(" ").padEnd(width)}  ${c.summary}`);
    io.out(
        `\nGlobal options:\n  --cwd <dir>    Run in another project directory\n  --no-color     Plain output (NO_COLOR is honoured too)\n  -h, --help     Help for a command, e.g. \`lunibee create handler --help\`\n  -v, --version  Print the CLI version`,
    );
}

/** Runs the CLI. @returns The process exit code. */
export async function main(
    argv: readonly string[],
    io: IO,
    options: MainOptions,
): Promise<number> {
    try {
        const args = parseArgs(argv);
        if (args.flags.has("no-color")) io = { ...io, color: false };
        const [first, ...others] = args.positionals;
        if (args.flags.has("version") && !first) {
            io.out(options.version);
            return 0;
        }
        if (!first || first === "help") {
            const target = find(others);
            if (target) commandHelp(io, target);
            else help(io, options.version, others[0]);
            return 0;
        }
        const command = find(args.positionals);
        if (!command) {
            const groups = [
                ...new Set(
                    COMMANDS.filter((c) => c.path.length > 1).map(
                        (c) => c.path[0]!,
                    ),
                ),
            ];
            if (groups.includes(first)) {
                if (args.flags.has("help") || !others[0]) {
                    help(io, options.version, first);
                    return args.flags.has("help") ? 0 : 1;
                }
                throw new CliError(
                    `Unknown command: ${first} ${others[0]}`,
                    didYouMean(
                        `${first} ${others[0]}`,
                        COMMANDS.map((c) => c.path.join(" ")),
                    ),
                );
            }
            throw new CliError(
                `Unknown command: ${first}`,
                didYouMean(first, [
                    ...new Set(COMMANDS.map((c) => c.path[0]!)),
                ]) ?? "Run `lunibee help`.",
            );
        }
        if (args.flags.has("help")) {
            commandHelp(io, command);
            return 0;
        }
        assertFlags(args, [...COMMON, ...command.flags]);
        const cwdFlag = value(args, "cwd");
        const start = cwdFlag ? resolve(io.cwd, cwdFlag) : io.cwd;
        const root = (await findProjectRoot(start)) ?? start;
        return await command.run({
            io,
            args,
            rest: args.positionals.slice(command.path.length),
            root,
            options,
        });
    } catch (error) {
        if (error instanceof CliError) {
            io.err(`${paint(io, "red", "✗")} ${error.message}`);
            if (error.hint) io.err(paint(io, "dim", `  ${error.hint}`));
            return 1;
        }
        io.err(
            `${paint(io, "red", "✗")} ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
        return 1;
    }
}
