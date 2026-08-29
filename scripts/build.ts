import { rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Public Lunibee workspace package compiled into the distributable dist tree.
 */
interface BuildTarget {
  /** Package source entrypoint. */
  source: string;
  /** Public output directory relative to dist. */
  output: string;
}

const targets: BuildTarget[] = [
  { source: "packages/types/src/index.ts", output: "types" },
  { source: "packages/utils/src/index.ts", output: "utils" },
  { source: "packages/collection/src/index.ts", output: "collection" },
  { source: "packages/ws/src/index.ts", output: "ws" },
  { source: "packages/rest/src/index.ts", output: "rest" },
  { source: "packages/builders/src/index.ts", output: "builders" },
  { source: "packages/structures/src/index.ts", output: "structures" },
  { source: "packages/managers/src/index.ts", output: "managers" },
  { source: "packages/handlers/src/index.ts", output: "handlers" },
  { source: "packages/sharding/src/index.ts", output: "sharding" },
  { source: "packages/voice/src/index.ts", output: "voice" },
  { source: "packages/formatters/src/index.ts", output: "formatters" },
  { source: "packages/core/src/index.ts", output: "core" },
  { source: "packages/lunibee/src/index.ts", output: "." },
];

/**
 * Builds every Lunibee workspace package into the single consumer-facing dist tree.
 *
 * @returns A promise that resolves after every target has been compiled.
 * @throws {Error} When Bun cannot compile one of the package entrypoints.
 */
async function build(): Promise<void> {
  await rm("dist", { recursive: true, force: true });

  for (const target of targets) {
    const outdir = join("dist", target.output);
    const result = await Bun.build({
      entrypoints: [target.source],
      outdir,
      target: "bun",
      format: "esm",
      sourcemap: "external",
      minify: false,
      splitting: false,
    });

    if (!result.success) {
      const errors = result.logs
        .filter((log) => log.level === "error")
        .map((log) => log.message)
        .join("\n");
      throw new Error(`Failed to build ${target.source}:\n${errors}`);
    }
  }
}

await build();
