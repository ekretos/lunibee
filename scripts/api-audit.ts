const root = new URL("../", import.meta.url);
const packages = ["core", "rest", "ws", "structures", "builders", "collection", "managers", "sharding", "voice", "types"];
const failures: string[] = [];

for (const name of packages) {
    const entry = new URL(`../packages/${name}/src/index.ts`, import.meta.url);
    const file = Bun.file(entry);
    if (!(await file.exists())) failures.push(`missing public entrypoint: packages/${name}/src/index.ts`);
    else {
        const source = await file.text();
        if (/from\s+["']\.\.?\//.test(source) && name === "core") failures.push("core public entrypoint contains a relative package boundary import");
    }
}

const rootPackage = await Bun.file(new URL("../package.json", import.meta.url)).json() as { type?: string; workspaces?: string[] };
if (rootPackage.type !== "module") failures.push("root package must remain ESM");
if (!rootPackage.workspaces?.includes("packages/*")) failures.push("workspace must include packages/*");

if (failures.length) {
    console.error("Public API audit failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log(`Public API audit passed for ${packages.length} packages.`);
void root;
