import { mkdir, readdir, stat as statPath, writeFile } from "node:fs/promises";
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

export interface InitTemplateOptions {
    /** Package name, also the README title. */
    name: string;
    /** Version range of `lunibee` to depend on. */
    lunibee: string;
    year?: number;
}

/** Every file of a new project, by path. Pure: writes nothing. */
export function initFiles(
    options: InitTemplateOptions,
): Record<string, string> {
    const fill = (template: string) =>
        template
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
    return {
        "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
        "tsconfig.json": tsconfig,
        ".env.example": env,
        ".gitignore": gitignore,
        "README.md": fill(readme),
        LICENSE: fill(license),
        "src/index.ts": index,
        "src/config.ts": config,
        "src/commands/info/ping.ts": ping,
        "src/events/message/messageCreate.ts": messageCreate,
        "src/events/interaction/interactionCreate.ts": interactionCreate,
        "src/handlers/commands.ts": commandsHandler,
        "src/handlers/events.ts": eventsHandler,
        "src/services/register.ts": register,
        "src/types/index.ts": types,
        "src/utils/logger.ts": logger,
    };
}

export interface InitOptions {
    force?: boolean;
    yes?: boolean;
    dryRun?: boolean;
    install?: boolean;
    /** The CLI's version: the generated project depends on `lunibee@^version`. */
    version: string;
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
    const files = initFiles({ name, lunibee: `^${options.version}` });

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

    for (const [path, source] of Object.entries(files)) {
        if (options.dryRun) {
            io.out(`• would create ${path}`);
            continue;
        }
        const file = join(directory, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, source);
        io.out(
            `${paint(io, "green", "✓")} ${existing.includes(path) ? "overwrote" : "created"} ${path}`,
        );
    }
    if (options.dryRun) return 0;

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
