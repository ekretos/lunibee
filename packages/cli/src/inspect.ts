import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ClientEvent } from "@lunibee/core";
import { CliError, paint, type IO } from "./io.js";
import {
    compareVersions,
    exists,
    installedVersion,
    lunibeeDependencies,
    readJSON,
    type PackageManifest,
} from "./project.js";

/** Every client event name, for `lunibee list events`. */
export const EVENTS: readonly string[] = Object.values(ClientEvent);

/**
 * The modules a `lunibee init` project loads from `dir` (recursively), as
 * paths relative to it: `.ts`/`.js` files, skipping declarations, tests, and
 * files and folders whose name starts with `_`.
 */
export async function sourceFiles(dir: string): Promise<string[]> {
    let entries: string[];
    try {
        entries = await readdir(dir, { recursive: true });
    } catch {
        return [];
    }
    return entries
        .map((entry) => entry.split("\\").join("/"))
        .filter(
            (entry) =>
                /\.[jt]s$/.test(entry) &&
                !/\.d\.ts$/.test(entry) &&
                !/\.(test|spec)\.[jt]s$/.test(entry) &&
                !entry.split("/").some((part) => part.startsWith("_")),
        )
        .sort();
}

export type ListKind = "handlers" | "commands" | "components" | "events";
export const LIST_KINDS: readonly ListKind[] = [
    "handlers",
    "commands",
    "components",
    "events",
];

/** `lunibee list <kind> [--json]`. */
export async function list(
    io: IO,
    root: string,
    kind: ListKind,
    json = false,
): Promise<number> {
    if (kind === "events") {
        if (json) io.out(JSON.stringify(EVENTS));
        else for (const event of EVENTS) io.out(event);
        return 0;
    }
    const folder = kind === "handlers" ? "events" : kind;
    const files = (await sourceFiles(join(root, "src", folder))).map((f) =>
        f.replace(/\.[jt]s$/, ""),
    );
    if (json) io.out(JSON.stringify(files));
    else if (!files.length) io.out(`No ${kind} found under src/${folder}.`);
    else for (const file of files) io.out(file);
    return 0;
}

export type Level = "ok" | "warn" | "error";
export interface Finding {
    level: Level;
    message: string;
    hint?: string;
}

/** Run in the project: loads its commands and events the way startup does, without logging in. */
const LOAD_SCRIPT = `
const { discoverCommands } = await import("./src/handlers/commands.ts");
const { discoverEvents } = await import("./src/handlers/events.ts");
const result = {};
try { result.commands = [...(await discoverCommands("src/commands")).values()].map((c) => c.data ? "/" + c.data.toJSON().name : c.name); }
catch (error) { result.commandError = String(error?.message ?? error); }
try { result.events = (await discoverEvents("src/events")).map(({ event }) => event.name); }
catch (error) { result.eventError = String(error?.message ?? error); }
console.log(JSON.stringify(result));
`;

/**
 * For a \`lunibee init\` project: imports every command and event module and
 * reports what fails validation (a missing export, a duplicate name…).
 */
async function loadModules(root: string): Promise<Finding[]> {
    if (!(await exists(join(root, "node_modules", "lunibee"))))
        return [
            {
                level: "warn",
                message:
                    "Commands and events not loaded: dependencies are not installed",
                hint: "Run `bun install`, then `lunibee check` again.",
            },
        ];
    const child = Bun.spawn(["bun", "-e", LOAD_SCRIPT], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        // Discovery needs no settings; never hand the token to module code here.
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    });
    const timer = setTimeout(() => child.kill(), 20_000);
    const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    clearTimeout(timer);
    let result: {
        commands?: string[];
        events?: string[];
        commandError?: string;
        eventError?: string;
    };
    try {
        result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
    } catch {
        return [
            {
                level: "error",
                message: "Could not load the commands and events",
                hint:
                    (stderr || stdout)
                        .trim()
                        .split("\n")
                        .slice(0, 3)
                        .join(" ") || undefined,
            },
        ];
    }
    const findings: Finding[] = [];
    findings.push(
        result.commandError
            ? { level: "error", message: result.commandError }
            : {
                  level: "ok",
                  message: `${result.commands!.length} command(s) load: ${
                      [...result.commands!].sort().join(", ") || "none"
                  }`,
              },
        result.eventError
            ? { level: "error", message: result.eventError }
            : {
                  level: "ok",
                  message: `${result.events!.length} event handler(s) load: ${[...new Set(result.events)].join(", ") || "none"}`,
              },
    );
    return findings;
}

