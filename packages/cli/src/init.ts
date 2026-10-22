import {
    mkdir,
    mkdtemp,
    readdir,
    rename,
    rm,
    stat as statPath,
    writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import config from "../templates/init/config.ts.tmpl" with { type: "text" };
import env from "../templates/init/env.example.tmpl" with { type: "text" };
import gitignore from "../templates/init/gitignore.tmpl" with { type: "text" };
import commandsHandler from "../templates/init/handlers-commands.ts.tmpl" with { type: "text" };
import eventsHandler from "../templates/init/handlers-events.ts.tmpl" with { type: "text" };
import index from "../templates/init/index.ts.tmpl" with { type: "text" };
import interactionCreate from "../templates/init/interactionCreate.ts.tmpl" with { type: "text" };
import license from "../templates/init/LICENSE.tmpl" with { type: "text" };
import logger from "../templates/init/logger.ts.tmpl" with { type: "text" };
import messageCreate from "../templates/init/messageCreate.ts.tmpl" with { type: "text" };
import ping from "../templates/init/ping.ts.tmpl" with { type: "text" };
import readme from "../templates/init/README.md.tmpl" with { type: "text" };
import register from "../templates/init/register.ts.tmpl" with { type: "text" };
import tsconfig from "../templates/init/tsconfig.json.tmpl" with { type: "text" };
import types from "../templates/init/types.ts.tmpl" with { type: "text" };
import { CliError, paint, type IO } from "./io.js";
import { exists } from "./project.js";

/** npm's package name rule, unscoped: what `lunibee init <name>` accepts. */
const PACKAGE_NAME = /^[a-z0-9][a-z0-9._-]*$/;

/** Which commands a new project answers: slash, message (prefix) or both. */
export type CommandStyle = "slash" | "message" | "both";
export const COMMAND_STYLES: readonly CommandStyle[] = [
    "slash",
    "message",
    "both",
];

/**
 * Keeps or drops the `{{#slash}}…{{/slash}}` / `{{#message}}…{{/message}}`
 * blocks of a template (`{{^…}}` for the opposite). A block on its own lines
 * drops those lines; one inside a line drops only its text.
 */
export function renderTemplate(template: string, style: CommandStyle): string {
    const on: Record<string, boolean> = {
        slash: style !== "message",
        message: style !== "slash",
    };
    const keep = (sign: string, key: string) => on[key] === (sign === "#");
    let previous: string;
    do {
        previous = template;
        template = template.replace(
            /^[ \t]*\{\{([#^])(slash|message)\}\}\n([\s\S]*?)^[ \t]*\{\{\/\2\}\}\n/m,
            (_, sign: string, key: string, body: string) =>
                keep(sign, key) ? body : "",
        );
    } while (template !== previous);
    do {
        previous = template;
        template = template.replace(
            /\{\{([#^])(slash|message)\}\}(.*?)\{\{\/\2\}\}/g,
            (_, sign: string, key: string, body: string) =>
                keep(sign, key) ? body : "",
        );
    } while (template !== previous);
    return template;
}

export interface InitTemplateOptions {
    /** Package name, also the README title. */
    name: string;
    /** Version range of `lunibee` to depend on. */
    lunibee: string;
    /** Default `"slash"`. */
    commands?: CommandStyle;
    year?: number;
}

/** Every file of a new project, by path. Pure: writes nothing. */
export function initFiles(
    options: InitTemplateOptions,
): Record<string, string> {
    const style = options.commands ?? "slash";
    const fill = (template: string) =>
        renderTemplate(template, style)
            .replaceAll("{{name}}", options.name)
            .replaceAll(
                "{{year}}",
                String(options.year ?? new Date().getFullYear()),
            );
    const manifest = {
        name: options.name,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
            dev: "bun --watch src/index.ts",
            build: "bun -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\" && tsc -p tsconfig.json",
            start: "bun dist/index.js",
            typecheck: "tsc --noEmit -p tsconfig.json",
        },
        dependencies: { lunibee: options.lunibee },
        devDependencies: { "@types/bun": "^1.4.2", typescript: "^7.0.2" },
        engines: { bun: ">=1.4.0" },
        license: "MIT",
    };
    const slash = style !== "message";
    const message = style !== "slash";
    const files: Record<string, string | false> = {
        "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
        "tsconfig.json": tsconfig,
        ".env.example": fill(env),
        ".gitignore": gitignore,
        "README.md": fill(readme),
        LICENSE: fill(license),
        "src/index.ts": fill(index),
        "src/config.ts": fill(config),
        "src/commands/info/ping.ts": fill(ping),
        "src/events/message/messageCreate.ts": message && messageCreate,
        "src/events/interaction/interactionCreate.ts":
            slash && interactionCreate,
        "src/handlers/commands.ts": fill(commandsHandler),
        "src/handlers/events.ts": eventsHandler,
        "src/services/register.ts": slash && register,
        "src/types/index.ts": fill(types),
        "src/utils/logger.ts": logger,
    };
    return Object.fromEntries(
        Object.entries(files).filter(
            (entry): entry is [string, string] => entry[1] !== false,
        ),
    );
}

export interface InitOptions {
    force?: boolean;
    yes?: boolean;
    dryRun?: boolean;
    install?: boolean;
    /** Asked for in a terminal when missing; `"slash"` otherwise. */
    commands?: string;
    /** The CLI's version: the generated project depends on `lunibee@^version`. */
    version: string;
}

const STYLE_ANSWERS: Record<string, CommandStyle> = {
    "1": "slash",
    "2": "message",
    "3": "both",
    slash: "slash",
    message: "message",
    prefix: "message",
    both: "both",
};

/** `--commands`, or the answer to a prompt in a terminal; `"slash"` without one. */
function commandStyle(io: IO, input: string | undefined): CommandStyle | null {
    if (input === undefined) {
        if (!io.interactive) return "slash";
        io.out(
            "\n1. Slash commands (/ping)\n2. Message commands (!ping)\n3. Both",
        );
        const answer = io.prompt("Commands [1]:")?.trim().toLowerCase();
        if (answer === undefined) return null;
        if (answer === "") return "slash";
        input = answer;
    }
    const style = STYLE_ANSWERS[input.trim().toLowerCase()];
    if (!style)
        throw new CliError(
            `Unknown command type: ${input}`,
            `Use one of: ${COMMAND_STYLES.join(", ")}.`,
        );
    return style;
}

/** Validates the project name taken from the target folder. */
export function projectName(target: string): string {
    const name = basename(resolve(target));
    if (!PACKAGE_NAME.test(name) || name.length > 214)
        throw new CliError(
            `Invalid project name: ${name}`,
            "Use lowercase letters, digits, -, _ and ., starting with a letter or digit (it becomes the package name).",
        );
    return name;
}

/**
 * Writes every file to a staging folder next to `directory` first, so a failed
 * write (full disk, permissions) leaves nothing behind. A new project is then
 * moved into place in one rename; into an existing folder, file by file.
 */
async function writeStaged(
    directory: string,
    files: Record<string, string>,
    existed: boolean,
): Promise<void> {
    await mkdir(dirname(directory), { recursive: true });
    const staging = await mkdtemp(join(dirname(directory), ".lunibee-init-"));
    try {
        for (const [path, source] of Object.entries(files)) {
            await mkdir(dirname(join(staging, path)), { recursive: true });
            await writeFile(join(staging, path), source);
        }
        if (!existed) {
            await rename(staging, directory);
            return;
        }
        for (const path of Object.keys(files)) {
            await mkdir(dirname(join(directory, path)), { recursive: true });
            await rename(join(staging, path), join(directory, path));
        }
    } finally {
        await rm(staging, { recursive: true, force: true });
    }
}

/** `lunibee init [directory]`: writes a new project into `directory`. */
export async function initProject(
    io: IO,
    start: string,
    input: string | undefined,
    options: InitOptions,
): Promise<number> {
    let target = input?.trim();
    if (!target) {
        if (!io.interactive)
            throw new CliError(
                "Missing project directory.",
                "Usage: lunibee init <directory>",
            );
        target = io.prompt("Project name:")?.trim();
        if (!target) return 1;
    }
    const directory = resolve(start, target);
    const name = projectName(directory);
    const commands = commandStyle(io, options.commands);
    if (!commands) return 1;
    const files = initFiles({ name, lunibee: `^${options.version}`, commands });

    const stat = await statPath(directory).catch(() => null);
    if (stat && !stat.isDirectory())
        throw new CliError(`${target} exists and is not a directory.`);
    const existing: string[] = [];
    for (const path of Object.keys(files))
        if (await exists(join(directory, path))) existing.push(path);
    if (existing.length) {
        if (!options.force)
            throw new CliError(
                `${target} already has ${existing.length === 1 ? "a file" : "files"} this would overwrite: ${existing.join(", ")}.`,
                "Choose another directory, or pass --force to overwrite them.",
            );
        if (!options.yes && !options.dryRun) {
            if (!io.interactive)
                throw new CliError(
                    `--force would overwrite ${existing.length} file(s) in ${target}.`,
                    "Pass --yes as well to confirm without a prompt.",
                );
            const answer = io
                .prompt(`Overwrite ${existing.join(", ")}? [y/N]`)
                ?.trim()
                .toLowerCase();
            if (answer !== "y" && answer !== "yes") {
                io.out("Nothing written.");
                return 1;
            }
        }
    } else if (stat && (await readdir(directory)).length && !options.dryRun)
        io.out(
            paint(
                io,
                "dim",
                `• ${target} is not empty; its other files are left alone.`,
            ),
        );

    if (options.dryRun) {
        for (const path of Object.keys(files)) io.out(`• would create ${path}`);
        return 0;
    }
    await writeStaged(directory, files, stat !== null);
    for (const path of Object.keys(files))
        io.out(
            `${paint(io, "green", "✓")} ${existing.includes(path) ? "overwrote" : "created"} ${path}`,
        );
    const shown = relative(start, directory) || ".";
    if (options.install) {
        io.out(`\nInstalling dependencies…`);
        const code = await io.run(["bun", "install"], directory);
        if (code !== 0) {
            io.err(
                `${paint(io, "red", "✗")} bun install failed (exit ${code}). Run it again in ${shown}.`,
            );
            return code;
        }
    }
    io.out(
        `\n${paint(io, "bold", `🐝 ${name} is ready.`)}\n\nNext steps:\n${[
            shown === "." ? undefined : `cd ${shown}`,
            options.install ? undefined : "bun install",
            "cp .env.example .env   # then fill in DISCORD_TOKEN and CLIENT_ID",
            "bun run dev",
        ]
            .filter(Boolean)
            .map((step) => `  ${step}`)
            .join("\n")}`,
    );
    return 0;
}
