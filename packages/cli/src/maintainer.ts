import { readdir } from "node:fs/promises";
import { exists } from "./project.js";
import { join } from "node:path";
import { CliError, paint, type IO } from "./io.js";
import { readJSON, type PackageManifest } from "./project.js";

export interface WorkspacePackage {
    dir: string;
    manifest: PackageManifest & { name: string; version: string };
}

/** Every package under `<root>/packages` with a name and version. */
export async function workspacePackages(
    root: string,
): Promise<WorkspacePackage[]> {
    const result: WorkspacePackage[] = [];
    let entries;
    try {
        entries = await readdir(join(root, "packages"), {
            withFileTypes: true,
        });
    } catch {
        throw new CliError(
            `No packages folder in ${root}.`,
            "status and publish run from the Lunibee monorepo.",
        );
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = join(root, "packages", entry.name);
        const manifest = await readJSON<PackageManifest>(
            join(dir, "package.json"),
        );
        if (manifest?.name && manifest.version)
            result.push({
                dir,
                manifest: manifest as WorkspacePackage["manifest"],
            });
    }
    return result.sort((a, b) =>
        a.manifest.name.localeCompare(b.manifest.name),
    );
}

/** Dependencies first, so no package is published before one it needs. */
export function publishOrder(
    packages: readonly WorkspacePackage[],
): WorkspacePackage[] {
    const byName = new Map(packages.map((p) => [p.manifest.name, p]));
    const ordered: WorkspacePackage[] = [];
    const state = new Map<string, "visiting" | "done">();
    const visit = (pkg: WorkspacePackage): void => {
        const name = pkg.manifest.name;
        if (state.get(name) === "done") return;
        if (state.get(name) === "visiting")
            throw new CliError(`Dependency cycle through ${name}.`);
        state.set(name, "visiting");
        for (const dep of Object.keys(pkg.manifest.dependencies ?? {})) {
            const target = byName.get(dep);
            if (target) visit(target);
        }
        state.set(name, "done");
        ordered.push(pkg);
    };
    for (const pkg of packages) visit(pkg);
    return ordered;
}

