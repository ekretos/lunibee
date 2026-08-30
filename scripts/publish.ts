import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PACKAGES_DIR = join(import.meta.dir, "../packages");
const ROOT_DIR = join(import.meta.dir, "..");

async function publishAll() {
  const dirs = await readdir(PACKAGES_DIR, { withFileTypes: true });

  const packageVersions = new Map<string, string>();
  const packageDirs: string[] = [];

  // 1. Gather all versions
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const pkgJsonPath = join(PACKAGES_DIR, dir.name, "package.json");
    try {
      const content = await readFile(pkgJsonPath, "utf-8");
      const pkg = JSON.parse(content);
      packageVersions.set(pkg.name, pkg.version);
      packageDirs.push(dir.name);
    } catch {}
  }

  // Add root package version
  const rootPkgPath = join(ROOT_DIR, "package.json");
  const rootPkgContent = await readFile(rootPkgPath, "utf-8");
  const rootPkg = JSON.parse(rootPkgContent);
  packageVersions.set(rootPkg.name, rootPkg.version);

  // 2. Publish packages in packages/
  for (const dirName of packageDirs) {
    const pkgPath = join(PACKAGES_DIR, dirName);
    const pkgJsonPath = join(pkgPath, "package.json");

    const originalContent = await readFile(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(originalContent);
    let modified = false;

    // Replace workspace: and file: with actual versions
    for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
      if (!pkg[depType]) continue;
      for (const [depName, depVersion] of Object.entries(pkg[depType] as Record<string, string>)) {
        if (depVersion.startsWith("workspace:") || depVersion.startsWith("file:")) {
          const actualVersion = packageVersions.get(depName);
          if (actualVersion) {
            pkg[depType][depName] = `^${actualVersion}`;
            modified = true;
          }
        }
      }
    }

    try {
      if (modified) {
        await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");
      }

      console.log(`\n=================================================`);
      console.log(`🚀 Publishing package: ${pkg.name}`);
      console.log(`=================================================`);

      const args = ["publish"];
      // Scoped packages require --access public
      if (pkg.name.startsWith("@")) {
        args.push("--access", "public");
      }

      const result = spawnSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        args,
        { cwd: pkgPath, stdio: "inherit", shell: true }
      );

      if (result.error) {
        console.error("Spawn Error:", result.error);
      }

      if (result.status !== 0) {
        console.error(`❌ Failed to publish ${pkg.name}. Status code: ${result.status}`);
        process.exit(1);
      } else {
        console.log(`✅ Successfully published ${pkg.name}!`);
      }
    } finally {
      // Always restore the original package.json (with workspace/file links)
      if (modified) {
        await writeFile(pkgJsonPath, originalContent);
      }
    }
  }

  // 3. Publish Root package
  console.log(`\n=================================================`);
  console.log(`🚀 Publishing package: ${rootPkg.name} (root)`);
  console.log(`=================================================`);

  const rootPkgJsonPath = join(ROOT_DIR, "package.json");
  const rootOriginalContent = await readFile(rootPkgJsonPath, "utf-8");
  const rootPkgParsed = JSON.parse(rootOriginalContent);
  let rootModified = false;

  for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (!rootPkgParsed[depType]) continue;
    for (const [depName, depVersion] of Object.entries(rootPkgParsed[depType] as Record<string, string>)) {
      if (depVersion.startsWith("workspace:") || depVersion.startsWith("file:")) {
        const actualVersion = packageVersions.get(depName);
        if (actualVersion) {
          rootPkgParsed[depType][depName] = `^${actualVersion}`;
          rootModified = true;
        }
      }
    }
  }

  try {
    if (rootModified) {
      await writeFile(rootPkgJsonPath, JSON.stringify(rootPkgParsed, null, 2) + "\n");
    }

    const rootResult = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["publish"],
      { cwd: ROOT_DIR, stdio: "inherit", shell: true }
    );

    if (rootResult.error) {
      console.error("Root Spawn Error:", rootResult.error);
    }

    if (rootResult.status !== 0) {
      console.error(`❌ Failed to publish root package. Status code: ${rootResult.status}`);
      process.exit(1);
    } else {
      console.log(`✅ Successfully published root package!`);
    }
  } finally {
    if (rootModified) {
      await writeFile(rootPkgJsonPath, rootOriginalContent);
    }
  }

  console.log(`\n🎉 All packages published successfully!`);
}

publishAll().catch(console.error);
