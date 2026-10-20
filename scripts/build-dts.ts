import { mkdir, readdir, rm, copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

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

// Point `@lunibee/*` imports at the declarations in dist, so `lunibee` and
// `lunibee/rest` (and the others) name one type each, as they share one class.
async function relink(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await relink(path);
      continue;
    }
    if (!entry.name.endsWith(".d.ts")) continue;
    const text = await readFile(path, "utf8");
    const next = text.replace(/(["'])@lunibee\/([a-z-]+)\1/g, (match, quote: string, name: string) => {
      if (!packages.includes(name)) return match;
      let target = relative(dirname(path), join("dist", name, "index.js")).replace(/\\/g, "/");
      if (!target.startsWith(".")) target = `./${target}`;
      return `${quote}${target}${quote}`;
    });
    if (next !== text) await writeFile(path, next);
  }
}
await relink("dist");
