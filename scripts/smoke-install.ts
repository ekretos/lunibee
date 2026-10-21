/**
 * Release smoke test: pack every public package, install the root `lunibee`
 * tarball into an empty project, and import what it exports.
 *
 *   bun run smoke:install
 *
 * Nothing is published. Workspace ranges become `file:` paths to the tarballs
 * of the packages they name, so the install sees exactly what npm would ship.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
    entryProblems,
    preparePackages,
    publishOrder,
    workspacePackages,
    type WorkspacePackage,
} from "../packages/cli/src/maintainer.ts";
import { CliError, type IO } from "../packages/cli/src/io.ts";
import { initFiles } from "../packages/cli/src/init.ts";
import {
    APP,
    PRELOAD,
    fakeDiscord,
} from "../tests/helpers/fake-discord-bot.ts";

const ROOT = join(import.meta.dir, "..");
const io: IO = {
    cwd: ROOT,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    prompt: () => null,
    interactive: false,
    color: false,
    run: async (command, cwd) =>
        Bun.spawn(command, {
            cwd,
            stdin: "ignore",
            stdout: "inherit",
            stderr: "inherit",
        }).exited,
};

/** What the installed `lunibee` must export, by entry point. */
const EXPECT: Record<string, string[]> = {
    lunibee: [
        "Client",
        "REST",
        "Collection",
        "ShardManager",
        "ClusterManager",
        "ClusterHost",
        "ClusterWorker",
        "ShardBus",
        "CreateEmbed",
        "GatewayIntentBits",
    ],
    "lunibee/sharding": [
        "ShardManager",
        "ClusterManager",
        "ClusterHost",
        "IdentifyCoordinator",
    ],
    "lunibee/rest": ["REST", "RESTError", "Routes"],
    "lunibee/collection": ["Collection", "Cache"],
};

async function run(command: string[], cwd: string): Promise<string> {
    const process = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
    ]);
    if (code !== 0)
        throw new CliError(
            `${command.join(" ")} failed in ${cwd}:\n${err || out}`,
        );
    return out;
}

/** Packs one folder with workspace ranges pointing at already packed tarballs. */
async function pack(
    dir: string,
    tarballs: Map<string, string>,
    out: string,
): Promise<string> {
    const path = join(dir, "package.json");
    const original = await readFile(path, "utf8");
    const manifest = JSON.parse(original) as Record<string, unknown> & {
        name: string;
    };
    for (const type of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
    ]) {
        const deps = manifest[type] as Record<string, string> | undefined;
        for (const [name, range] of Object.entries(deps ?? {}))
            if (range.startsWith("workspace:") || range.startsWith("file:")) {
                const tarball = tarballs.get(name);
                if (tarball) deps![name] = `file:${tarball}`;
                else delete deps![name]; // a dev-only workspace package
            }
    }
    try {
        await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
        const json = JSON.parse(
            await run(
                ["npm", "pack", "--json", "--pack-destination", out],
                dir,
            ),
        ) as { filename: string }[];
        return join(out, json[0]!.filename);
    } finally {
        await writeFile(path, original);
    }
}

const scratch = await mkdtemp(join(tmpdir(), "lunibee-smoke-"));
try {
    const packages = publishOrder(
        (await workspacePackages(ROOT)).filter((p) => !p.manifest.private),
    );
    const root: WorkspacePackage = {
        dir: ROOT,
        manifest: JSON.parse(
            await readFile(join(ROOT, "package.json"), "utf8"),
        ),
    };
    await preparePackages(io, packages);
    if ((await io.run(["bun", "run", "build:all"], ROOT)) !== 0)
        throw new CliError("Building the root package failed.");
    const problems = await entryProblems(ROOT, root.manifest);
    if (problems.length)
        throw new CliError(
            `Root package is broken:\n  ${problems.join("\n  ")}`,
        );

    const out = join(scratch, "tarballs");
    await mkdir(out);
    const tarballs = new Map<string, string>();
    for (const { dir, manifest } of packages)
        tarballs.set(manifest.name, await pack(dir, tarballs, out));
    const rootTarball = await pack(ROOT, tarballs, out);
    console.log(`• packed ${packages.length + 1} packages`);

    const app = join(scratch, "app");
    await mkdir(app);
    await writeFile(
        join(app, "package.json"),
        JSON.stringify({ name: "smoke", private: true, type: "module" }),
    );
    await run(["bun", "add", `file:${rootTarball}`], app);
    console.log("• installed lunibee into an empty project");

    const checks = Object.entries(EXPECT)
        .map(
            ([entry, names]) =>
                `check(${JSON.stringify(entry)}, ${JSON.stringify(names)});`,
        )
        .join("\n");
    await writeFile(
        join(app, "check.mjs"),
        `const bad = [];
async function check(entry, names) {
    const mod = await import(entry);
    for (const name of names) if (typeof mod[name] === "undefined") bad.push(entry + " is missing " + name);
}
${checks.replaceAll("check(", "await check(")}
if (bad.length) { console.error(bad.join("\\n")); process.exit(1); }
const { Client, ClusterManager } = await import("lunibee");
new Client({ token: "a.b", intents: [] });
new ClusterManager({ token: "a.b", script: "w.js", shardCount: 1 });
console.log("imports ok");
`,
    );
    const result = await run(["bun", "check.mjs"], app);
    console.log(`• ${result.trim()}`);

    // A `lunibee init` project: installs, type-checks and builds against the tarball.
    const bot = join(scratch, "bot");
    const files = initFiles({
        name: "smoke-bot",
        lunibee: `file:${rootTarball}`,
    });
    for (const [path, source] of Object.entries(files)) {
        await mkdir(dirname(join(bot, path)), { recursive: true });
        await writeFile(join(bot, path), source);
    }
    await run(["bun", "install"], bot);
    await run(["bun", "run", "typecheck"], bot);
    await run(["bun", "run", "build"], bot);
    if (!(await Bun.file(join(bot, "dist/commands/info/ping.js")).exists()))
        throw new CliError(
            "The init project built no dist/commands/info/ping.js.",
        );
    console.log("• a `lunibee init` project installs, type-checks and builds");

    // …and the compiled bot starts: registers its commands and logs in (fake Discord).
    const discord = fakeDiscord();
    await writeFile(join(bot, "preload.js"), PRELOAD);
    const token = "MTAw.smoke-install.fake-token";
    const child = Bun.spawn(
        ["bun", "--preload", "./preload.js", "dist/index.js"],
        {
            cwd: bot,
            env: {
                PATH: process.env.PATH!,
                FAKE_DISCORD: discord.url,
                DISCORD_TOKEN: token,
                CLIENT_ID: APP,
                NODE_ENV: "production",
                NO_COLOR: "1",
            },
            stdout: "pipe",
            stderr: "pipe",
        },
    );
    await Promise.race([discord.identified, Bun.sleep(10_000)]);
    await Bun.sleep(200);
    child.kill("SIGTERM");
    const code = await child.exited;
    const log =
        (await new Response(child.stdout).text()) +
        (await new Response(child.stderr).text());
    discord.stop();
    if (
        !log.includes("Online as") ||
        discord.puts.length !== 1 ||
        log.includes(token) ||
        code !== 0
    )
        throw new CliError(`The init project did not start cleanly:\n${log}`);
    console.log(
        "• the compiled bot registers its commands, logs in and shuts down on SIGTERM",
    );
    console.log("\n✅ Smoke test passed.");
} catch (error) {
    console.error(
        `❌ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
} finally {
    await rm(scratch, { recursive: true, force: true });
}
