import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../packages/cli/src/cli.ts";
import { maskCode, RENAMED, scanSource } from "../packages/cli/src/migrate.ts";
import { escapeRegExp, type IO } from "../packages/cli/src/io.ts";

const found = (source: string) =>
    scanSource(source).manual.map((f) => [f.line, f.found]);

test("escapeRegExp matches metacharacters literally", () => {
    const text = "a.b*c+$d(e)[f]{g}|h\\i^j?k/l-m";
    expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
    expect(new RegExp(escapeRegExp("a.b")).test("axb")).toBe(false);
});

test("maskCode blanks text but keeps offsets and code inside ${}", () => {
    const input = "a(`t ${b('x')} u`, /\\//, 'c') // d";
    expect(maskCode(input)).toBe("a(`  ${b(' ')}  `, /  /, ' ')     ");
    expect(maskCode("x = a / b; /* c */ y = /re/.test(z) ? 1 : 2;")).toBe(
        "x = a / b;         y = /  /.test(z) ? 1 : 2;",
    );
});

describe("scanSource: renames", () => {
    test("every 0.4.0 rename", () => {
        expect(RENAMED).toEqual({
            CachedManager: "ResourceManager",
            ClientUser: "UserData",
            CreateChannelSelectMenu: "CreateChannelSelect",
            CreateMentionableSelectMenu: "CreateMentionableSelect",
            CreateMessageOptions: "MessageCreateOptions",
            CreateRoleSelectMenu: "CreateRoleSelect",
            CreateStringSelectMenu: "CreateStringSelect",
            CreateUserSelectMenu: "CreateUserSelect",
            DiscordAPIError: "RESTError",
            Events: "ClientEvent",
            FollowUpOptions: "InteractionReplyOptions",
            Intents: "IntentBits",
            InteractionUpdateOptions: "InteractionReplyOptions",
            SendBudget: "GatewaySendLimiter",
            ShardingManager: "ShardManager",
            Status: "GatewayState",
        });
    });

    test("renames imports from lunibee and their uses", () => {
        const { source, fixable, manual } = scanSource(
            'import { Events, CreateStringSelectMenu, type Status } from "lunibee";\n' +
                "client.on(Events.MessageCreate, () => {});\n" +
                "const menu = new CreateStringSelectMenu();\n" +
                "let s: Status = flag ? Status.Ready : other;\n",
        );
        expect(source).toBe(
            'import { ClientEvent, CreateStringSelect, type GatewayState } from "lunibee";\n' +
                "client.on(ClientEvent.MessageCreate, () => {});\n" +
                "const menu = new CreateStringSelect();\n" +
                "let s: GatewayState = flag ? GatewayState.Ready : other;\n",
        );
        expect(fixable.map((f) => `${f.line}:${f.found}→${f.use}`)).toEqual([
            "1:Events→ClientEvent",
            "1:CreateStringSelectMenu→CreateStringSelect",
            "1:Status→GatewayState",
        ]);
        expect(manual).toEqual([]);
    });

    test("only in files that import the name from lunibee or @lunibee/*", () => {
        const discord =
            'import { Events, Status } from "discord.js";\nclient.on(Events.MessageCreate, f);\nStatus.Ready;\n';
        expect(scanSource(discord)).toEqual({
            fixable: [],
            manual: [],
            source: discord,
        });
        // A Lunibee import does not make other packages' names Lunibee's.
        const mixed =
            'import { CreateEmbed } from "lunibee";\nimport { Events } from "node:events";\nEvents;\n';
        expect(scanSource(mixed).source).toBe(mixed);
        // A commented-out import does not count.
        const commented = '// import { Events } from "lunibee";\nEvents;\n';
        expect(scanSource(commented).source).toBe(commented);
    });

    test("import { X as Y } keeps Y; duplicates and multi-line imports", () => {
        expect(
            scanSource(
                'import { Events as E, ShardingManager } from "@lunibee/core";\nE.Ready; new ShardingManager();\n',
            ).source,
        ).toBe(
            'import { ClientEvent as E, ShardManager } from "@lunibee/core";\nE.Ready; new ShardManager();\n',
        );
        expect(
            scanSource(
                'import type { InteractionUpdateOptions, FollowUpOptions, InteractionReplyOptions } from "lunibee";\nlet a: FollowUpOptions;\n',
            ).source,
        ).toBe(
            'import type { InteractionReplyOptions } from "lunibee";\nlet a: InteractionReplyOptions;\n',
        );
        const multi = scanSource(
            'import {\n    Client,\n    Intents,\n    DiscordAPIError,\n} from "lunibee";\nnew Client({ intents: [Intents.Guilds] });\ne instanceof DiscordAPIError;\n',
        );
        expect(multi.source).toBe(
            'import {\n    Client,\n    IntentBits,\n    RESTError,\n} from "lunibee";\nnew Client({ intents: [IntentBits.Guilds] });\ne instanceof RESTError;\n',
        );
        expect(multi.fixable.map((f) => f.line)).toEqual([3, 4]);
    });

    test("namespace imports", () => {
        const { source, fixable } = scanSource(
            'import * as lb from "lunibee";\nlb.Events.Ready; new lb.CachedManager(); lb.Client;\n',
        );
        expect(source).toBe(
            'import * as lb from "lunibee";\nlb.ClientEvent.Ready; new lb.ResourceManager(); lb.Client;\n',
        );
        expect(fixable.map((f) => f.found)).toEqual([
            "lb.Events",
            "lb.CachedManager",
        ]);
    });

    test("leaves strings, comments, property names and object keys alone", () => {
        const { source } = scanSource(
            'import { Status, SendBudget } from "lunibee";\n' +
                '// Status in a comment\nconst s = "Status"; obj.Status; obj?.Status;\n' +
                "const o = { Status: 1, x: SendBudget };\n" +
                "const t = `${Status.Idle} Status`;\n",
        );
        expect(source).toBe(
            'import { GatewayState, GatewaySendLimiter } from "lunibee";\n' +
                '// Status in a comment\nconst s = "Status"; obj.Status; obj?.Status;\n' +
                "const o = { Status: 1, x: GatewaySendLimiter };\n" +
                "const t = `${GatewayState.Idle} Status`;\n",
        );
    });
});