const TOKEN_KEY = /^\s*(?:export\s+)?(DISCORD_TOKEN|BOT_TOKEN|TOKEN)\s*=\s*\S/m;

/** Whether .gitignore has a rule that ignores `.env`. */
function ignoresEnv(gitignore: string): boolean {
    return gitignore
        .split(/\r?\n/)
        .map((line) => line.trim())
        .some((line) =>
            [".env", ".env*", "*.env", "/.env", ".env.*", "**/.env"].includes(
                line,
            ),
        );
}

/** Project-structure findings shared by `check` and `doctor`. */
async function projectFindings(
    root: string,
    pkg: PackageManifest | null,
): Promise<Finding[]> {
    const findings: Finding[] = [];
    if (!pkg) {
        findings.push({
            level: "error",
            message: "package.json not found",
            hint: "Run `bun init`.",
        });
        return findings;
    }
    const deps = lunibeeDependencies(pkg);
    findings.push(
        Object.keys(deps).length
            ? {
                  level: "ok",
                  message: `Lunibee dependency (${Object.entries(deps)
                      .map(([n, v]) => `${n}@${v}`)
                      .join(", ")})`,
              }
            : {
                  level: "error",
                  message: "No Lunibee dependency",
                  hint: "Run `bun add lunibee`.",
              },
    );
    for (const dir of ["src", "src/events", "src/commands"])
        findings.push(
            (await exists(join(root, dir)))
                ? { level: "ok", message: dir }
                : {
                      level: dir === "src" ? "warn" : "ok",
                      message: `${dir} (not created yet)`,
                  },
        );
    // A `lunibee init` project finds its commands and events at runtime
    // (src/handlers/commands.ts and src/handlers/events.ts), in any folder layout.
    const loaders = ["src/handlers/commands.ts", "src/handlers/events.ts"];
    const missing: string[] = [];
    for (const file of loaders)
        if (!(await exists(join(root, file)))) missing.push(file);
    if (!missing.length) findings.push(...(await loadModules(root)));
    else
        findings.push({
            level: "warn",
            message: `${missing.join(" and ")} not found: commands and events not checked`,
            hint: "The CLI checks the `lunibee init` layout, which loads src/commands and src/events at runtime.",
        });
    if (await exists(join(root, "src", "handlers", "event.ts")))
        findings.push({
            level: "warn",
            message:
                "src/handlers/event.ts is a binder from the layout the CLI no longer generates (0.4.0)",
            hint: "Move to the `lunibee init` layout; see the upgrading guide.",
        });
    const envFile = Bun.file(join(root, ".env"));
    if (await envFile.exists()) {
        findings.push({ level: "ok", message: ".env" });
        // Only the key is looked for; the value is never read into output.
        if (!TOKEN_KEY.test(await envFile.text()))
            findings.push({
                level: "warn",
                message: ".env has no DISCORD_TOKEN (or TOKEN) entry",
            });
        const example = Bun.file(join(root, ".env.example"));
        if (await example.exists()) {
            const keys = (text: string) =>
                new Set(
                    [
                        ...text.matchAll(
                            /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm,
                        ),
                    ].map((m) => m[1]!),
                );
            const have = keys(await envFile.text());
            const missing = [...keys(await example.text())].filter(
                (key) => !have.has(key),
            );
            if (missing.length)
                findings.push({
                    level: "warn",
                    message: `.env is missing ${missing.join(", ")} from .env.example`,
                });
        }
        const gitignore = Bun.file(join(root, ".gitignore"));
        if (!(await gitignore.exists()) || !ignoresEnv(await gitignore.text()))
            findings.push({
                level: "error",
                message: ".env is not in .gitignore",
                hint: "Add `.env` to .gitignore so the token is never committed.",
            });
    } else
        findings.push({
            level: "warn",
            message: ".env not found",
            hint: "Put DISCORD_TOKEN=… in .env.",
        });
    return findings;
}

