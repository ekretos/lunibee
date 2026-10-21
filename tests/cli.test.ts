import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../packages/cli/src/cli.ts";
import { parseArgs } from "../packages/cli/src/args.ts";
import { sourceFiles } from "../packages/cli/src/inspect.ts";
import { closest, paint, type IO } from "../packages/cli/src/io.ts";
import {
    compareVersions,
    findProjectRoot,
} from "../packages/cli/src/project.ts";
import { publishOrder } from "../packages/cli/src/maintainer.ts";

let dir: string;
let out: string[];
let err: string[];
let answers: (string | null)[];
let runs: { command: string[]; cwd: string }[];
let exitCodes: number[];

function io(overrides: Partial<IO> = {}): IO {
    return {
        cwd: dir,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        prompt: () => (answers.length ? answers.shift()! : null),
        interactive: false,
        color: false,
        run: async (command, cwd) => {
            runs.push({ command, cwd });
            return exitCodes.shift() ?? 0;
        },
        ...overrides,
    };
}

const cli = (argv: string, overrides?: Partial<IO>) =>
    main(argv.split(" ").filter(Boolean), io(overrides), {
        version: "9.9.9",
        lunibeeRoot: join(dir, "mono"),
    });
const text = () => out.join("\n");
const errors = () => err.join("\n");
const read = (path: string) => readFile(join(dir, path), "utf8");

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lunibee-cli-"));
    out = [];
    err = [];
    answers = [];
    runs = [];
    exitCodes = [];
    await writeFile(
        join(dir, "package.json"),
        JSON.stringify({
            name: "bot",
            version: "1.0.0",
            dependencies: { lunibee: "^0.2.2" },
        }),
    );
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("argument parsing", () => {
    test("flags, aliases, values and --", () => {
        const args = parseArgs([
            "publish",
            "-n",
            "--tag",
            "next",
            "--otp=123",
            "-yf",
            "--",
            "--raw",
        ]);
        expect(args.positionals).toEqual(["publish", "--raw"]);
        expect(args.flags.get("dry-run")).toBe(true);
        expect(args.flags.get("tag")).toBe("next");
        expect(args.flags.get("otp")).toBe("123");
        expect(args.flags.get("yes")).toBe(true);
        expect(args.flags.get("force")).toBe(true);
    });

    test("bad flags are errors", async () => {
        expect(() => parseArgs(["--tag"])).toThrow("needs a value");
        expect(() => parseArgs(["--tag", "--yes"])).toThrow("needs a value");
        expect(() => parseArgs(["--json=1"])).toThrow("does not take a value");
        expect(() => parseArgs(["--"])).not.toThrow();
        expect(() => parseArgs(["--=x"])).toThrow("Invalid flag");
        expect(await cli("check --jsn")).toBe(1);
        expect(errors()).toContain("Did you mean `--json`?");
    });
});

describe("help and routing", () => {
    test("help, version and per-command help", async () => {
        expect(await cli("")).toBe(0);
        expect(text()).toContain("create component");
        expect(text()).not.toContain("create handler");
        expect(text()).not.toContain("sync");
        out = [];
        expect(await cli("--version")).toBe(0);
        expect(text()).toBe("9.9.9");
        out = [];
        expect(await cli("create component --help")).toBe(0);
        expect(text()).toContain("Usage: lunibee create component");
        out = [];
        expect(await cli("help migrate")).toBe(0);
        expect(text()).toContain("0.4.0");
        out = [];
        expect(await cli("help create")).toBe(0);
        expect(text()).toContain("create component");
        expect(text()).not.toContain("publish");
    });

    test("groups and unknown commands", async () => {
        expect(await cli("create")).toBe(1);
        expect(text()).toContain("create component");
        expect(await cli("create --help")).toBe(0);
        expect(await cli("create componnt")).toBe(1);
        expect(errors()).toContain("`create component`");
        expect(await cli("docter")).toBe(1);
        expect(errors()).toContain("`doctor`");
        err = [];
        expect(await cli("zzzzzzzz")).toBe(1);
        expect(errors()).toContain("lunibee help");
    });

    test("unexpected errors print the message", async () => {
        const code = await main(
            ["check"],
            io({
                out: () => {
                    throw new Error("boom");
                },
            }),
            {
                version: "1",
                lunibeeRoot: dir,
            },
        );
        expect(code).toBe(1);
        expect(errors()).toContain("boom");
        const plain = await main(
            ["check"],
            io({
                out: () => {
                    throw "raw";
                },
            }),
            { version: "1", lunibeeRoot: dir },
        );
        expect(plain).toBe(1);
        expect(errors()).toContain("raw");
    });

    test("--cwd and root discovery from a subfolder", async () => {
        await mkdir(join(dir, "src", "deep"), { recursive: true });
        expect(await cli("create component button ok --cwd src/deep")).toBe(0);
        expect(await read("src/components/ok.ts")).toContain("CreateButton");
        expect(await findProjectRoot("/")).toBeNull();
    });

    test("--no-color and colors", async () => {
        expect(paint({ color: true }, "green", "x")).toBe("\x1b[32mx\x1b[0m");
        expect(await cli("list commands --no-color", { color: true })).toBe(0);
        expect(text()).not.toContain("\x1b[");
    });
});