describe("scanSource: reported for a hand change", () => {
    test("IntentsBitField, at the import and each use", () => {
        const input =
            'import { IntentsBitField as Bits, Client } from "lunibee";\nconst i = new Bits([Bits.Flags.Guilds]);\nnew Client({ intents: i });\n';
        const { source, manual } = scanSource(input);
        expect(source).toBe(input);
        expect(manual.map((f) => [f.line, f.found])).toEqual([
            [1, "IntentsBitField"],
            [2, "Bits"],
        ]);
        expect(manual[0]!.use).toContain("array of GatewayIntentBits");
        expect(
            found(
                'import * as lb from "lunibee";\nnew lb.IntentsBitField();\n',
            ),
        ).toEqual([[2, "lb.IntentsBitField"]]);
        expect(
            found(
                'import { IntentsBitField } from "discord.js";\nnew IntentsBitField();\n',
            ),
        ).toEqual([]);
    });

    test("webhook payload keys, only with a Lunibee WebhookClient", () => {
        const input =
            'import { WebhookClient } from "lunibee";\nawait hook.send({ content, avatarURL: url, threadId: id, allowedMentions: { parse: [] } });\nconst { threadId } = options;\n';
        const { manual } = scanSource(input);
        expect(manual.map((f) => [f.line, f.found, f.use])).toEqual([
            [
                2,
                "avatarURL:",
                "check: in a WebhookClient payload, use avatar_url",
            ],
            [
                2,
                "threadId:",
                "check: in a WebhookClient payload, use thread_id",
            ],
            [
                2,
                "allowedMentions:",
                "check: in a WebhookClient payload, use allowed_mentions",
            ],
        ]);
        expect(
            found(
                'import { Client } from "lunibee";\nnew Client({ allowedMentions: { parse: [] } });\n',
            ),
        ).toEqual([]);
    });

    test("REST calls with { body } and request({ method, path })", () => {
        const input =
            'import { Routes } from "lunibee";\n' +
            "await client.rest.put(Routes.applicationCommands(id), { body: commands });\n" +
            "await rest.post(route, { body, files });\n" +
            "await rest.patch(route, body, { reason: 'x' });\n" +
            "await rest.post(route, { content: 'body' });\n" +
            "await rest.request({ method: 'GET', fullRoute: route });\n" +
            "await rest.request({ method, path });\n" +
            "await rest.request('GET', route);\n" +
            "await rest.put(route, {\n    body: { a: [1, 2] },\n});\n";
        const { source, manual } = scanSource(input);
        expect(source).toBe(input);
        expect(manual.map((f) => [f.line, f.found])).toEqual([
            [2, "put(path, { body })"],
            [3, "post(path, { body })"],
            [6, "request({ method, path })"],
            [7, "request({ method, path })"],
            [9, "put(path, { body })"],
        ]);
        expect(manual[0]!.use).toContain("put(path, body, options)");
        expect(manual[2]!.use).toBe("request(method, path, body, options)");
        // Another HTTP client in a file without a Lunibee import is not checked.
        expect(found("await ky.post(url, { body });\n")).toEqual([]);
    });

    test("0.3 voice APIs", () => {
        const { manual } = scanSource(
            'import { joinVoiceChannel, VoiceConnectionState, type AudioStream } from "@lunibee/voice";\n' +
                "const c = joinVoiceChannel({ guildId, channelId });\n" +
                "c.attachTransports(gateway, udp);\n" +
                "if (c.state === VoiceConnectionState.Connected) {}\n" +
                "joinVoiceChannel({ guildId, channelId, adapterCreator });\n" +
                "joinVoiceChannel(options);\n" +
                "let s: AudioStream;\n",
        );
        expect(manual.map((f) => [f.line, f.found])).toEqual([
            [1, "VoiceConnectionState"],
            [1, "AudioStream"],
            [2, "joinVoiceChannel()"],
            [3, "attachTransports()"],
            [4, "VoiceConnectionState"],
            [7, "AudioStream"],
        ]);
        expect(manual[0]!.use).toContain("VoiceConnectionStatus");
        expect(manual[0]!.use).toContain("client.voice.join");
        expect(manual[2]!.use).toStartWith("check:");
        expect(manual[2]!.use).toContain("adapterCreator");
    });

    test("new Client() in a cluster worker without gateway:", () => {
        const worker = (client: string) =>
            found(
                `import { Client, ClusterWorker } from "lunibee";\nconst ctx = ClusterWorker.current()!.context;\n${client}\n`,
            );
        expect(worker("const c = new Client({ intents });")).toEqual([
            [3, "new Client()"],
        ]);
        expect(worker("new Client();")).toEqual([[3, "new Client()"]]);
        expect(
            worker(
                "new Client({\n    intents,\n    gateway: { shardId: ctx.shardIds[0], shardCount: ctx.shardCount },\n});",
            ),
        ).toEqual([]);
        expect(worker("new Client({ ...options });")).toEqual([]);
        expect(worker("new Client(options);")).toEqual([]);
        expect(
            found(
                'import * as lb from "lunibee";\nlb.ShardBus;\nnew lb.Client({ intents });\n',
            ),
        ).toEqual([[3, "new Client()"]]);
        expect(
            found(
                'import { Client } from "lunibee";\nnew Client({ intents });\n',
            ),
        ).toEqual([]);
        expect(
            scanSource(
                `import { Client, ShardBus } from "lunibee";\nnew Client({ intents });\n`,
            ).manual[0]!.use,
        ).toContain(
            "check: a Client in a cluster worker needs gateway: { shardId, shardCount }",
        );
    });

    test("unclosed calls and odd specifiers do not throw", () => {
        expect(
            found(
                'import { Routes, default as x, } from "lunibee";\nrest.put(route, { body\n',
            ),
        ).toEqual([]);
    });
});

