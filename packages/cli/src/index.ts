#!/usr/bin/env bun

import { readdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "../..", "..");
const packagesDir = join(root, "packages");

interface PackageManifest {
    name: string;
    version: string;
    private?: boolean;
    publishConfig?: { access?: string; registry?: string };
}

async function readManifest(directory: string): Promise<PackageManifest | null> {
    try {
        const file = Bun.file(join(directory, "package.json"));
        if (!(await file.exists())) return null;
        return await file.json() as PackageManifest;
    } catch {
        return null;
    }
}

async function getPublishablePackages(): Promise<Array<{ directory: string; manifest: PackageManifest }>> {
    const entries = await readdir(packagesDir, { withFileTypes: true });
    const result: Array<{ directory: string; manifest: PackageManifest }> = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = join(packagesDir, entry.name);
        const manifest = await readManifest(directory);
        if (!manifest?.name || !manifest.version || manifest.private) continue;
        result.push({ directory, manifest });
    }

    return result.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

async function run(command: string[], cwd: string): Promise<void> {
    const process = Bun.spawn(command, {
        cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
    });
    const exitCode = await process.exited;
    if (exitCode !== 0) throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
}

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
            process.exit(1);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