describe("removed commands", () => {
    test("the binder-layout commands are gone", async () => {
        for (const command of [
            "create handler ready",
            "create command ping",
            "sync handlers",
            "sync commands",
            "handler --fix",
            "handlers",
        ]) {
            err = [];
            expect(await cli(command)).toBe(1);
            expect(errors()).toContain("Unknown command");
        }
    });
});

describe("create component", () => {
    test("each kind", async () => {
        expect(await cli("create component button confirm")).toBe(0);
        expect(await read("src/components/confirm.ts")).toContain(
            "ButtonType.Primary",
        );
        expect(await cli("create component select pick")).toBe(0);
        expect(await read("src/components/pick.ts")).toContain(
            "interaction.values",
        );
        expect(await cli("create component 3 ask:form")).toBe(0);
        const modal = await read("src/components/ask-form.ts");
        expect(modal).toContain('customId = "ask:form"');
        expect(modal).toContain("getInputValue");
    });

    test("validation and interactive", async () => {
        expect(await cli("create component button ok --dry-run")).toBe(0);
        expect(text()).toContain("would create components/ok.ts");
        expect(await Bun.file(join(dir, "src/components/ok.ts")).exists()).toBe(
            false,
        );
        expect(await cli("create component button ok")).toBe(0);
        expect(await cli("create component button ok")).toBe(1);
        expect(errors()).toContain("--force");
        expect(await cli("create component select ok --force")).toBe(0);
        expect(await read("src/components/ok.ts")).toContain(
            "CreateStringSelect",
        );
        expect(await cli("create component slider x")).toBe(1);
        expect(errors()).toContain("button, select or modal");
        expect(await cli("create component button bad/id")).toBe(1);
        expect(await cli("create component")).toBe(1);
        answers = ["2", "menu"];
        expect(await cli("create component", { interactive: true })).toBe(0);
        expect(text()).toContain("String select");
        answers = [""];
        expect(await cli("create component", { interactive: true })).toBe(0);
        answers = [""];
        expect(await cli("create component modal", { interactive: true })).toBe(
            0,
        );
    });
});

describe("list", () => {
    test("every kind, text and JSON", async () => {
        expect(await cli("list handlers")).toBe(0);
        expect(text()).toContain("No handlers found under src/events");
        expect(await cli("list commands")).toBe(0);
        expect(text()).toContain("No commands");
        const files = [
            "src/events/client/ready.ts",
            "src/events/message/messageCreate.ts",
            "src/events/message/_shared.ts",
            "src/events/_drafts/old.ts",
            "src/events/message/notes.md",
            "src/events/message/a.test.ts",
            "src/events/types.d.ts",
            "src/commands/util/ping.ts",
            "src/commands/index.ts",
        ];
        for (const file of files) {
            await mkdir(join(dir, file, ".."), { recursive: true });
            await writeFile(join(dir, file), "export default {};\n");
        }
        await cli("create component button ok");
        out = [];
        await cli("list handlers");
        expect(out).toEqual(["client/ready", "message/messageCreate"]);
        out = [];
        await cli("list handlers --json");
        expect(JSON.parse(text())).toEqual([
            "client/ready",
            "message/messageCreate",
        ]);
        out = [];
        await cli("list commands");
        expect(out).toEqual(["index", "util/ping"]);
        out = [];
        await cli("list components --json");
        expect(JSON.parse(text())).toEqual(["ok"]);
        out = [];
        await cli("list events");
        expect(out).toContain("guildRoleUpdate");
        out = [];
        await cli("list events --json");
        expect(JSON.parse(text())).toContain("ready");
        expect(await sourceFiles(join(dir, "missing"))).toEqual([]);
    });

    test("unknown kinds", async () => {
        expect(await cli("list")).toBe(1);
        expect(await cli("list comands")).toBe(1);
        expect(errors()).toContain("`commands`");
        expect(await cli("list qqqqqqqqq")).toBe(1);
    });
});

