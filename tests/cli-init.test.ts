import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { main } from "../packages/cli/src/cli.ts";
import { initFiles } from "../packages/cli/src/init.ts";
import type { IO } from "../packages/cli/src/io.ts";

const ROOT = join(import.meta.dir, "..");
const TOKEN = "MTAwMDAwMDAwMDAwMDAwMDAx.fake-token.for-tests-only";
const APP = "100000000000000002";
const GUILD = "100000000000000003";

let dir: string;
let out: string[];
let err: string[];
let answers: (string | null)[];
let runs: string[][];

function io(overrides: Partial<IO> = {}): IO {
    return {
        cwd: dir,
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        prompt: () => (answers.length ? answers.shift()! : null),
        interactive: false,
        color: false,
        run: async (command) => {
            runs.push(command);
            return 0;
        },
        ...overrides,
    };
}
const cli = (argv: string, overrides?: Partial<IO>) =>
    main(argv.split(" ").filter(Boolean), io(overrides), {
        version: "0.4.0",
        lunibeeRoot: ROOT,
    });

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "lunibee-init-"));
    out = [];
    err = [];
    answers = [];
    runs = [];
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const EXPECTED = [
    ".env.example",
    ".gitignore",
    "LICENSE",
    "README.md",
    "package.json",
    "src/commands/info/ping.ts",
    "src/config.ts",
    "src/events/interaction/interactionCreate.ts",
    "src/events/message/messageCreate.ts",
    "src/handlers/commands.ts",
    "src/handlers/events.ts",
    "src/index.ts",
    "src/services/register.ts",
    "src/types/index.ts",
    "src/utils/logger.ts",
    "tsconfig.json",
];

describe("lunibee init", () => {
    test("generates the project", async () => {
        expect(await cli("init my-bot")).toBe(0);
        const files = initFiles({ name: "my-bot", lunibee: "^0.4.0" });
        expect(Object.keys(files).sort()).toEqual(EXPECTED);
        for (const path of EXPECTED)
            expect(await readFile(join(dir, "my-bot", path), "utf8")).toBe(
                files[path]!,
            );
        const pkg = JSON.parse(files["package.json"]!);
        expect(pkg.name).toBe("my-bot");
        expect(pkg.dependencies).toEqual({ lunibee: "^0.4.0" });
        expect(Object.keys(pkg.scripts).sort()).toEqual([
            "build",
            "dev",
            "start",
            "typecheck",
        ]);
        // No deploy script: registration happens on start.
        expect(JSON.stringify(pkg.scripts)).not.toMatch(/deploy|register/);
        expect(files["README.md"]).toStartWith("# my-bot\n\nA Lunibee bot");
        expect(files["LICENSE"]).toContain("The my-bot authors");
        expect(out.join("\n")).toContain("cd my-bot");
        expect(runs).toEqual([]);
    });

    test(".env.example lists every variable config.ts reads, and .gitignore keeps it", () => {
        const files = initFiles({ name: "x", lunibee: "^0.4.0" });
        const read = [
            ...files["src/config.ts"]!.matchAll(/env\.([A-Z_]+)/g),
        ].map((m) => m[1]!);
        const listed = [
            ...files[".env.example"]!.matchAll(/^([A-Z_]+)=/gm),
        ].map((m) => m[1]!);
        expect([...new Set(read)].sort()).toEqual(listed.sort());
        expect(files[".gitignore"]).toContain("\n.env\n");
        expect(files[".gitignore"]).toContain("!.env.example");
        expect(files[".env.example"]).not.toMatch(
            /DISCORD_TOKEN=(?!your_bot_token_here)\S/,
        );
    });

    test("--install runs bun install in the project", async () => {
        expect(await cli("init bots/alpha --install")).toBe(0);
        expect(runs).toEqual([["bun", "install"]]);
        expect(out.join("\n")).not.toContain("  bun install");
    });

    test("validates the name and requires a directory without a terminal", async () => {
        expect(await cli("init My_Bot")).toBe(1);
        expect(err.join("\n")).toContain("Invalid project name: My_Bot");
        expect(await cli("init")).toBe(1);
        expect(err.join("\n")).toContain("Usage: lunibee init <directory>");
        answers = ["prompted"];
        expect(await cli("init", { interactive: true })).toBe(0);
        expect(
            await Bun.file(join(dir, "prompted/package.json")).exists(),
        ).toBe(true);
    });

    test("never overwrites without --force, and --force asks first", async () => {
        await mkdir(join(dir, "app/src"), { recursive: true });
        await writeFile(join(dir, "app/package.json"), "mine");
        await writeFile(join(dir, "app/notes.txt"), "keep");
        expect(await cli("init app")).toBe(1);
        expect(err.join("\n")).toContain("package.json");
        expect(await readFile(join(dir, "app/package.json"), "utf8")).toBe(
            "mine",
        );
        expect(await cli("init app --force")).toBe(1);
        expect(err.join("\n")).toContain("Pass --yes");
        answers = ["n"];
        expect(await cli("init app --force", { interactive: true })).toBe(1);
        expect(await readFile(join(dir, "app/package.json"), "utf8")).toBe(
            "mine",
        );
        expect(await cli("init app --dry-run --force")).toBe(0);
        expect(await readFile(join(dir, "app/package.json"), "utf8")).toBe(
            "mine",
        );
        answers = ["y"];
        expect(await cli("init app --force", { interactive: true })).toBe(0);
        expect(await readFile(join(dir, "app/package.json"), "utf8")).not.toBe(
            "mine",
        );
        expect(await readFile(join(dir, "app/notes.txt"), "utf8")).toBe("keep");
        expect(out.join("\n")).toContain("overwrote package.json");
        await writeFile(join(dir, "file"), "x");
        expect(await cli("init file")).toBe(1);
        expect(err.join("\n")).toContain("not a directory");
    });

    test("lunibee check accepts the runtime discovery layout", async () => {
        expect(await cli("init my-bot")).toBe(0);
        out = [];
        expect(await cli(`check --cwd my-bot`)).toBe(0);
        const report = out.join("\n");
        expect(report).toContain(
            "src/handlers/events.ts finds events at runtime",
        );
        expect(report).not.toContain("is not a client event");
        expect(report).not.toContain("out of date");
    });

    test("a folder with unrelated files is fine", async () => {
        await mkdir(join(dir, "existing"));
        await writeFile(join(dir, "existing/notes.txt"), "keep");
        expect(await cli("init existing")).toBe(0);
        expect(out.join("\n")).toContain("left alone");
    });
});

