import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { binderState, EVENTS } from "./handlers.js";
import { CliError, paint, type IO } from "./io.js";
import {
    compareVersions,
    exists,
    installedVersion,
    lunibeeDependencies,
    readJSON,
    type PackageManifest,
} from "./project.js";

/** `.ts`/`.js` files under `dir`, recursively, as paths relative to it. */
async function sourceFiles(dir: string): Promise<string[]> {
    const found: string[] = [];
    const walk = async (current: string): Promise<void> => {
        let entries;
        try {
            entries = await readdir(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) await walk(path);
            else if (
                /\.[jt]s$/.test(entry.name) &&
                !/\.d\.ts$/.test(entry.name)
            )
                found.push(relative(dir, path).split("\\").join("/"));
        }
    };
    await walk(dir);
    return found.sort();
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
    if (kind === "handlers") {
        const { discovery } = await binderState(root);
        const grouped = new Map<string, string[]>();
        for (const h of discovery.handlers)
            grouped.set(h.event, [
                ...(grouped.get(h.event) ?? []),
                h.file.slice(h.event.length + 1),
            ]);
        if (json) {
            io.out(
                JSON.stringify({
                    handlers: Object.fromEntries(grouped),
                    ignoredFolders: discovery.unknownFolders,
                }),
            );
            return 0;
        }
        if (!grouped.size) io.out("No handlers found under src/events.");
        for (const [event, files] of grouped) {
            io.out(event);
            for (const file of files) io.out(`  └─ ${file}`);
        }
        for (const folder of discovery.unknownFolders)
            io.out(
                paint(io, "yellow", `${folder}/ (ignored: not a client event)`),
            );
        return 0;
    }
    const files = (await sourceFiles(join(root, "src", kind))).map((f) =>
        f.replace(/\.[jt]s$/, ""),
    );
    if (json) io.out(JSON.stringify(files));
    else if (!files.length) io.out(`No ${kind} found under src/${kind}.`);
    else for (const file of files) io.out(file);
    return 0;
}

export type Level = "ok" | "warn" | "error";
export interface Finding {
    level: Level;
    message: string;
    hint?: string;
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
    if (await exists(join(root, "src", "events"))) {
        const state = await binderState(root);
        for (const folder of state.discovery.unknownFolders)
            findings.push({
                level: "warn",
                message: `src/events/${folder}/ is not a client event and is ignored`,
            });
        for (const file of state.discovery.missingDefault)
            findings.push({
                level: "error",
                message: `src/events/${file} has no default export`,
            });
        findings.push(
            state.upToDate
                ? {
                      level: "ok",
                      message: `src/handlers/event.ts in sync (${state.discovery.handlers.length} handlers)`,
                  }
                : {
                      level: "warn",
                      message: "src/handlers/event.ts is out of date",
                      hint: "Run `lunibee sync handlers`.",
                  },
        );
    }
    const envFile = Bun.file(join(root, ".env"));
    if (await envFile.exists()) {
        findings.push({ level: "ok", message: ".env" });
        // Only the key is looked for; the value is never read into output.
        if (!TOKEN_KEY.test(await envFile.text()))
            findings.push({
                level: "warn",
                message: ".env has no DISCORD_TOKEN (or TOKEN) entry",
            });
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
    const required = "1.2.0";
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
    const state = await binderState(root);
    const data = {
        project: pkg.name ?? null,
        version: pkg.version ?? null,
        root,
        lunibee,
        handlers: state.discovery.handlers.length,
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