describe("check and doctor", () => {
    test("a healthy project", async () => {
        await mkdir(join(dir, "src/commands"), { recursive: true });
        await mkdir(join(dir, "src/events"), { recursive: true });
        await mkdir(join(dir, "src/handlers"), { recursive: true });
        await writeFile(
            join(dir, "src/handlers/commands.ts"),
            'export async function discoverCommands() { return new Map([["ping", { data: { toJSON: () => ({ name: "ping" }) } }]]); }\n',
        );
        await writeFile(
            join(dir, "src/handlers/events.ts"),
            'export async function discoverEvents() { return [{ event: { name: "ready" } }]; }\n',
        );
        await writeFile(join(dir, ".env"), "DISCORD_TOKEN=secret-value\n");
        await writeFile(join(dir, ".gitignore"), "node_modules\n.env\n");
        await mkdir(join(dir, "node_modules/lunibee"), { recursive: true });
        await writeFile(
            join(dir, "node_modules/lunibee/package.json"),
            '{"version":"0.2.2"}',
        );
        await writeFile(
            join(dir, "tsconfig.json"),
            '{"compilerOptions":{"strict":true}}',
        );
        out = [];
        expect(await cli("doctor")).toBe(0);
        expect(text()).toContain("0 errors, 0 warnings");
        expect(text()).toContain("Lunibee 0.2.2 installed");
        expect(text()).toContain("1 command(s) load: /ping");
        expect(text()).toContain("1 event handler(s) load: ready");
        expect(text()).not.toContain("secret-value");
        out = [];
        expect(await cli("check --json")).toBe(0);
        expect(JSON.parse(text()).ok).toBe(true);
    });

    test("problems are reported with exit code 1", async () => {
        await mkdir(join(dir, "src/handlers"), { recursive: true });
        await writeFile(join(dir, "src/handlers/event.ts"), "");
        await writeFile(join(dir, ".env"), "OTHER=1\n");
        await writeFile(join(dir, "tsconfig.json"), "{}");
        await writeFile(
            join(dir, "package.json"),
            JSON.stringify({
                dependencies: {
                    lunibee: "^0.2.2",
                    "@lunibee/ws": "^0.2.1",
                    "@lunibee/rest": "^0.2.1",
                },
            }),
        );
        for (const [name, version] of [
            ["lunibee", "0.2.2"],
            ["@lunibee/ws", "0.2.1"],
        ]) {
            await mkdir(join(dir, "node_modules", name!), { recursive: true });
            await writeFile(
                join(dir, "node_modules", name!, "package.json"),
                JSON.stringify({ version }),
            );
        }
        expect(await cli("doctor")).toBe(1);
        const report = text();
        expect(report).toContain(
            "src/handlers/commands.ts and src/handlers/events.ts not found",
        );
        expect(report).toContain("src/handlers/event.ts is a binder");
        expect(report).toContain(".env has no DISCORD_TOKEN");
        expect(report).toContain(".env is not in .gitignore");
        expect(report).toContain("@lunibee/rest is not installed");
        expect(report).toContain("Mixed Lunibee versions");
        expect(report).toContain("strict is off");
    });

    test("missing package.json, dependency and old Bun", async () => {
        await rm(join(dir, "package.json"));
        expect(await cli("check --cwd /")).toBe(1);
        await writeFile(join(dir, "package.json"), "{ not json");
        out = [];
        expect(await cli("check")).toBe(1);
        expect(text()).toContain("package.json not found");
        await writeFile(join(dir, "package.json"), "{}");
        out = [];
        expect(await cli("check")).toBe(1);
        expect(text()).toContain("No Lunibee dependency");
        expect(text()).toContain("src (not created yet)");
        expect(text()).toContain(".env not found");
        const { doctor } = await import("../packages/cli/src/inspect.ts");
        out = [];
        expect(await doctor(io(), dir, true, "1.1.0")).toBe(1);
        expect(
            JSON.parse(text()).findings.some((f: { message: string }) =>
                f.message.includes("older than"),
            ),
        ).toBe(true);
    });
});

