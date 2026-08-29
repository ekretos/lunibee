#!/usr/bin/env bun

import { readdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "../..", "..");
const packagesDir = join(root, "packages");

/** Publishing configuration for a workspace package. */
interface PublishConfig {
    /** npm package access level. */
    access?: string;
    /** Optional package registry URL. */
    registry?: string;
}

/** Minimal package manifest fields required by the release CLI. */
interface PackageManifest {
    /** Package name. */
    name: string;
    /** Package version. */
    version: string;
    /** Whether the package is excluded from publishing. */
    private?: boolean;
    /** Optional npm publishing configuration. */
    publishConfig?: PublishConfig;
}

/** A publishable package and its filesystem location. */
interface PublishablePackage {
    /** Absolute package directory. */
    directory: string;
    /** Parsed package manifest. */
    manifest: PackageManifest;
}

/** Reads a package manifest when it exists and is valid JSON. @param directory Package directory. @returns Parsed manifest, or null when unavailable. */
async function readManifest(directory: string): Promise<PackageManifest | null> {
    try {
        const file = Bun.file(join(directory, "package.json"));
        if (!(await file.exists())) return null;
        return await file.json() as PackageManifest;
    } catch {
        return null;
    }
}

/** Finds all non-private workspace packages that can be published. @returns Publishable packages sorted by package name. */
async function getPublishablePackages(): Promise<PublishablePackage[]> {
    const entries = await readdir(packagesDir, { withFileTypes: true });
    const result: PublishablePackage[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = join(packagesDir, entry.name);
        const manifest = await readManifest(directory);
        if (!manifest?.name || !manifest.version || manifest.private) continue;
        result.push({ directory, manifest });
    }

    return result.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

/** Runs a child process and forwards its standard streams. @param command Executable and arguments. @param cwd Working directory. @returns A promise fulfilled when the command exits successfully. @throws {Error} If the command exits with a non-zero status. */
async function run(command: string[], cwd: string): Promise<void> {
    const childProcess = Bun.spawn(command, {
        cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: globalThis.process.env,
    });
    const exitCode = await childProcess.exited;
    if (exitCode !== 0) throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
}

/** Publishes every public workspace package in deterministic order. @returns A promise fulfilled after publishing completes. @throws {Error} If any package publication fails. */
async function publish(): Promise<void> {
    const packages = await getPublishablePackages();
    if (packages.length === 0) {
        console.log("No publishable packages found.");
        return;
    }

    console.log(`Publishing ${packages.length} Lunibee packages...`);

    for (const { directory, manifest } of packages) {
        console.log(`\n→ ${manifest.name}@${manifest.version}`);
        await run(["bun", "publish", "--access", manifest.publishConfig?.access ?? "public"], directory);
    }

    console.log("\n✓ Lunibee packages published successfully.");
}

/** Prints the names and versions of all publishable packages. @returns A promise fulfilled after status output is written. */
async function status(): Promise<void> {
    const packages = await getPublishablePackages();
    for (const { manifest } of packages) console.log(`${manifest.name}@${manifest.version}`);
}

const command = Bun.argv[2] ?? "help";

try {
    switch (command) {
        case "publish":
            await publish();
            break;
        case "status":
            await status();
            break;
        case "help":
        case "--help":
        case "-h":
            console.log("Lunibee CLI\n\nCommands:\n  lunibee publish   Publish all public workspace packages to npm\n  lunibee status    List publishable packages and versions");
            break;
        default:
            console.error(`Unknown command: ${command}`);
            globalThis.process.exit(1);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    globalThis.process.exit(1);
}