describe("lunibee migrate", () => {
    let dir: string;
    let output: string[];
    const io = (): IO => ({
        cwd: dir,
        out: (line) => void output.push(line),
        err: (line) => void output.push(line),
        prompt: () => null,
        interactive: false,
        color: false,
        run: async () => 0,
    });
    const run = (argv: string) =>
        main(argv.split(" "), io(), { version: "1", lunibeeRoot: dir });
    const text = () => output.join("\n");

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "lunibee-migrate-"));
        output = [];
        await writeFile(join(dir, "package.json"), '{"name":"bot"}');
        await mkdir(join(dir, "src", "events"), { recursive: true });
        await writeFile(
            join(dir, "src", "events", "ready.ts"),
            'import { Events } from "lunibee";\nexport default { name: Events.ClientReady };\n',
        );
        await writeFile(
            join(dir, "src", "menu.tsx"),
            'import { CreateUserSelectMenu } from "@lunibee/builders";\nnew CreateUserSelectMenu();\n',
        );
        await writeFile(
            join(dir, "src", "clean.js"),
            'import { CreateEmbed } from "lunibee";\nnew CreateEmbed();\n',
        );
        await writeFile(join(dir, "src", "types.d.ts"), "Events;\n");
        await writeFile(join(dir, "src", "notes.md"), "Events\n");
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    test("reports without writing, --dry-run writes nothing, --fix renames and exits 0", async () => {
        const file = join(dir, "src", "events", "ready.ts");
        const before = await readFile(file, "utf8");
        expect(await run(`migrate --cwd ${dir}`)).toBe(1);
        expect(await readFile(file, "utf8")).toBe(before);
        expect(text()).toContain(
            `${join("src", "events", "ready.ts")}:1 rename Events → ClientEvent`,
        );
        expect(text()).toContain("3 files checked, 2 to fix");
        expect(text()).toContain("lunibee migrate --fix");
        output = [];
        expect(await run(`migrate --fix --dry-run --cwd ${dir}`)).toBe(1);
        expect(text()).toContain("would rename");
        expect(await readFile(file, "utf8")).toBe(before);
        output = [];
        expect(await run(`migrate --fix --cwd ${dir}`)).toBe(0);
        expect(text()).toContain("renamed Events → ClientEvent");
        expect(text()).toContain("2 fixed, 0 to change by hand");
        expect(await readFile(file, "utf8")).toBe(
            'import { ClientEvent } from "lunibee";\nexport default { name: ClientEvent.ClientReady };\n',
        );
        expect(await readFile(join(dir, "src", "menu.tsx"), "utf8")).toContain(
            "new CreateUserSelect()",
        );
        expect(await readFile(join(dir, "src", "types.d.ts"), "utf8")).toBe(
            "Events;\n",
        );
        output = [];
        expect(await run(`migrate --cwd ${dir}`)).toBe(0);
        expect(text()).toContain("0 to fix, 0 to change by hand");
    });

    test("hand changes keep the exit code at 1 after --fix", async () => {
        await writeFile(
            join(dir, "src", "worker.ts"),
            'import { Client, ShardBus } from "lunibee";\nnew Client({ intents });\nawait client.rest.put(route, { body });\n',
        );
        expect(await run(`migrate --fix --cwd ${dir}`)).toBe(1);
        const report = text();
        expect(report).toContain(
            `${join("src", "worker.ts")}:3 put(path, { body }): use put(path, body, options)`,
        );
        expect(report).toContain(
            `${join("src", "worker.ts")}:2 new Client(): check: a Client in a cluster worker`,
        );
        expect(report).toContain("Lines marked check: are guesses");
        expect(report).toContain("2 to change by hand");
    });

    test("--json reports files, renames and hand changes", async () => {
        await writeFile(
            join(dir, "src", "old.ts"),
            'import { IntentsBitField } from "lunibee";\n',
        );
        expect(await run(`migrate --json --cwd ${dir}`)).toBe(1);
        const report = JSON.parse(output.at(-1)!);
        expect(report.files).toBe(4);
        expect(report.fixable).toHaveLength(2);
        expect(report.fixable[0]).toEqual({
            file: join("src", "events", "ready.ts"),
            line: 1,
            found: "Events",
            use: "ClientEvent",
        });
        expect(report.manual).toEqual([
            {
                file: join("src", "old.ts"),
                line: 1,
                found: "IntentsBitField",
                use: "an array of GatewayIntentBits, e.g. [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]",
            },
        ]);
    });

    test("a project without src/ has nothing to do", async () => {
        await rm(join(dir, "src"), { recursive: true });
        expect(await run(`migrate --cwd ${dir}`)).toBe(0);
        expect(text()).toContain("0 files checked");
    });
});