describe("info", () => {
    test("text and JSON", async () => {
        await mkdir(join(dir, "src/commands/info"), { recursive: true });
        await writeFile(join(dir, "src/commands/info/ping.ts"), "");
        await mkdir(join(dir, "src/events/client"), { recursive: true });
        await writeFile(join(dir, "src/events/client/ready.ts"), "");
        out = [];
        expect(await cli("info")).toBe(0);
        expect(text()).toContain("Project:    bot@1.0.0");
        expect(text()).toContain("lunibee@^0.2.2 (not installed)");
        expect(text()).toContain("Commands:   1");
        expect(text()).toContain("Handlers:   1");
        out = [];
        expect(await cli("info --json")).toBe(0);
        const data = JSON.parse(text());
        expect(data.cli).toBe("9.9.9");
        expect(data.lunibee.lunibee).toEqual({
            declared: "^0.2.2",
            installed: null,
        });
        await writeFile(join(dir, "package.json"), "{}");
        out = [];
        expect(await cli("info")).toBe(0);
        expect(text()).toContain("not a dependency");
        await rm(join(dir, "package.json"));
        expect(await cli("info --cwd /")).toBe(1);
    });
});

describe("status and publish", () => {
    async function mono(packages: Record<string, object>) {
        for (const [folder, manifest] of Object.entries(packages)) {
            await mkdir(join(dir, "mono/packages", folder), {
                recursive: true,
            });
            await writeFile(
                join(dir, "mono/packages", folder, "package.json"),
                JSON.stringify(manifest),
            );
        }
        await writeFile(join(dir, "mono/packages/README.md"), "");
        await mkdir(join(dir, "mono/packages/empty"), { recursive: true });
    }

    test("status lists packages and flags mixed versions", async () => {
        await mono({
            core: {
                name: "@x/core",
                version: "1.0.0",
                dependencies: { "@x/types": "workspace:*" },
            },
            types: { name: "@x/types", version: "1.0.0" },
            internal: { name: "@x/internal", version: "0.0.1", private: true },
        });
        expect(await cli("status")).toBe(0);
        expect(text()).toContain("@x/internal  0.0.1  (private)");
        out = [];
        expect(await cli("status --json")).toBe(0);
        expect(JSON.parse(text()).consistent).toBe(true);
        await mono({ types: { name: "@x/types", version: "1.0.1" } });
        expect(await cli("status")).toBe(0);
        expect(errors()).toContain("different versions");
    });

    test("publish orders dependencies first and passes flags", async () => {
        await mono({
            core: {
                name: "@x/core",
                version: "1.0.0",
                dependencies: { "@x/types": "workspace:*", other: "1" },
            },
            types: {
                name: "@x/types",
                version: "1.0.0",
                publishConfig: { access: "restricted" },
            },
        });
        expect(await cli("publish --dry-run --tag next --otp 123456")).toBe(0);
        expect(runs.map((r) => r.cwd.split("/").pop())).toEqual([
            "types",
            "core",
        ]);
        expect(runs[0]!.command).toEqual([
            "bun",
            "publish",
            "--access",
            "restricted",
            "--dry-run",
            "--tag",
            "next",
            "--otp",
            "123456",
        ]);
        expect(text()).toContain("dry run complete");
    });

    test("publish confirmation, failures and refusals", async () => {
        await mono({ types: { name: "@x/types", version: "1.0.0" } });
        expect(await cli("publish")).toBe(1);
        expect(errors()).toContain("--yes");
        answers = ["n"];
        expect(await cli("publish", { interactive: true })).toBe(1);
        expect(text()).toContain("Cancelled.");
        answers = ["y"];
        expect(await cli("publish", { interactive: true })).toBe(0);
        expect(text()).toContain("published 1 packages");
        exitCodes = [2];
        expect(await cli("publish --yes")).toBe(1);
        expect(errors()).toContain("failed (exit 2)");
        expect(await cli("publish --yes --tag 1bad")).toBe(1);
        await mono({ core: { name: "@x/core", version: "2.0.0" } });
        expect(await cli("publish --yes")).toBe(1);
        expect(errors()).toContain("mixed versions");
    });

    test("no packages, no monorepo, cycles", async () => {
        await mkdir(join(dir, "mono/packages"), { recursive: true });
        expect(await cli("publish --yes")).toBe(0);
        expect(text()).toContain("No publishable packages");
        await rm(join(dir, "mono"), { recursive: true });
        expect(await cli("status")).toBe(1);
        expect(errors()).toContain("No packages folder");
        const pkg = (name: string, dep: string) => ({
            dir: name,
            manifest: { name, version: "1", dependencies: { [dep]: "*" } },
        });
        expect(() => publishOrder([pkg("a", "b"), pkg("b", "a")])).toThrow(
            "Dependency cycle",
        );
    });
});

