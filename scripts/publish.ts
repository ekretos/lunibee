/**
 * Publishes every public workspace package, then the root `lunibee` package, to npm.
 *
 *   bun run publish:all                 # build, verify, publish
 *   bun run publish:all -- --dry-run    # everything except the upload
 *   bun run publish:all -- --otp 123456 # extra flags go to `npm publish`
 *
 * Order of work, so a broken tarball never reaches npm:
 * 1. build every package with a `build` script (and the root with `build:all`);
 * 2. check that every file package.json points at exists and every bin has a `#!` line
 *    (npm silently drops a `bin` whose file is missing);
 * 3. publish dependencies first, skipping versions already on npm, so a failed run can
 *    simply be rerun.
 */
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    entryProblems,
    preparePackages,
    publishOrder,
    workspacePackages,
    type WorkspacePackage,
} from "../packages/cli/src/maintainer.ts";
import { CliError, type IO } from "../packages/cli/src/io.ts";

const ROOT = join(import.meta.dir, "..");
const npmArgs = process.argv.slice(2);
const dryRun = npmArgs.includes("--dry-run");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const io: IO = {
    cwd: ROOT,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    prompt: () => null,
    interactive: false,
    color: false,
    run: async (command, cwd) =>
        Bun.spawn(command, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited,
};

/** Whether name@version is already on the registry. */
function published(name: string, version: string): boolean {
    const result = spawnSync(npm, ["view", `${name}@${version}`, "version"], {
        cwd: ROOT,
        encoding: "utf8",
        shell: process.platform === "win32",
    });
    return result.status === 0 && result.stdout.trim() === version;
}

/** Publishes one folder with workspace:/file: ranges replaced by real versions, then restores package.json. */
async function publishOne(dir: string, versions: Map<string, string>): Promise<void> {
    const path = join(dir, "package.json");
    const original = await readFile(path, "utf8");
    const pkg = JSON.parse(original) as Record<string, unknown> & { name: string; version: string };
    if (!dryRun && published(pkg.name, pkg.version)) {
        console.log(`↳ ${pkg.name}@${pkg.version} is already on npm, skipping`);
        return;
    }
    let modified = false;
    for (const type of ["dependencies", "devDependencies", "peerDependencies"]) {
        const deps = pkg[type] as Record<string, string> | undefined;
        for (const [name, range] of Object.entries(deps ?? {}))
            if ((range.startsWith("workspace:") || range.startsWith("file:")) && versions.has(name)) {
                deps![name] = `^${versions.get(name)}`;
                modified = true;
            }
    }
    console.log(`\n🚀 ${pkg.name}@${pkg.version}`);
    try {
        if (modified) await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`);
        const args = ["publish", ...npmArgs];
        if (pkg.name.startsWith("@") && !npmArgs.includes("--access")) args.push("--access", "public");
        const result = spawnSync(npm, args, { cwd: dir, stdio: "inherit", shell: process.platform === "win32" });
        if (result.status !== 0) throw new CliError(`Publishing ${pkg.name} failed (exit ${result.status}).`);
    } finally {
        if (modified) await writeFile(path, original);
    }
}

try {
    const packages = publishOrder((await workspacePackages(ROOT)).filter((p) => !p.manifest.private));
    const root: WorkspacePackage = {
        dir: ROOT,
        manifest: JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")),
    };
    const versions = new Map([...packages, root].map((p) => [p.manifest.name, p.manifest.version]));
    const mixed = new Set(versions.values());
    if (mixed.size > 1)
        throw new CliError(`Mixed versions: ${[...versions].map(([n, v]) => `${n}@${v}`).join(", ")}`);

    await preparePackages(io, packages);
    console.log("• building lunibee (root)");
    if ((await io.run(["bun", "run", "build:all"], ROOT)) !== 0) throw new CliError("Building the root package failed.");
    const rootProblems = await entryProblems(ROOT, root.manifest);
    if (rootProblems.length) throw new CliError(`Refusing to publish:\n  ${rootProblems.join("\n  ")}`);

    for (const { dir } of packages) await publishOne(dir, versions);
    await publishOne(ROOT, versions);
    console.log(`\n🎉 ${dryRun ? "Dry run complete" : `Published ${packages.length + 1} packages`}.`);
} catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof CliError && error.hint) console.error(`   ${error.hint}`);
    process.exit(1);
}
