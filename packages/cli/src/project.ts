import { dirname, join, resolve } from "node:path";

export interface PackageManifest {
    name?: string;
    version?: string;
    private?: boolean;
    workspaces?: string[];
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    engines?: Record<string, string>;
    publishConfig?: { access?: string };
}

/** Reads a JSON file; null when it is missing or not valid JSON. */
export async function readJSON<T>(path: string): Promise<T | null> {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    try {
        return (await file.json()) as T;
    } catch {
        return null;
    }
}

export async function exists(path: string): Promise<boolean> {
    try {
        return (await Bun.file(path).stat()) !== undefined;
    } catch {
        return false;
    }
}

/** The nearest directory at or above `start` holding a package.json, else null. */
export async function findProjectRoot(start: string): Promise<string | null> {
    let dir = resolve(start);
    for (;;) {
        if (await Bun.file(join(dir, "package.json")).exists()) return dir;
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/** Declared `lunibee` / `@lunibee/*` dependencies with their ranges. */
export function lunibeeDependencies(
    pkg: PackageManifest,
): Record<string, string> {
    const all = { ...pkg.devDependencies, ...pkg.dependencies };
    return Object.fromEntries(
        Object.entries(all).filter(
            ([name]) => name === "lunibee" || name.startsWith("@lunibee/"),
        ),
    );
}

/** The version installed under node_modules, or null. */
export async function installedVersion(
    root: string,
    name: string,
): Promise<string | null> {
    const pkg = await readJSON<PackageManifest>(
        join(root, "node_modules", name, "package.json"),
    );
    return pkg?.version ?? null;
}

/** Compares dotted numeric versions; ignores pre-release tags. */
export function compareVersions(a: string, b: string): number {
    const parts = (v: string) =>
        v
            .replace(/^[^\d]*/, "")
            .split(/[.-]/)
            .slice(0, 3)
            .map((n) => Number.parseInt(n, 10) || 0);
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++)
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
}
