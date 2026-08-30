import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PACKAGES_DIR = join(import.meta.dir, "../packages");
const ROOT_DIR = join(import.meta.dir, "..");
const NEW_VERSION = "0.1.5";

async function bumpVersions() {
  const dirs = await readdir(PACKAGES_DIR, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const pkgJsonPath = join(PACKAGES_DIR, dir.name, "package.json");
    try {
      const content = await readFile(pkgJsonPath, "utf-8");
      const pkg = JSON.parse(content);
      pkg.version = NEW_VERSION;
      await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");
      console.log(`Bumped ${pkg.name} to ${NEW_VERSION}`);
    } catch {}
  }

  // Root package
  const rootPkgPath = join(ROOT_DIR, "package.json");
  const rootContent = await readFile(rootPkgPath, "utf-8");
  const rootPkg = JSON.parse(rootContent);
  rootPkg.version = NEW_VERSION;
  await writeFile(rootPkgPath, JSON.stringify(rootPkg, null, 2) + "\n");
  console.log(`Bumped ${rootPkg.name} (root) to ${NEW_VERSION}`);
}

bumpVersions().catch(console.error);