/** Runtime and installation findings for `doctor`. */
async function environmentFindings(
    root: string,
    pkg: PackageManifest,
    bunVersion: string,
): Promise<Finding[]> {
    const findings: Finding[] = [];
    const required = "1.4.0";
    findings.push(
        compareVersions(bunVersion, required) >= 0
            ? { level: "ok", message: `Bun ${bunVersion}` }
            : {
                  level: "error",
                  message: `Bun ${bunVersion} is older than ${required}`,
                  hint: "Run `bun upgrade`.",
              },
    );
    const installed = new Map<string, string>();
    for (const name of Object.keys(lunibeeDependencies(pkg))) {
        const version = await installedVersion(root, name);
        if (version) installed.set(name, version);
        else
            findings.push({
                level: "error",
                message: `${name} is not installed`,
                hint: "Run `bun install`.",
            });
    }
    const versions = new Set(installed.values());
    if (versions.size > 1)
        findings.push({
            level: "warn",
            message: `Mixed Lunibee versions installed: ${[...installed].map(([n, v]) => `${n}@${v}`).join(", ")}`,
            hint: "Keep every lunibee / @lunibee/* package on the same version.",
        });
    else if (versions.size === 1)
        findings.push({
            level: "ok",
            message: `Lunibee ${[...versions][0]} installed`,
        });
    const tsconfig = await readJSON<{ compilerOptions?: { strict?: boolean } }>(
        join(root, "tsconfig.json"),
    );
    if (tsconfig && !tsconfig.compilerOptions?.strict)
        findings.push({
            level: "warn",
            message: "tsconfig.json: strict is off",
            hint: 'Handler and event types are most useful with "strict": true.',
        });
    return findings;
}

function report(io: IO, findings: readonly Finding[], json: boolean): number {
    const failed = findings.some((f) => f.level === "error");
    if (json) {
        io.out(JSON.stringify({ ok: !failed, findings }));
        return failed ? 1 : 0;
    }
    const icon = {
        ok: paint(io, "green", "✓"),
        warn: paint(io, "yellow", "⚠"),
        error: paint(io, "red", "✗"),
    };
    for (const f of findings)
        io.out(
            `${icon[f.level]} ${f.message}${f.hint ? paint(io, "dim", ` — ${f.hint}`) : ""}`,
        );
    const errors = findings.filter((f) => f.level === "error").length;
    const warnings = findings.filter((f) => f.level === "warn").length;
    io.out(
        `\n${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`,
    );
    return failed ? 1 : 0;
}

/** `lunibee check`: project structure. Exit code 1 on errors. */
export async function check(
    io: IO,
    root: string,
    json = false,
): Promise<number> {
    const pkg = await readJSON<PackageManifest>(join(root, "package.json"));
    return report(io, await projectFindings(root, pkg), json);
}

/** `lunibee doctor`: structure plus runtime and installation. Exit code 1 on errors. */
export async function doctor(
    io: IO,
    root: string,
    json = false,
    bunVersion = Bun.version,
): Promise<number> {
    const pkg = await readJSON<PackageManifest>(join(root, "package.json"));
    const findings = await projectFindings(root, pkg);
    if (pkg)
        findings.push(...(await environmentFindings(root, pkg, bunVersion)));
    return report(io, findings, json);
}

/** `lunibee info [--json]`. */
export async function info(
    io: IO,
    root: string,
    cliVersion: string,
    json = false,
): Promise<number> {
    const pkg = await readJSON<PackageManifest>(join(root, "package.json"));
    if (!pkg)
        throw new CliError(
            "package.json not found.",
            "Run it inside a project, or pass --cwd.",
        );
    const lunibee: Record<
        string,
        { declared: string; installed: string | null }
    > = {};
    for (const [name, declared] of Object.entries(lunibeeDependencies(pkg)))
        lunibee[name] = {
            declared,
            installed: await installedVersion(root, name),
        };
    const data = {
        project: pkg.name ?? null,
        version: pkg.version ?? null,
        root,
        lunibee,
        handlers: (await sourceFiles(join(root, "src", "events"))).length,
        commands: (await sourceFiles(join(root, "src", "commands"))).length,
        components: (await sourceFiles(join(root, "src", "components"))).length,
        runtime: `Bun ${Bun.version}`,
        platform: `${process.platform}-${process.arch}`,
        cli: cliVersion,
    };
    if (json) {
        io.out(JSON.stringify(data));
        return 0;
    }
    const packages = Object.entries(lunibee)
        .map(
            ([n, v]) =>
                `${n}@${v.installed ?? `${v.declared} (not installed)`}`,
        )
        .join(", ");
    io.out(
        [
            paint(io, "bold", "🐝 Lunibee"),
            "",
            `Project:    ${data.project ?? "unknown"}${data.version ? `@${data.version}` : ""}`,
            `Root:       ${root}`,
            `Lunibee:    ${packages || "not a dependency"}`,
            `Handlers:   ${data.handlers}`,
            `Commands:   ${data.commands}`,
            `Components: ${data.components}`,
            `Runtime:    ${data.runtime} (${data.platform})`,
            `CLI:        @lunibee/cli@${cliVersion}`,
        ].join("\n"),
    );
    return 0;
}
