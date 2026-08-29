/** Dependency-graph validation for the Lunibee monorepo. */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Metadata loaded from one workspace package manifest. */
interface PackageManifest {
    /** Package name used by dependency specifiers. */
    name: string;
    /** Package directory relative to the repository root. */
    directory: string;
    /** Runtime dependency names. */
    dependencies: string[];
    /** Development-only dependency names. */
    devDependencies: string[];
}

/** Dependency layers required by the public architecture. */
const REQUIRED_LAYERS: Readonly<Record<string, number>> = {
    "@lunibee/types": 0,
    "@lunibee/structures": 1,
    "@lunibee/managers": 2,
    "@lunibee/core": 3,
    lunibee: 4,
};

/** Loads every package manifest under the workspace directory. @returns Workspace manifests. @throws {Error} If a manifest cannot be read or parsed. */
async function loadManifests(): Promise<Map<string, PackageManifest>> {
    const packagesRoot = join(process.cwd(), "packages");
    const entries = await readdir(packagesRoot, { withFileTypes: true });
    const manifests = new Map<string, PackageManifest>();

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = join("packages", entry.name);
        const manifestPath = join(process.cwd(), directory, "package.json");
        const manifest = JSON.parse(await Bun.file(manifestPath).text()) as {
            name?: unknown;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        if (typeof manifest.name !== "string" || !manifest.name) {
            throw new Error(`Invalid package name in ${manifestPath}`);
        }
        manifests.set(manifest.name, {
            name: manifest.name,
            directory,
            dependencies: Object.keys(manifest.dependencies ?? {}),
            devDependencies: Object.keys(manifest.devDependencies ?? {}),
        });
    }

    return manifests;
}

/** Validates that every internal dependency points at an existing workspace package. @param manifests Workspace manifests. @throws {Error} If an internal dependency is missing. */
function validateDependencyTargets(manifests: Map<string, PackageManifest>): void {
    for (const manifest of manifests.values()) {
        for (const dependency of [...manifest.dependencies, ...manifest.devDependencies]) {
            if (!dependency.startsWith("@lunibee/") && dependency !== "lunibee") continue;
            if (!manifests.has(dependency)) {
                throw new Error(`${manifest.name} references missing workspace package ${dependency}`);
            }
        }
    }
}

/** Validates the required architectural layer ordering. @param manifests Workspace manifests. @throws {Error} If a layered package depends on a higher layer. */
function validateLayerOrdering(manifests: Map<string, PackageManifest>): void {
    for (const [packageName, layer] of Object.entries(REQUIRED_LAYERS)) {
        const manifest = manifests.get(packageName);
        if (!manifest) throw new Error(`Required architectural package ${packageName} is missing.`);
        for (const dependency of manifest.dependencies) {
            const dependencyLayer = REQUIRED_LAYERS[dependency];
            if (dependencyLayer !== undefined && dependencyLayer > layer) {
                throw new Error(`Invalid dependency edge: ${packageName} (layer ${layer}) -> ${dependency} (layer ${dependencyLayer})`);
            }
        }
    }
}

/** Detects cycles in the complete internal workspace dependency graph. @param manifests Workspace manifests. @throws {Error} If a dependency cycle exists. */
function validateAcyclicGraph(manifests: Map<string, PackageManifest>): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    /** Walks one dependency branch. @param packageName Package currently being visited. @param path Current dependency path. @throws {Error} If a cycle is found. */
    function visit(packageName: string, path: string[]): void {
        if (visiting.has(packageName)) {
            const cycleStart = path.indexOf(packageName);
            const cycle = [...path.slice(cycleStart), packageName].join(" -> ");
            throw new Error(`Circular workspace dependency detected: ${cycle}`);
        }
        if (visited.has(packageName)) return;

        const manifest = manifests.get(packageName);
        if (!manifest) return;
        visiting.add(packageName);
        for (const dependency of manifest.dependencies) {
            if (manifests.has(dependency)) visit(dependency, [...path, packageName]);
        }
        visiting.delete(packageName);
        visited.add(packageName);
    }

    for (const packageName of manifests.keys()) visit(packageName, []);
}

/** Runs all dependency graph checks. @returns Nothing. @throws {Error} If the workspace graph is invalid. */
async function main(): Promise<void> {
    const manifests = await loadManifests();
    validateDependencyTargets(manifests);
    validateLayerOrdering(manifests);
    validateAcyclicGraph(manifests);
    console.log(`Dependency graph valid: ${manifests.size} workspace packages, no invalid layer edges, no cycles.`);
}

await main();