/** A Discord stand-in: REST under /api/v10 and a Gateway at /gateway. */
function fakeDiscord(options: { registerStatus?: number } = {}) {
    const puts: { path: string; body: unknown }[] = [];
    const callbacks: unknown[] = [];
    const edits: unknown[] = [];
    let socket: ServerWebSocket<unknown> | undefined;
    let ready!: () => void;
    const identified = new Promise<void>((resolve) => (ready = resolve));
    let sequence = 0;
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(request, srv) {
            const url = new URL(request.url);
            if (url.pathname === "/gateway") {
                if (srv.upgrade(request)) return;
                return new Response("upgrade required", { status: 426 });
            }
            if (url.pathname.endsWith("/gateway/bot"))
                return Response.json({
                    url: "wss://gateway.discord.gg",
                    shards: 1,
                    session_start_limit: {
                        total: 1000,
                        remaining: 1000,
                        reset_after: 0,
                        max_concurrency: 1,
                    },
                });
            if (
                request.method === "PUT" &&
                url.pathname.endsWith("/commands")
            ) {
                const body = await request.json();
                puts.push({ path: url.pathname, body });
                if (options.registerStatus)
                    return Response.json(
                        { message: "401: Unauthorized", code: 0 },
                        { status: options.registerStatus },
                    );
                return Response.json(body);
            }
            if (
                request.method === "POST" &&
                url.pathname.endsWith("/callback")
            ) {
                callbacks.push(await request.json());
                return new Response(null, { status: 204 });
            }
            if (
                request.method === "PATCH" &&
                url.pathname.includes("/messages/@original")
            ) {
                edits.push(await request.json());
                return Response.json({
                    id: "1",
                    channel_id: "1",
                    content: "",
                    author: { id: "1", username: "x" },
                });
            }
            return Response.json(
                { message: "Unknown", code: 0 },
                { status: 404 },
            );
        },
        websocket: {
            open(ws) {
                socket = ws;
                ws.send(
                    JSON.stringify({
                        op: 10,
                        d: { heartbeat_interval: 45000 },
                    }),
                );
            },
            message(ws, raw) {
                const frame = JSON.parse(String(raw)) as { op: number };
                if (frame.op === 1) ws.send(JSON.stringify({ op: 11 }));
                if (frame.op === 2) {
                    ws.send(
                        JSON.stringify({
                            op: 0,
                            t: "READY",
                            s: ++sequence,
                            d: {
                                v: 10,
                                user: {
                                    id: "100000000000000001",
                                    username: "testbot",
                                    discriminator: "0",
                                    bot: true,
                                },
                                guilds: [],
                                session_id: "session",
                                resume_gateway_url: `ws://127.0.0.1:${server.port}/gateway`,
                                application: { id: APP, flags: 0 },
                            },
                        }),
                    );
                    ready();
                }
            },
        },
    });
    return {
        url: `http://127.0.0.1:${server.port}`,
        puts,
        callbacks,
        edits,
        identified,
        dispatch(t: string, d: unknown) {
            socket?.send(JSON.stringify({ op: 0, t, s: ++sequence, d }));
        },
        stop: () => server.stop(true),
    };
}