/** Every file a manifest points at (bin, main, module, types, exports), relative to its folder. */
export function entryFiles(manifest: PackageManifest): string[] {
    const found = new Set<string>();
    const add = (value: unknown): void => {
        if (typeof value === "string") {
            if (!value.endsWith("package.json"))
                found.add(value.replace(/^\.\//, ""));
        } else if (value && typeof value === "object")
            for (const nested of Object.values(value)) add(nested);
    };
    add(manifest.bin);
    add(manifest.main);
    add(manifest.module);
    add(manifest.types);
    add(manifest.exports);
    return [...found].sort();
}

/** Problems that would publish a broken package: missing entry files, bins without a shebang. */
export async function entryProblems(
    dir: string,
    manifest: PackageManifest,
): Promise<string[]> {
    const problems: string[] = [];
    for (const file of entryFiles(manifest))
        if (!(await exists(join(dir, file))))
            problems.push(`${manifest.name}: ${file} is missing`);
    const bins =
        typeof manifest.bin === "string"
            ? [manifest.bin]
            : Object.values(manifest.bin ?? {});
    for (const bin of bins) {
        const path = join(dir, bin);
        if (
            (await exists(path)) &&
            !(await Bun.file(path).text()).startsWith("#!")
        )
            problems.push(
                `${manifest.name}: ${bin.replace(/^\.\//, "")} has no #! line, so it cannot run as a command`,
            );
    }
    return problems;
}

/**
 * Runs each package's `build` script, then checks its entry files. npm drops a
 * `bin` whose file is missing when it reads package.json, which happens before
 * `prepublishOnly`, so building must come first.
 */
export async function preparePackages(
    io: IO,
    packages: readonly WorkspacePackage[],
): Promise<void> {
    for (const { dir, manifest } of packages)
        if (manifest.scripts?.build) {
            io.out(`• building ${manifest.name}`);
            const code = await io.run(["bun", "run", "build"], dir);
            if (code !== 0)
                throw new CliError(
                    `Building ${manifest.name} failed (exit ${code}).`,
                );
        }
    const problems = (
        await Promise.all(packages.map((p) => entryProblems(p.dir, p.manifest)))
    ).flat();
    if (problems.length)
        throw new CliError(
            `Refusing to publish broken packages:\n  ${problems.join("\n  ")}`,
            "Fix the build (or the package.json paths) and rerun.",
        );
}

/** Versions of the publishable packages, when they differ. */
function mismatch(packages: readonly WorkspacePackage[]): string | null {
    const versions = new Set(packages.map((p) => p.manifest.version));
    return versions.size > 1
        ? packages
              .map((p) => `${p.manifest.name}@${p.manifest.version}`)
              .join(", ")
        : null;
}

/** `lunibee status [--json]`. */
export async function status(
    io: IO,
    root: string,
    json = false,
): Promise<number> {
    const all = await workspacePackages(root);
    const publishable = all.filter((p) => !p.manifest.private);
    const mixed = mismatch(publishable);
    if (json) {
        io.out(
            JSON.stringify({
                packages: all.map((p) => ({
                    name: p.manifest.name,
                    version: p.manifest.version,
                    private: Boolean(p.manifest.private),
                })),
                consistent: !mixed,
            }),
        );
        return 0;
    }
    const width = Math.max(...all.map((p) => p.manifest.name.length), 0);
    for (const { manifest } of all)
        io.out(
            `${manifest.name.padEnd(width)}  ${manifest.version}${manifest.private ? paint(io, "dim", "  (private)") : ""}`,
        );
    if (mixed)
        io.err(
            `${paint(io, "yellow", "⚠")} publishable packages have different versions`,
        );
    return 0;
}

export interface PublishOptions {
    dryRun?: boolean;
    yes?: boolean;
    tag?: string;
    otp?: string;
}

/** `lunibee publish`: every non-private package, dependencies first. */
export async function publish(
    io: IO,
    root: string,
    options: PublishOptions = {},
): Promise<number> {
    const list = publishOrder(
        (await workspacePackages(root)).filter((p) => !p.manifest.private),
    );
    if (!list.length) {
        io.out("No publishable packages found.");
        return 0;
    }
    const mixed = mismatch(list);
    if (mixed)
        throw new CliError(
            `Refusing to publish mixed versions: ${mixed}`,
            "Bump every package to the same version first.",
        );
    if (options.tag !== undefined && !/^[a-z][a-z0-9._-]*$/i.test(options.tag))
        throw new CliError(`Invalid dist-tag: ${options.tag}`);
    await preparePackages(io, list);
    const version = list[0]!.manifest.version;
    io.out(
        `${options.dryRun ? "Dry run: " : ""}publishing ${list.length} packages at ${version}${options.tag ? ` (tag ${options.tag})` : ""}:`,
    );
    for (const { manifest } of list) io.out(`  ${manifest.name}`);
    if (!options.dryRun && !options.yes) {
        if (!io.interactive)
            throw new CliError(
                "Publishing needs confirmation.",
                "Pass --yes to publish without a prompt.",
            );
        const answer = io
            .prompt(`Publish ${version} to npm? [y/N]`)
            ?.trim()
            .toLowerCase();
        if (answer !== "y" && answer !== "yes") {
            io.out("Cancelled.");
            return 1;
        }
    }
    for (const { dir, manifest } of list) {
        io.out(`→ ${manifest.name}@${manifest.version}`);
        const command = [
            "bun",
            "publish",
            "--access",
            manifest.publishConfig?.access ?? "public",
        ];
        if (options.dryRun) command.push("--dry-run");
        if (options.tag) command.push("--tag", options.tag);
        if (options.otp) command.push("--otp", options.otp);
        const code = await io.run(command, dir);
        if (code !== 0)
            throw new CliError(
                `Publishing ${manifest.name} failed (exit ${code}).`,
                "Packages before it were published; fix the error and rerun for the rest.",
            );
    }
    io.out(
        `${paint(io, "green", "✓")} ${options.dryRun ? "dry run complete" : `published ${list.length} packages`}`,
    );
    return 0;
}
