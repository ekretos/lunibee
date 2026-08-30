import { mkdir, readdir, rm, copyFile } from "node:fs/promises";
import { join } from "node:path";

const packages = ["types", "utils", "collection", "ws", "rest", "builders", "structures", "managers", "handlers", "sharding", "voice", "formatters", "core", "lunibee"];
const temp = ".types";

await rm(temp, { recursive: true, force: true });
const result = Bun.spawnSync([
  "bun", "run", "tsc", "--project", "tsconfig.dts.json"
]);
if (result.exitCode !== 0) {
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  console.error(stdout || stderr);
  throw new Error(stdout || stderr || "TypeScript declaration generation failed");
}

async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.name.endsWith(".d.ts")) await copyFile(from, to);
  }
}

for (const name of packages) {
  const source = join(temp, name, "src");
  try { await readdir(source); } catch { continue; }
  await copyTree(source, name === "lunibee" ? "dist" : join("dist", name));
}
await rm(temp, { recursive: true, force: true });
