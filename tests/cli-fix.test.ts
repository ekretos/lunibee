import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../packages/cli/src/cli.ts";
import type { IO } from "../packages/cli/src/io.ts";
import { migrateHandler } from "../packages/cli/src/migrate.ts";

const fixed = (source: string, ts = true) => {
    const result = migrateHandler(source, ts);
    if (result.state !== "fixable")
        throw new Error(`expected fixable, got ${JSON.stringify(result)}`);
    return result.source;
};

describe("migrateHandler", () => {
    test("function declarations get the client first and the import", () => {
        expect(
            fixed(
                'import type { ClientEvents } from "lunibee";\nexport default async function a(...args: ClientEvents["ready"]) {}\n',
            ),
        ).toBe(
            'import type { Client, ClientEvents } from "lunibee";\nexport default async function a(_client: Client, ...args: ClientEvents["ready"]) {}\n',
        );
        expect(
            fixed("export default function* gen<T>(x: Map<string, T>) {}"),
        ).toBe(
            'import type { Client } from "lunibee";\n\nexport default function* gen<T>(_client: Client, x: Map<string, T>) {}',
        );
    });

    test("arrows, bare arrows and named exports", () => {
        expect(
            fixed(
                'import { Message } from "lunibee";\nexport default async (m: Message) => m;',
            ),
        ).toBe(
            'import { type Client, Message } from "lunibee";\nexport default async (_client: Client, m: Message) => m;',
        );
        expect(fixed("import x from 'y';\nexport default async m => m;")).toBe(
            "import x from 'y';\nimport type { Client } from \"lunibee\";\nexport default async (_client: Client, m) => m;",
        );
        expect(
            fixed("const h = async (e: unknown) => e;\nexport default h;"),
        ).toContain("async (_client: Client, e: unknown)");
        expect(fixed("function h(e) {}\nexport { h as default };")).toContain(
            "function h(_client: Client, e)",
        );
        expect(fixed("let h = e => e;\nexport default h")).toContain(
            "let h = (_client: Client, e) => e;",
        );
        expect(
            fixed("const h: Handler = (e) => e;\nexport default h;"),
        ).toContain("(_client: Client, e)");
    });

    test("JavaScript files get no type or import", () => {
        expect(fixed("export default function r(i) {}", false)).toBe(
            "export default function r(_client, i) {}",
        );
    });

    test("an existing Client import is reused; shebangs stay first", () => {
        expect(
            fixed(
                'import { type Client } from "lunibee";\nexport default (m) => m;',
            ),
        ).toBe(
            'import { type Client } from "lunibee";\nexport default (_client: Client, m) => m;',
        );
        expect(fixed("#!/usr/bin/env bun\nexport default (m) => m;")).toBe(
            '#!/usr/bin/env bun\nimport type { Client } from "lunibee";\n\nexport default (_client: Client, m) => m;',
        );
    });

    test("current handlers and parameterless handlers are left alone", () => {
        for (const source of [
            "export default function a(client: Client, m) {}",
            "export default function a(_client, m) {}",
            "export default function a(bot?, m) {}",
            "export default (c: ZedClient<true>, m) => m;",
            "export default function a(c: import('x').Client) {}",
            "export default function () {}",
        ])
            expect(migrateHandler(source)).toEqual({ state: "ok" });
        // ClientEvents / ClientUser are not the client.
        expect(
            migrateHandler(
                "export default function a(...args: ClientEvents['ready']) {}",
            ).state,
        ).toBe("fixable");
    });

    test("comments and strings do not confuse it", () => {
        const source =
            '// export default function fake(x) {}\n/* export default (y) => y */\nconst s = "it\'s \\" (";\nconst t = `(`;\nexport default function real(m) {}\n// trailing';
        expect(fixed(source)).toContain("function real(_client: Client, m)");
        expect(fixed(source)).toContain("function fake(x)");
    });

    test("shapes it cannot fix are reported", () => {
        expect(migrateHandler("export const x = 1;")).toEqual({
            state: "manual",
            reason: "no default-exported function found",
        });
        expect(migrateHandler("export default class A {}").state).toBe(
            "manual",
        );
        expect(migrateHandler("export default imported;")).toEqual({
            state: "manual",
            reason: "could not find the declaration of imported",
        });
        expect(migrateHandler("export default function a(m {").state).toBe(
            "manual",
        );
        expect(migrateHandler("/* export default (m) => m;").state).toBe(
            "manual",
        );
    });
});

