import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../packages/cli/src/cli.ts";
import { parseArgs } from "../packages/cli/src/args.ts";
import {
    binderSource,
    discover,
    fileName,
    identifier,
    pickEvents,
    resolveEvent,
} from "../packages/cli/src/handlers.ts";
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
            "create",
            "command",
            "ping",
            "-d",
            "Pong",
            "--category=a/b",
            "-yf",
            "--",
            "--raw",
        ]);
        expect(args.positionals).toEqual([
            "create",
            "command",
            "ping",
            "--raw",
        ]);
        expect(args.flags.get("description")).toBe("Pong");
        expect(args.flags.get("category")).toBe("a/b");
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
        expect(text()).toContain("create handler");
        out = [];
        expect(await cli("--version")).toBe(0);
        expect(text()).toBe("9.9.9");
        out = [];
        expect(await cli("create handler --help")).toBe(0);
        expect(text()).toContain("Usage: lunibee create handler");
        out = [];
        expect(await cli("help sync handlers")).toBe(0);
        expect(text()).toContain("--check");
        out = [];
        expect(await cli("help create")).toBe(0);
        expect(text()).toContain("create component");
        expect(text()).not.toContain("publish");
    });

    test("groups and unknown commands", async () => {
        expect(await cli("create")).toBe(1);
        expect(text()).toContain("create command");
        expect(await cli("create --help")).toBe(0);
        expect(await cli("create handlr")).toBe(1);
        expect(errors()).toContain("`create handler`");
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
        expect(await cli("create handler ready --cwd src/deep")).toBe(0);
        expect(await read("src/events/ready/ready.ts")).toContain(
            'ClientEvents["ready"]',
        );
        expect(await findProjectRoot("/")).toBeNull();
    });

    test("--no-color and colors", async () => {
        expect(paint({ color: true }, "green", "x")).toBe("\x1b[32mx\x1b[0m");
        expect(await cli("sync handlers --no-color", { color: true })).toBe(0);
        expect(text()).not.toContain("\x1b[");
    });
});

describe("handlers", () => {
    test("event resolution accepts values, members and any case", () => {
        expect(String(resolveEvent("messageCreate"))).toBe("messageCreate");
        expect(String(resolveEvent("MESSAGECREATE"))).toBe("messageCreate");
        expect(String(resolveEvent("MessageCreate"))).toBe("messageCreate");
        expect(() => resolveEvent("messagecreat")).toThrow(
            "Unknown client event",
        );
        expect(() => resolveEvent("qqqqqqqqqqqq")).toThrow(
            "Unknown client event",
        );
        expect(pickEvents("1, messageCreate 1").map(String)).toEqual([
            "ready",
            "messageCreate",
        ]);
        expect(pickEvents("all").length).toBeGreaterThan(50);
        expect(() => pickEvents("9999")).toThrow("No event number");
    });

    test("names and identifiers are sanitised", () => {
        expect(identifier("default")).toBe("_default");
        expect(identifier("1x")).toBe("handler_1x");
        expect(fileName("my log.ts")).toBe("my-log.ts");
        expect(() => fileName("  ")).toThrow("empty");
        expect(() => fileName("../evil")).toThrow("Invalid name");
    });

    test("create several handlers, then sync is a no-op", async () => {
        expect(await cli("create handler messageCreate,guildCreate")).toBe(0);
        expect(text()).toContain("updated handlers/event.ts (2 handlers)");
        const binder = await read("src/handlers/event.ts");
        expect(binder).toContain("client.on(ClientEvent.MessageCreate");
        out = [];
        expect(await cli("sync handlers")).toBe(0);
        expect(text()).toContain("up to date");
        expect(await cli("sync handlers --check")).toBe(0);
    });

    test("legacy <event> <name>, --name, --force and --dry-run", async () => {
        expect(await cli("create handler messageCreate logger")).toBe(0);
        expect(await read("src/events/messageCreate/logger.ts")).toContain(
            "function logger(",
        );
        expect(await cli("create handler messageCreate --name logger")).toBe(0);
        expect(text()).toContain("skipped events/messageCreate/logger.ts");
        await writeFile(
            join(dir, "src/events/messageCreate/logger.ts"),
            "changed",
        );
        expect(
            await cli("create handler messageCreate --name logger --force"),
        ).toBe(0);
        expect(await read("src/events/messageCreate/logger.ts")).toContain(
            "export default",
        );
        out = [];
        expect(await cli("create handler ready --dry-run")).toBe(0);
        expect(text()).toContain("would create events/ready/ready.ts");
        expect(await cli("create handler ready guildCreate --name x")).toBe(1);
        expect(errors()).toContain("--name applies to a single event");
    });

    test("a second handler for an event defaults to handler.ts", async () => {
        await cli("create handler ready");
        await cli("create handler ready");
        expect(await read("src/events/ready/handler.ts")).toContain(
            "function handler(",
        );
    });

    test("interactive picker", async () => {
        expect(await cli("create handler")).toBe(1);
        expect(errors()).toContain("No event given");
        answers = ["ready, 1", ""];
        expect(await cli("create handler", { interactive: true })).toBe(0);
        expect(await read("src/events/ready/ready.ts")).toContain("ready");
        answers = ["ready", "second"];
        expect(await cli("create handler", { interactive: true })).toBe(0);
        expect(text()).toContain("ready already has 1 handler(s)");
        expect(await read("src/events/ready/second.ts")).toContain("second");
        answers = [null];
        expect(await cli("create handler", { interactive: true })).toBe(0);
        answers = [","];
        expect(await cli("create handler", { interactive: true })).toBe(1);
        expect(errors()).toContain("No events were selected");
    });

    test("sync warns about typos, missing default exports and duplicates", async () => {
        const events = join(dir, "src", "events");
        await mkdir(join(events, "messagecreate"), { recursive: true });
        await mkdir(join(events, "zzzzzzzzzzzzzz"), { recursive: true });
        await mkdir(join(events, "ready"), { recursive: true });
        await writeFile(join(events, "stray.ts"), "");
        await writeFile(join(events, "ready", "a.ts"), "export const x = 1;");
        await writeFile(
            join(events, "ready", "a.js"),
            "export default () => {};",
        );
        await writeFile(
            join(events, "ready", "a-b.ts"),
            "export { f as default };",
        );
        await writeFile(
            join(events, "ready", "a_b.ts"),
            "export default () => {};",
        );
        await writeFile(join(events, "ready", "a.test.ts"), "");
        await writeFile(join(events, "ready", "notes.md"), "");
        const found = await discover(events);
        expect(found.unknownFolders).toEqual([
            "messagecreate",
            "zzzzzzzzzzzzzz",
        ]);
        expect(found.missingDefault).toEqual(["ready/a.ts"]);
        expect(found.handlers.map((h) => h.importName).sort()).toEqual([
            "ready_a",
            "ready_a_b",
            "ready_a_b_2",
        ]);
        expect(await cli("sync handlers --dry-run")).toBe(0);
        expect(text()).toContain("would update");
        expect(await cli("sync handlers --check")).toBe(1);
        expect(errors()).toContain("did you mean messageCreate?");
        expect(errors()).toContain("is not a client event and is ignored");
        expect(binderSource([])).toContain("export function registerEvents");
    });
});

