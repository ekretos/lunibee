/**
 * Type-checks the TypeScript examples in the current docs against the real API.
 *
 * Every ```ts block on a page (archived versions and the generated API excluded)
 * becomes its own module under .doc-examples/ and is compiled with the
 * workspace's types. Examples are fragments, so names they use without
 * declaring them (`client`, `guildId`, `interaction`…) are not errors; anything
 * else is — a method or option that does not exist, a wrong argument, a bad
 * import. A block can opt out with a `// docs-check: skip` line.
 *
 *   bun scripts/check-doc-examples.ts
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DOCS = join(ROOT, "lunibee.js.org/src/content/docs");
const OUT = join(ROOT, ".doc-examples");

/** Fragments use names they never declare; that is the only thing forgiven. */
const IGNORED = new Set([
    2304, // Cannot find name 'x'.
    2552, // Cannot find name 'x'. Did you mean 'y'?
    2582, // Cannot find name 'test' (test-runner globals in snippets)
    2307, // Cannot find module (third-party packages such as ioredis)
    2792, // Cannot find module (same, bundler resolution)
    1375, // top-level await outside a module (each file is a module; kept defensive)
    2393, // Duplicate function implementation (alternatives shown side by side)
    2451, // Cannot redeclare block-scoped variable (alternatives shown side by side)
    7006, // Parameter implicitly has an 'any' type
    7031, // Binding element implicitly has an 'any' type
    2448, // Block-scoped variable used before its declaration (illustrative ordering)
    18004, // No value exists in scope for a shorthand property (undeclared names again)
    2300, // Duplicate identifier (alternative imports shown side by side)
    1108, // A 'return' outside a function (handler bodies shown on their own)
    2391, // Function implementation is missing (a signature written as a declaration)
]);

/** Pages that quote old releases' code on purpose. */
const HISTORY = new Set(["changelog.md", "upgrading.md"]);
const transpiler = new Bun.Transpiler({ loader: "ts" });

/**
 * A block that does not parse as statements and has no statements in it is an
 * API signature (`connect(url?: string): Promise<void>`), not an example.
 */
function isSignature(code: string): boolean {
    try {
        transpiler.transformSync(code);
        return false;
    } catch {
        return !/^\s*(import|const|let|await|for|if|export)\b/m.test(code);
    }
}

/**
 * Names the examples use without declaring them, with their real types, so
 * calls on them are checked too. Appended (ambient) only when the example
 * does not declare the name itself, which keeps line numbers unchanged.
 */
const AMBIENT: Record<string, string> = {
    client: 'import("lunibee").Client',
    bot: 'import("lunibee").Client',
    rest: 'import("lunibee").REST',
    gateway: 'import("lunibee").Gateway',
    interaction: 'import("lunibee").CommandInteraction',
    message: 'import("lunibee").Message',
    guild: 'import("lunibee").Guild',
    channel: 'import("lunibee").TextChannel',
    member: 'import("lunibee").GuildMember',
    user: 'import("lunibee").User',
    role: 'import("lunibee").Role',
    manager: 'import("lunibee").ShardManager',
    token: "string",
    guildId: "string",
    channelId: "string",
    userId: "string",
    messageId: "string",
    roleId: "string",
};
function ambient(code: string): string {
    const lines: string[] = [];
    for (const [name, type] of Object.entries(AMBIENT)) {
        if (!new RegExp(`\\b${name}\\b`).test(code)) continue;
        // Declared by the example itself: `const name`, `function name`, a
        // destructured binding, or an import. A mere use on a declaring line
        // (`const guild = client.guilds…`) does not count.
        const declared = [
            `\\b(const|let|var|function|class)\\s+${name}\\b`,
            `\\b(const|let|var)\\s*[{[][^=]*\\b${name}\\b[^=]*[}\\]]\\s*=`,
            `\\bimport\\s+(type\\s+)?${name}\\b`,
            `\\bimport\\s*(type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}`,
        ];
        if (declared.some((re) => new RegExp(re).test(code))) continue;
        lines.push(`declare const ${name}: ${type};`);
    }
    return lines.join("\n");
}

async function pages(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "api" || /^\d+\.\d+\.\d+$/.test(entry.name)) continue;
            out.push(...(await pages(path)));
        } else if (/\.mdx?$/.test(entry.name) && !HISTORY.has(entry.name)) out.push(path);
    }
    return out;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const origin = new Map<string, string>();
let blocks = 0;
let signatures = 0;
for (const page of await pages(DOCS)) {
    const text = await readFile(page, "utf8");
    const re = /^[ \t]*```(?:ts|typescript)\b[^\n]*\n([\s\S]*?)^[ \t]*```/gm;
    let match: RegExpExecArray | null;
    let n = 0;
    while ((match = re.exec(text))) {
        const code = match[1]!;
        if (/docs-check:\s*skip/.test(code)) continue;
        if (isSignature(code)) {
            signatures++;
            continue;
        }
        const line = text.slice(0, match.index).split("\n").length + 1;
        const name = `${relative(DOCS, page).replace(/[\\/.]/g, "_")}_${++n}.ts`;
        origin.set(name, `${relative(ROOT, page)}:${line}`);
        await writeFile(join(OUT, name), `${code}\nexport {};\n${ambient(code)}\n`);
        blocks++;
    }
}

const pkgs = await readdir(join(ROOT, "packages"));
const paths: Record<string, string[]> = { lunibee: ["../packages/lunibee/src/index.ts"] };
for (const p of pkgs) paths[`@lunibee/${p}`] = [`../packages/${p}/src/index.ts`];
await writeFile(
    join(OUT, "tsconfig.json"),
    JSON.stringify({
        compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            allowImportingTsExtensions: true,
            types: ["bun"],
            typeRoots: ["../node_modules/@types"],
            paths,
        },
        include: ["*.ts"],
    }),
);

const proc = Bun.spawn(["bunx", "tsc", "-p", join(OUT, "tsconfig.json")], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
});
const output = await new Response(proc.stdout).text();
await proc.exited;

const problems: string[] = [];
for (const line of output.split("\n")) {
    const m = /^\.doc-examples\/([^()]+)\((\d+),\d+\): error TS(\d+): (.*)$/.exec(line);
    if (!m) continue;
    const [, file, row, code, message] = m;
    if (IGNORED.has(Number(code))) continue;
    const [page, start] = origin.get(file!)!.split(":");
    problems.push(`${page}:${Number(start) + Number(row) - 1}  TS${code}: ${message}`);
}
// Errors inside packages/ would mean the workspace itself does not compile.
const outside = output.split("\n").filter((l) => /error TS/.test(l) && !l.startsWith(".doc-examples/"));

console.log(`${blocks} examples checked (${signatures} signature blocks skipped).`);
for (const p of problems) console.log(p);
for (const o of outside) console.log(o);
if (problems.length || outside.length) {
    console.log(`${problems.length + outside.length} problems.`);
    process.exit(1);
}
await rm(OUT, { recursive: true, force: true });
console.log("All examples type-check.");
