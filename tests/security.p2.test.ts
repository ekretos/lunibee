import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants, deflateSync } from "node:zlib";
import { HttpTransport, REST } from "../packages/rest/src/index.ts";
import {
    computePermissions,
    PermissionFlagsBits,
} from "../packages/core/src/index.ts";
import { CreateAttachment } from "../packages/builders/src/index.ts";
import { ZlibStreamDecoder } from "../packages/ws/src/decoder.ts";

// Security report for 0.2.3, findings M1, M2, M3 and M5 (fixed in 0.2.4).
// M4 (identify properties) is covered in gateway.protocol.test.ts.

describe("M1: a caller's header cannot change the bot credential", () => {
    const send = async (headers: Record<string, string>, auth?: false) => {
        let seen: Headers | undefined;
        const rest = new REST({
            token: "BOTTOKEN",
            retries: 0,
            transport: new HttpTransport({
                fetch: async (_url, init) => {
                    seen = new Headers(init?.headers);
                    return new Response("{}", {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    });
                },
            }),
        });
        await rest.get("/users/@me", { headers, auth });
        return seen!;
    };

    test("any spelling of Authorization is replaced, not joined", async () => {
        for (const name of ["authorization", "AUTHORIZATION", "Authorization"])
            expect(
                (await send({ [name]: "Bot ATTACKER" })).get("authorization"),
            ).toBe("Bot BOTTOKEN");
        expect(
            (await send({ "user-agent": "evil" })).get("user-agent"),
        ).not.toContain("evil");
    });

    test("with auth: false the caller's own Authorization is kept", async () => {
        expect(
            (await send({ authorization: "Bearer oauth" }, false)).get(
                "authorization",
            ),
        ).toBe("Bearer oauth");
    });
});

describe("M2: a timed-out member keeps only View Channel and Read Message History", () => {
    const guildId = "1";
    const roles = [
        {
            id: guildId,
            permissions:
                PermissionFlagsBits.ViewChannel |
                PermissionFlagsBits.ReadMessageHistory |
                PermissionFlagsBits.SendMessages |
                PermissionFlagsBits.ManageMessages,
        },
        { id: "9", permissions: PermissionFlagsBits.Administrator },
    ];
    const future = new Date(Date.now() + 60_000);
    const permissions = (extra: Record<string, unknown>) =>
        computePermissions({
            guildId,
            memberId: "2",
            memberRoleIds: [],
            roles,
            ...extra,
        });

    test("while the timeout lasts", () => {
        const set = permissions({ timedOutUntil: future });
        expect(set.has(PermissionFlagsBits.ViewChannel)).toBe(true);
        expect(set.has(PermissionFlagsBits.ReadMessageHistory)).toBe(true);
        expect(set.has(PermissionFlagsBits.SendMessages)).toBe(false);
        expect(set.has(PermissionFlagsBits.ManageMessages)).toBe(false);
    });

    test("after it ends, and for owners and administrators", () => {
        expect(
            permissions({ timedOutUntil: Date.now() - 1 }).has(
                PermissionFlagsBits.SendMessages,
            ),
        ).toBe(true);
        expect(
            permissions({ timedOutUntil: future, ownerId: "2" }).has(
                PermissionFlagsBits.SendMessages,
            ),
        ).toBe(true);
        expect(
            permissions({ timedOutUntil: future, memberRoleIds: ["9"] }).has(
                PermissionFlagsBits.SendMessages,
            ),
        ).toBe(true);
    });
});

describe("M3: CreateAttachment with a root cannot read outside it", () => {
    let dir: string;
    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), "lunibee-attach-"));
        await mkdir(join(dir, "public"));
        await writeFile(join(dir, "public", "ok.txt"), "ok");
        await writeFile(join(dir, "secret.txt"), "secret");
        await symlink(join(dir, "secret.txt"), join(dir, "public", "link.txt"));
    });
    afterAll(() => rm(dir, { recursive: true, force: true }));

    test("paths inside the root are read", async () => {
        const root = join(dir, "public");
        const bytes = await new CreateAttachment("ok.txt", { root }).toBuffer();
        expect(new TextDecoder().decode(bytes)).toBe("ok");
    });

    test("traversal, absolute paths and symlinks out of the root are refused", async () => {
        const root = join(dir, "public");
        for (const file of [
            "../secret.txt",
            join(dir, "secret.txt"),
            "link.txt",
            "/etc/hostname",
        ])
            await expect(
                new CreateAttachment(file, { root }).toBuffer(),
            ).rejects.toThrow();
    });
});

describe("M5: inflated gateway frames are capped", () => {
    const frame = (text: string) =>
        deflateSync(Buffer.from(text), { finishFlush: constants.Z_SYNC_FLUSH });

    test("a frame within the cap decodes", async () => {
        const decoder = new ZlibStreamDecoder(undefined, 1024);
        expect(await decoder.push(frame('{"op":11}'))).toEqual(['{"op":11}']);
    });

    test("a frame that inflates past the cap fails instead of growing", async () => {
        const decoder = new ZlibStreamDecoder(undefined, 1024);
        const bomb = frame(`{"d":"${"a".repeat(1_000_000)}"}`);
        expect(bomb.length).toBeLessThan(4096);
        await expect(Promise.resolve(decoder.push(bomb))).rejects.toThrow(
            "Gateway frame inflated past 1024 bytes",
        );
    });
});
