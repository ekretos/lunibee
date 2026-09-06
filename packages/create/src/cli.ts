#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createProject } from "./index.js";

const args = process.argv.slice(2);
const targetDir = args[0] ?? ".";
const projectName = targetDir === "." ? "my-lunibee-bot" : targetDir;

const files = createProject({ directory: targetDir, name: projectName });

console.log(`\n🐝 Creating a new Lunibee project in: ${targetDir}\n`);

for (const [filePath, content] of Object.entries(files)) {
    const absolute = join(targetDir, filePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf-8");
    console.log(`  ✅ Created ${filePath}`);
}

console.log(`\n✨ Done! Get started:\n`);
if (targetDir !== ".") {
    console.log(`  cd ${targetDir}`);
}
console.log(`  bun install`);
console.log(`  DISCORD_TOKEN=your_token bun run src/index.ts\n`);
