import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Describes a workspace package that is emitted into the public distribution tree.
 */
interface BuildTarget {
  /** Package source entrypoint. */
  source: string;
  /** Public output directory relative to dist. */
  output: string;
}

/**
 * Maps every internal package name to its source entrypoint so a Git consumer can build
 * Lunibee without first installing the private workspace packages.
 */
const workspaceAliases: Record<string, string> = {
  "@lunibee/types": "packages/types/src/index.ts",
  "@lunibee/utils": "packages/utils/src/index.ts",
  "@lunibee/collection": "packages/collection/src/index.ts",
  "@lunibee/ws": "packages/ws/src/index.ts",
  "@lunibee/rest": "packages/rest/src/index.ts",
  "@lunibee/builders": "packages/builders/src/index.ts",
  "@lunibee/structures": "packages/structures/src/index.ts",
  "@lunibee/managers": "packages/managers/src/index.ts",
  "@lunibee/handlers": "packages/handlers/src/index.ts",
  "@lunibee/sharding": "packages/sharding/src/index.ts",
  "@lunibee/voice": "packages/voice/src/index.ts",
  "@lunibee/formatters": "packages/formatters/src/index.ts",
  "@lunibee/core": "packages/core/src/index.ts",
};

/**
 * Resolves internal workspace package imports directly to their source entrypoints.
 */
const workspaceResolver = {
  /** Plugin name used by Bun's build diagnostics. */
  name: "lunibee-workspace-resolver",
  /** Registers the internal package resolution hook. */
  setup(build: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => { path: string } | undefined) => void }): void {
    build.onResolve({ filter: /^@lunibee\// }, (args) => {
      const source = workspaceAliases[args.path];
      return source ? { path: resolve(source) } : undefined;
    });
  },
};

/** Every workspace package exposed through the public dist tree. */
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
      plugins: [workspaceResolver],
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
