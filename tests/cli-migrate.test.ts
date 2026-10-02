import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../packages/cli/src/cli.ts";
import { maskCode, scanSource } from "../packages/cli/src/deprecations.ts";
import { escapeRegExp, type IO } from "../packages/cli/src/io.ts";

test("escapeRegExp matches metacharacters literally", () => {
    const text = "a.b*c+$d(e)[f]{g}|h\\i^j?k/l-m";
    expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
    expect(new RegExp(escapeRegExp("a.b")).test("axb")).toBe(false);
});

describe("scanSource", () => {
    test("renames old names imported from lunibee, with their uses", () => {
        const { source, fixable } = scanSource(
            'import { ButtonBuilder, ButtonStyle, type ChannelType } from "lunibee";\n' +
                "const b = new ButtonBuilder().setStyle(ButtonStyle.Primary);\n" +
                "let t: ChannelType;\n",
        );
        expect(source).toBe(
            'import { CreateButton, ButtonType, type ChannelEnum } from "lunibee";\n' +
                "const b = new CreateButton().setStyle(ButtonType.Primary);\n" +
                "let t: ChannelEnum;\n",
        );
        expect(fixable.map((f) => `${f.found}→${f.use}`)).toEqual([
            "ButtonBuilder→CreateButton",
            "ButtonStyle→ButtonType",
            "ChannelType→ChannelEnum",
        ]);
    });

    test("leaves discord.js names alone", () => {
        const source =
            'import { EmbedBuilder } from "discord.js";\nnew EmbedBuilder();\n';
        expect(scanSource(source)).toEqual({ fixable: [], manual: [], source });
    });

    test("handles aliases, duplicates, multi-line imports and namespaces", () => {
        expect(
            scanSource(
                'import { EmbedBuilder as Embed, CreateEmbed, EmbedBuilder } from "@lunibee/builders";\nnew Embed(); new EmbedBuilder();\n',
            ).source,
        ).toBe(
            'import { CreateEmbed as Embed, CreateEmbed } from "@lunibee/builders";\nnew Embed(); new CreateEmbed();\n',
        );
        expect(
            scanSource(
                'import {\n    ModalBuilder,\n    Routes,\n} from "lunibee";\nnew ModalBuilder(); Routes.channelPin(a, b);\n',
            ).source,
        ).toBe(
            'import {\n    CreateModal,\n    Routes,\n} from "lunibee";\nnew CreateModal(); Routes.channelMessagesPin(a, b);\n',
        );
        expect(
            scanSource(
                'import * as lb from "lunibee";\nnew lb.SlashCommandBuilder(); lb.Routes.channelPin(a, b);\n',
            ).source,
        ).toBe(
            'import * as lb from "lunibee";\nnew lb.CreateSlashCommand(); lb.Routes.channelMessagesPin(a, b);\n',
        );
    });

    test("finds uses after template literals, nested ${} and regex literals", () => {
        const { source } = scanSource(
            'import { EmbedBuilder, ButtonStyle } from "lunibee";\n' +
                "const a = `x ${flag ? `y ${n}` : 'z'} \" ' w`;\n" +
                "const re = /[\"'`]/g; const q = s.split(/'/);\n" +
                "new EmbedBuilder(); ButtonStyle.Primary;\n",
        );
        expect(source).toContain("new CreateEmbed(); ButtonType.Primary;");
    });

    test("does not rewrite names in strings, comments or property keys", () => {
        const { source } = scanSource(
            'import { EmbedBuilder } from "lunibee";\n' +
                '// EmbedBuilder in a comment\nconst s = "EmbedBuilder"; obj.EmbedBuilder;\n',
        );
        expect(source).toBe(
            'import { CreateEmbed } from "lunibee";\n' +
                '// EmbedBuilder in a comment\nconst s = "EmbedBuilder"; obj.EmbedBuilder;\n',
        );
    });

    test("lists calls to change by hand without touching them", () => {
        const input =
            "roles.deleteRole(id);\nchannels.sendMessage(id, p);\nbuilder.setDMPermission(false);\n" +
            "commands.deleteGuild(guildId, commandId);\nguilds.deleteGuild(id);\n" +
            "client.fetchInvite(code, { withExpiration: true });\nrest.get(Routes.channelPins(id));\n";
        const { source, manual } = scanSource(input);
        expect(source).toBe(input);
        expect(manual.map((f) => [f.line, f.found])).toEqual([
            [1, "deleteRole("],
            [2, "sendMessage("],
            [3, "setDMPermission("],
            [5, "deleteGuild(id)"],
            [6, "withExpiration"],
            [7, "Routes.channelPins("],
        ]);
    });

    test("maskCode blanks text but keeps offsets and code inside ${}", () => {
        const input = "a(`t ${b('x')} u`, /\\//, 'c') // d";
        expect(maskCode(input)).toBe("a(`  ${b(' ')}  `, /  /, ' ')     ");
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

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "lunibee-migrate-"));
        output = [];
        await writeFile(join(dir, "package.json"), '{"name":"bot"}');
        await mkdir(join(dir, "src", "commands"), { recursive: true });
        await writeFile(
            join(dir, "src", "commands", "ping.ts"),
            'import { SlashCommandBuilder } from "lunibee";\nexport const data = new SlashCommandBuilder();\n',
        );
        await writeFile(
            join(dir, "src", "clean.ts"),
            'import { CreateEmbed } from "lunibee";\nnew CreateEmbed();\n',
        );
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    test("reports without writing, then --fix renames and exits 0", async () => {
        const file = join(dir, "src", "commands", "ping.ts");
        const before = await readFile(file, "utf8");
        expect(await run(`migrate --cwd ${dir}`)).toBe(1);
        expect(await readFile(file, "utf8")).toBe(before);
        expect(output.join("\n")).toContain(
            "SlashCommandBuilder → CreateSlashCommand",
        );
        expect(await run(`migrate --fix --dry-run --cwd ${dir}`)).toBe(1);
        expect(await readFile(file, "utf8")).toBe(before);
        expect(await run(`migrate --fix --cwd ${dir}`)).toBe(0);
        expect(await readFile(file, "utf8")).toContain(
            "new CreateSlashCommand()",
        );
        expect(await run(`migrate --cwd ${dir}`)).toBe(0);
    });

    test("--json reports files, renames and manual changes", async () => {
        await writeFile(join(dir, "src", "old.ts"), "roles.deleteRole(id);\n");
        expect(await run(`migrate --json --cwd ${dir}`)).toBe(1);
        const report = JSON.parse(output.at(-1)!);
        expect(report.files).toBe(3);
        expect(report.fixable).toHaveLength(1);
        expect(report.manual).toEqual([
            {
                file: join("src", "old.ts"),
                line: 1,
                found: "deleteRole(",
                use: "roles.remove(id, reason?)",
            },
        ]);
    });
});
