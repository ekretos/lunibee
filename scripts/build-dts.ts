import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const packages = ["types", "utils", "collection", "ws", "rest", "builders", "structures", "managers", "handlers", "sharding", "voice", "formatters", "core", "lunibee"];
const entries = packages.map(name => `packages/${name}/src/index.ts`);
const temp = ".types";

await rm(temp, { recursive: true, force: true });
const result = Bun.spawnSync(["bunx", "tsc", "--declaration", "--emitDeclarationOnly", "--noEmitOnError", "false", "--skipLibCheck", "--exactOptionalPropertyTypes", "false", "--target", "ESNext", "--module", "ESNext", "--moduleResolution", "Bundler", "--rootDir", "packages", "--outDir", temp, "--types", "bun", ...entries]);
if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr || result.stdout));

async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.name.endsWith(".d.ts")) await writeFile(to, (await readFile(from, "utf8")).replace(/@lunibee\/([A-Za-z0-9_-]+)/g, "lunibee/$1"));
  }
}

for (const name of packages) {
  const source = join(temp, name, "src");
  try { await readdir(source); } catch { continue; }
  await copyTree(source, name === "lunibee" ? "dist" : join("dist", name));
}
await rm(temp, { recursive: true, force: true });