/** Redirects discord.com and the Gateway to the fake, below Lunibee. */
const PRELOAD = `
const base = new URL(process.env.FAKE_DISCORD);
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "discord.com") { url.protocol = base.protocol; url.host = base.host; }
    return realFetch(url, init);
};
const RealWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends RealWebSocket {
    constructor(url, protocols) {
        const target = new URL(String(url));
        if (target.hostname.endsWith("discord.gg")) { target.protocol = "ws:"; target.host = base.host; target.pathname = "/gateway"; }
        super(target, protocols);
    }
};
`;

describe("the generated project", () => {
    let project: string;

    beforeAll(async () => {
        project = await mkdtemp(join(tmpdir(), "lunibee-bot-"));
        const files = initFiles({ name: "test-bot", lunibee: "^0.4.0" });
        for (const [path, source] of Object.entries(files)) {
            await mkdir(join(project, path, ".."), { recursive: true });
            await writeFile(join(project, path), source);
        }
        // `lunibee` from this checkout's sources: no install, no build needed.
        await mkdir(join(project, "node_modules/lunibee"), { recursive: true });
        await writeFile(
            join(project, "node_modules/lunibee/package.json"),
            JSON.stringify({
                name: "lunibee",
                type: "module",
                exports: "./index.ts",
            }),
        );
        await writeFile(
            join(project, "node_modules/lunibee/index.ts"),
            `export * from ${JSON.stringify(join(ROOT, "packages/lunibee/src/index.ts"))};\n`,
        );
        await writeFile(join(project, "preload.js"), PRELOAD);
        // A second command in a nested category, found by the same discovery.
        await mkdir(join(project, "src/commands/fun/dice"), {
            recursive: true,
        });
        await writeFile(
            join(project, "src/commands/fun/dice/roll.ts"),
            `import { CreateSlashCommand } from "lunibee";\nimport { defineCommand } from "../../../types/index.js";\nexport default defineCommand({\n    data: new CreateSlashCommand().setName("roll").setDescription("Rolls."),\n    async execute({ interaction }) { await interaction.reply("4"); },\n});\n`,
        );
    });
    afterAll(() => rm(project, { recursive: true, force: true }));

    async function run(
        env: Record<string, string>,
        discord: ReturnType<typeof fakeDiscord>,
    ) {
        const child = Bun.spawn(
            ["bun", "--preload", "./preload.js", "src/index.ts"],
            {
                cwd: project,
                env: {
                    PATH: process.env.PATH!,
                    HOME: process.env.HOME ?? "",
                    FAKE_DISCORD: discord.url,
                    NO_COLOR: "1",
                    ...env,
                },
                stdout: "pipe",
                stderr: "pipe",
            },
        );
        return child;
    }
    const output = async (child: Bun.Subprocess<"ignore", "pipe", "pipe">) =>
        (await new Response(child.stdout).text()) +
        (await new Response(child.stderr).text());

    test("registers the discovered commands in a guild, logs in and answers /ping", async () => {
        const discord = fakeDiscord();
        const child = await run(
            { DISCORD_TOKEN: TOKEN, CLIENT_ID: APP, GUILD_ID: GUILD },
            discord,
        );
        try {
            await Promise.race([discord.identified, Bun.sleep(10_000)]);
            expect(discord.puts).toHaveLength(1);
            expect(discord.puts[0]!.path).toBe(
                `/api/v10/applications/${APP}/guilds/${GUILD}/commands`,
            );
            const names = (discord.puts[0]!.body as { name: string }[])
                .map((c) => c.name)
                .sort();
            expect(names).toEqual(["ping", "roll"]);
            discord.dispatch("INTERACTION_CREATE", {
                id: "1300000000000000000",
                application_id: APP,
                type: 2,
                token: "interaction-token",
                version: 1,
                guild_id: GUILD,
                channel_id: "100000000000000004",
                member: {
                    user: { id: "100000000000000005", username: "someone" },
                    roles: [],
                },
                data: { id: "100000000000000006", name: "ping", type: 1 },
            });
            for (let i = 0; i < 200 && discord.edits.length === 0; i++)
                await Bun.sleep(25);
            expect(discord.callbacks).toEqual([
                { type: 4, data: { content: "Pinging…" } },
            ]);
            expect(JSON.stringify(discord.edits[0])).toMatch(
                /Pong! Gateway: .* · Response: \d+ ms/,
            );
        } finally {
            child.kill();
            const text = await output(child);
            discord.stop();
            expect(text).toContain("Registered 2 command(s) for server");
            expect(text).toContain("Online as testbot");
            expect(text).not.toContain(TOKEN);
        }
    }, 20_000);

    test("registers globally without GUILD_ID", async () => {
        const discord = fakeDiscord();
        const child = await run(
            { DISCORD_TOKEN: TOKEN, CLIENT_ID: APP },
            discord,
        );
        await Promise.race([discord.identified, Bun.sleep(10_000)]);
        child.kill();
        await child.exited;
        discord.stop();
        expect(discord.puts.map((p) => p.path)).toEqual([
            `/api/v10/applications/${APP}/commands`,
        ]);
    }, 20_000);

    test("a refused registration stops startup before login", async () => {
        const discord = fakeDiscord({ registerStatus: 401 });
        const child = await run(
            { DISCORD_TOKEN: TOKEN, CLIENT_ID: APP, GUILD_ID: GUILD },
            discord,
        );
        const code = await child.exited;
        const text = await output(child);
        discord.stop();
        expect(code).toBe(1);
        expect(text).toContain("Startup failed.");
        expect(text).toContain("Could not register 2 command(s)");
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain("Online as");
    }, 20_000);

    test("invalid configuration stops startup and names every problem", async () => {
        const discord = fakeDiscord();
        const child = await run(
            {
                DISCORD_TOKEN: "",
                CLIENT_ID: "abc",
                GUILD_ID: "1",
                NODE_ENV: "staging",
            },
            discord,
        );
        const code = await child.exited;
        const text = await output(child);
        discord.stop();
        expect(code).toBe(1);
        for (const name of [
            "DISCORD_TOKEN",
            "CLIENT_ID",
            "GUILD_ID",
            "NODE_ENV",
        ])
            expect(text).toContain(name);
        expect(discord.puts).toEqual([]);
    }, 20_000);

    test("reads the root .env, and a duplicate command name stops startup", async () => {
        const discord = fakeDiscord();
        await writeFile(
            join(project, ".env"),
            `DISCORD_TOKEN="${TOKEN}"\nCLIENT_ID=${APP} # app\n`,
        );
        const duplicate = join(project, "src/commands/fun/ping.ts");
        await writeFile(
            duplicate,
            await readFile(join(project, "src/commands/info/ping.ts"), "utf8"),
        );
        try {
            const child = await run({}, discord);
            const code = await child.exited;
            const text = await output(child);
            expect(code).toBe(1);
            expect(text).toContain('Two commands are named "ping"');
            expect(discord.puts).toEqual([]);
        } finally {
            await rm(duplicate);
            await rm(join(project, ".env"));
            discord.stop();
        }
    }, 20_000);
});
