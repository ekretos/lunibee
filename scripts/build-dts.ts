import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const packages = ["types", "utils", "collection", "ws", "rest", "builders", "structures", "managers", "handlers", "sharding", "voice", "formatters", "core", "lunibee"];
const temp = ".types";

await rm(temp, { recursive: true, force: true });
const result = Bun.spawnSync(["bunx", "tsc", "--project", "tsconfig.dts.json"]);
if (result.exitCode !== 0) {
  const err = new TextDecoder().decode(result.stderr || result.stdout);
  throw new Error(err || "TypeScript declaration generation failed");
}

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
