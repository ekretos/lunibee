import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const PACKAGES_DIR = join(import.meta.dir, "../packages");

async function publishAll() {
  const dirs = await readdir(PACKAGES_DIR, { withFileTypes: true });

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;

    const pkgPath = join(PACKAGES_DIR, dir.name);
    // DO NOT append --access public to the root `lunibee` package since it's already published and unscoped
    const isScoped = dir.name !== "lunibee";

    console.log(`\n=================================================`);
    console.log(`🚀 Publishing package: ${isScoped ? "@lunibee/" + dir.name : "lunibee"}`);
    console.log(`=================================================`);

    const args = ["publish"];
    if (isScoped) {
      args.push("--access", "public");
    }

    const result = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      args,
      { cwd: pkgPath, stdio: "inherit" }
    );

    if (result.status !== 0) {
      console.error(`❌ Failed to publish ${dir.name}. Check the NPM error above!`);
      process.exit(1);
    } else {
      console.log(`✅ Successfully published ${dir.name}!`);
    }
  }

  console.log(`\n🎉 All packages published successfully!`);
}

publishAll().catch(console.error);
