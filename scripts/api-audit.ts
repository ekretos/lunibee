const root = new URL("../", import.meta.url);
const packages = ["core", "rest", "ws", "structures", "builders", "collection", "managers", "sharding", "voice", "types"];
const failures: string[] = [];

function fail(message: string): void {
    failures.push(message);
}

const rootPackage = await Bun.file(new URL("../package.json", import.meta.url)).json() as {
    type?: string;
    workspaces?: string[];
    scripts?: Record<string, string>;
};

if (rootPackage.type !== "module") fail("root package must remain ESM");
if (!rootPackage.workspaces?.includes("packages/*")) fail("workspace must include packages/*");
if (rootPackage.scripts?.["audit:api"] !== "bun scripts/api-audit.ts") fail("audit:api script must point to scripts/api-audit.ts");

for (const name of packages) {
    const packageURL = new URL(`../packages/${name}/`, import.meta.url);
    const entry = new URL("src/index.ts", packageURL);
    const manifestURL = new URL("package.json", packageURL);
    const entryFile = Bun.file(entry);
    const manifestFile = Bun.file(manifestURL);

    if (!(await entryFile.exists())) {
        fail(`missing public entrypoint: packages/${name}/src/index.ts`);
        continue;
    }
    if (!(await manifestFile.exists())) {
        fail(`missing package manifest: packages/${name}/package.json`);
        continue;
    }

    const source = await entryFile.text();
    const manifest = await manifestFile.json() as {
        name?: string;
        type?: string;
        module?: string;
        types?: string;
        exports?: string | Record<string, unknown>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
    };

    if (manifest.name !== `@lunibee/${name}`) fail(`package ${name} has an unexpected package name`);
    if (manifest.type !== "module") fail(`package ${name} must remain ESM`);
    if (manifest.module !== "./src/index.ts") fail(`package ${name} must expose ./src/index.ts as its module entry`);
    if (manifest.types !== "./src/index.ts") fail(`package ${name} must expose ./src/index.ts as its type entry`);

    if (typeof manifest.exports !== "object" || manifest.exports === null || manifest.exports["."] !== "./src/index.ts") {
        fail(`package ${name} must expose only the public '.' entrypoint`);
    } else if (Object.keys(manifest.exports).some(key => key !== ".")) {
        fail(`package ${name} exposes a non-public export subpath`);
    }

    const dependencies = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies
    };
    for (const dependency of Object.keys(dependencies)) {
        if (dependency.startsWith("@lunibee/") && dependency !== `@lunibee/${name}` && dependencies[dependency] !== "workspace:*") {
            fail(`package ${name} must use workspace:* for local dependency ${dependency}`);
        }
    }

    if (/from\s+["'](?:\.\.?\/)+packages\//.test(source)) {
        fail(`package ${name} public entrypoint reaches across packages/ directly`);
    }
}

const tempDir = new URL("../.api-audit-dts/", import.meta.url);
await new Bun.Glob("**/*").scan({ cwd: tempDir.pathname }).catch(() => []);
await Bun.write(new URL(".gitkeep", tempDir), "");

const tsc = Bun.spawnSync([
    "bunx",
    "--bun",
    "tsc",
    "--declaration",
    "--emitDeclarationOnly",
    "--noEmitOnError",
    "false",
    "--outDir",
    tempDir.pathname
], { cwd: root.pathname, stdout: "pipe", stderr: "pipe" });

if (tsc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(tsc.stderr).trim();
    fail(`declaration generation failed${stderr ? `: ${stderr}` : ""}`);
} else {
    for (const name of packages) {
        if (!(await Bun.file(new URL(`packages/${name}/src/index.d.ts`, tempDir)).exists())) {
            fail(`package ${name} did not produce a public declaration entrypoint`);
        }
    }
}

await new Bun.Glob("**/*").scan({ cwd: tempDir.pathname }).then(async entries => {
    for (const entry of entries) {
        const path = new URL(entry, tempDir);
        if (entry !== ".gitkeep") await Bun.write(path, "");
    }
});

if (failures.length) {
    console.error("Public API audit failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(`Public API audit passed for ${packages.length} packages.`);