describe("lunibee handler", () => {
    let dir: string;
    let out: string[];
    const io = (): IO => ({
        cwd: dir,
        out: (line) => out.push(line),
        err: (line) => out.push(line),
        prompt: () => null,
        interactive: false,
        color: false,
        run: async () => 0,
    });
    const cli = (argv: string) =>
        main(argv.split(" "), io(), { version: "1", lunibeeRoot: dir });
    const put = async (path: string, source: string) => {
        await mkdir(join(dir, "src/events", path, ".."), { recursive: true });
        await writeFile(join(dir, "src/events", path), source);
    };
    const text = () => out.join("\n");

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "lunibee-fix-"));
        out = [];
        await writeFile(join(dir, "package.json"), "{}");
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    test("reports, dry-runs, fixes and syncs", async () => {
        await put(
            "messageCreate/old.ts",
            "export default async function old(m) {}\n",
        );
        await put(
            "messageCreate/old.js",
            "export default function old(m) {}\n",
        );
        await put(
            "messageCreate/old.test.ts",
            "export default function t(m) {}\n",
        );
        await put(
            "ready/new.ts",
            "export default function n(client: Client) {}\n",
        );
        await put("guildcreate/g.js", "export default function g(guild) {}\n");
        await put("typo/x.ts", "export default function x(a) {}\n");
        await put("ready/none.ts", "export const a = 1;\n");

        expect(await cli("handler")).toBe(1);
        expect(text()).toContain(
            "needs rename events/guildcreate/ → events/guildCreate/",
        );
        expect(text()).toContain("needs update events/guildCreate/g.js");
        expect(text()).toContain("needs update events/messageCreate/old.ts");
        expect(text()).toContain("events/typo/: not a client event");
        expect(text()).toContain(
            "events/ready/none.ts: no default-exported function found",
        );
        expect(text()).toContain("lunibee handler --fix");

        out = [];
        expect(await cli("handlers --fix --dry-run")).toBe(1);
        expect(text()).toContain("would rename");
        expect(await readdir(join(dir, "src/events"))).toContain("guildcreate");

        out = [];
        expect(await cli("handler --fix")).toBe(1); // typo/ and none.ts still need a hand
        expect(text()).toContain(
            "updated events/messageCreate/old.ts (client first)",
        );
        expect(await readdir(join(dir, "src/events"))).toContain("guildCreate");
        expect(
            await readFile(join(dir, "src/events/guildCreate/g.js"), "utf8"),
        ).toContain("g(_client, guild)");
        expect(
            await readFile(
                join(dir, "src/events/messageCreate/old.ts"),
                "utf8",
            ),
        ).toContain("old(_client: Client, m)");
        expect(
            await readFile(
                join(dir, "src/events/messageCreate/old.js"),
                "utf8",
            ),
        ).toContain("old(m)");
        expect(
            await readFile(join(dir, "src/handlers/event.ts"), "utf8"),
        ).toContain("ClientEvent.GuildCreate");

        await rm(join(dir, "src/events/typo"), { recursive: true });
        await rm(join(dir, "src/events/ready/none.ts"));
        out = [];
        expect(await cli("handler --json")).toBe(0);
        expect(JSON.parse(text())).toEqual({
            migrated: [],
            renamed: [],
            manual: [],
            ok: 3,
        });
        out = [];
        expect(await cli("handler --fix --json")).toBe(0);
        expect(JSON.parse(text()).ok).toBe(3);
    });

    test("a case-typo folder next to the real one is left for a hand", async () => {
        await put("ready/a.ts", "export default function a() {}\n");
        await put("READY/b.ts", "export default function b() {}\n");
        expect(await cli("handler --fix")).toBe(1);
        expect(text()).toContain("merge it into events/ready/ by hand");
    });
});