test("helpers", () => {
    expect(compareVersions("1.3.11", "1.2.0")).toBeGreaterThan(0);
    expect(compareVersions("v1.2.0-beta", "1.2.0")).toBe(0);
    expect(compareVersions("1.1", "1.2.0")).toBeLessThan(0);
    expect(closest("create", ["create", "check"])).toEqual(["create"]);
});

describe("publish preparation", () => {
    async function pkg(
        folder: string,
        manifest: object,
        files: Record<string, string> = {},
    ) {
        const base = join(dir, "mono/packages", folder);
        await mkdir(base, { recursive: true });
        await writeFile(join(base, "package.json"), JSON.stringify(manifest));
        for (const [path, content] of Object.entries(files)) {
            await mkdir(join(base, path, ".."), { recursive: true });
            await writeFile(join(base, path), content);
        }
    }

    test("builds first, then checks bin, main, types and nested exports", async () => {
        await pkg(
            "cli",
            {
                name: "@x/cli",
                version: "1.0.0",
                bin: { x: "./dist/index.js" },
                scripts: { build: "tsc" },
            },
            { "dist/index.js": "#!/usr/bin/env bun\n" },
        );
        await pkg(
            "lib",
            {
                name: "@x/lib",
                version: "1.0.0",
                main: "./dist/index.js",
                types: "./dist/index.d.ts",
                exports: {
                    ".": {
                        import: "./dist/index.js",
                        types: "./dist/index.d.ts",
                    },
                    "./package.json": "./package.json",
                },
            },
            { "dist/index.js": "", "dist/index.d.ts": "" },
        );
        expect(await cli("publish --yes")).toBe(0);
        expect(runs[0]!.command).toEqual(["bun", "run", "build"]);
        expect(runs[0]!.cwd).toEndWith("cli");
        expect(text()).toContain("building @x/cli");
        expect(runs.filter((r) => r.command[1] === "publish")).toHaveLength(2);
    });

    test("refuses missing entry files and bins without #!", async () => {
        await pkg(
            "a",
            {
                name: "@x/a",
                version: "1.0.0",
                bin: "dist/cli.js",
                module: "dist/index.js",
            },
            { "dist/cli.js": "console.log(1)" },
        );
        await pkg("b", {
            name: "@x/b",
            version: "1.0.0",
            exports: { ".": "./dist/b.js" },
        });
        expect(await cli("publish --yes")).toBe(1);
        expect(errors()).toContain("@x/a: dist/index.js is missing");
        expect(errors()).toContain("@x/a: dist/cli.js has no #! line");
        expect(errors()).toContain("@x/b: dist/b.js is missing");
        expect(runs.some((r) => r.command[1] === "publish")).toBe(false);
    });

    test("a failing build stops everything", async () => {
        await pkg("a", {
            name: "@x/a",
            version: "1.0.0",
            scripts: { build: "x" },
        });
        exitCodes = [3];
        expect(await cli("publish --yes")).toBe(1);
        expect(errors()).toContain("Building @x/a failed (exit 3)");
        expect(runs).toHaveLength(1);
    });
});