describe("create command", () => {
    test("with flags", async () => {
        expect(await cli("create command ping -d Pong! -c util/fun")).toBe(0);
        const source = await read("src/commands/util/fun/ping.ts");
        expect(source).toContain('.setName("ping")');
        expect(source).toContain('.setDescription("Pong!")');
        expect(source).toContain("export async function execute(");
        expect(source).toContain("export default data;");
        expect(await cli("create command ping -c util/fun")).toBe(1);
        expect(errors()).toContain("--force");
        expect(await cli("create command ping --force --dry-run")).toBe(0);
        expect(text()).toContain("would create commands/ping.ts");
    });

    test("validation", async () => {
        expect(await cli("create command Ping")).toBe(1);
        expect(await cli("create command ping -c ../x")).toBe(1);
        expect(errors()).toContain("Invalid category");
        expect(await cli(`create command ping -d ${"x".repeat(101)}`)).toBe(1);
        expect(await cli("create command")).toBe(1);
        expect(errors()).toContain("Usage: lunibee create command");
    });

    test("interactive", async () => {
        answers = ["hello", ""];
        expect(await cli("create command", { interactive: true })).toBe(0);
        expect(await read("src/commands/hello.ts")).toContain(
            "A Lunibee command.",
        );
        answers = [""];
        expect(await cli("create command", { interactive: true })).toBe(0);
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
        expect(text()).toContain("No handlers");
        expect(await cli("list commands")).toBe(0);
        expect(text()).toContain("No commands");
        await cli("create handler ready");
        await cli("create command ping -c util");
        await cli("create component button ok");
        await mkdir(join(dir, "src/events/typo"), { recursive: true });
        out = [];
        await cli("list handlers");
        expect(text()).toContain("ready\n  └─ ready.ts");
        expect(text()).toContain("typo/ (ignored");
        out = [];
        await cli("list handlers --json");
        expect(JSON.parse(text())).toEqual({
            handlers: { ready: ["ready.ts"] },
            ignoredFolders: ["typo"],
        });
        out = [];
        await cli("list commands");
        expect(text()).toBe("util/ping");
        out = [];
        await cli("list components --json");
        expect(JSON.parse(text())).toEqual(["ok"]);
        out = [];
        await cli("list events");
        expect(out).toContain("guildRoleUpdate");
        out = [];
        await cli("list events --json");
        expect(JSON.parse(text())).toContain("ready");
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
        await cli("create handler ready");
        await mkdir(join(dir, "src/commands"), { recursive: true });
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
        expect(text()).not.toContain("secret-value");
        out = [];
        expect(await cli("check --json")).toBe(0);
        expect(JSON.parse(text()).ok).toBe(true);
    });

    test("problems are reported with exit code 1", async () => {
        await mkdir(join(dir, "src/events/ready"), { recursive: true });
        await writeFile(
            join(dir, "src/events/ready/a.ts"),
            "export const a = 1;",
        );
        await mkdir(join(dir, "src/events/typo"), { recursive: true });
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
        expect(report).toContain("has no default export");
        expect(report).toContain("is out of date");
        expect(report).toContain("not a client event");
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
        await cli("create command ping");
        out = [];
        expect(await cli("info")).toBe(0);
        expect(text()).toContain("Project:    bot@1.0.0");
        expect(text()).toContain("lunibee@^0.2.2 (not installed)");
        expect(text()).toContain("Commands:   1");
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
