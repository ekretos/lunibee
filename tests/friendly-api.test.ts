import { describe, expect, test } from "bun:test";
import {
    argsFromCommandOptions,
    parseChannelMention,
    parseMentionable,
    parsePrefixArgs,
    parseRoleMention,
    parseUserMention,
    tokenizeArgs,
} from "../packages/utils/src/index.js";
import {
    GuildMember,
    Message,
    type ResourceContext,
} from "../packages/structures/src/index.js";
import { PermissionSet } from "../packages/core/src/index.js";
import {
    ChannelManager,
    GuildMemberManager,
    PermissionOverwriteManager,
    toRequest,
} from "../packages/managers/src/index.js";
import {
    CreateContainer,
    CreateEmbed,
    CreateModal,
    CreateTextDisplay,
    CreateTextInput,
    TextInputType,
    componentsV2Message,
} from "../packages/builders/src/index.js";

const GUILD = "123456789012345670";
const CHANNEL = "123456789012345671";
const USER = "123456789012345672";
const ROLE = "123456789012345673";

function context(overrides: Partial<ResourceContext> = {}): ResourceContext {
    return {
        sendMessage: async () => {
            throw new Error("unused");
        },
        editMessage: async () => {
            throw new Error("unused");
        },
        deleteMessage: async () => {},
        crosspostMessage: async () => {
            throw new Error("unused");
        },
        ...overrides,
    };
}

const guildMessage = (member?: Record<string, unknown>) =>
    new Message(
        {
            id: "123456789012345674",
            channel_id: CHANNEL,
            guild_id: GUILD,
            author: { id: USER, username: "author" },
            content: "hi",
            ...(member ? { member } : {}),
        } as never,
        context({
            memberPermissions: (_guild, _member, roles, channelId) =>
                channelId === "missing"
                    ? null
                    : new PermissionSet(roles.includes(ROLE) ? 8n : 1024n),
        }),
    );

describe("prefix arguments", () => {
    test("tokenizes quotes and escapes", () => {
        expect(tokenizeArgs(`a "b c" 'd e' f\\ g it"s ""`)).toEqual([
            "a",
            "b c",
            "d e",
            "f g",
            'it"s',
            "",
        ]);
        expect(tokenizeArgs("   ")).toEqual([]);
    });

    test("reads mentions and IDs", () => {
        expect(parseUserMention(`<@!${USER}>`)).toBe(USER);
        expect(parseUserMention("nope")).toBeNull();
        expect(parseRoleMention(`<@&${ROLE}>`)).toBe(ROLE);
        expect(parseRoleMention(`<@${ROLE}>`)).toBeNull();
        expect(parseChannelMention(`<#${CHANNEL}>`)).toBe(CHANNEL);
        expect(parseChannelMention(CHANNEL)).toBe(CHANNEL);
        expect(parseMentionable(`<@&${ROLE}>`)).toEqual({
            id: ROLE,
            type: "role",
        });
        expect(parseMentionable(USER)).toEqual({ id: USER, type: "user" });
        expect(parseMentionable("x")).toBeNull();
    });

    test("parses typed values in order, with a rest argument", () => {
        const result = parsePrefixArgs(
            `<@${USER}> 10 yes 2.5 <@&${ROLE}> <#${CHANNEL}> ${ROLE} spam links`,
            [
                { name: "user", type: "user", required: true },
                { name: "minutes", type: "integer", min: 1, max: 60 },
                { name: "notify", type: "boolean" },
                { name: "ratio", type: "number" },
                { name: "who", type: "mentionable" },
                { name: "where", type: "channel" },
                { name: "role", type: "role" },
                { name: "reason", type: "rest", maxLength: 100 },
            ],
        );
        expect(result).toEqual({
            ok: true,
            values: {
                user: USER,
                minutes: 10,
                notify: true,
                ratio: 2.5,
                who: { id: ROLE, type: "role" },
                where: CHANNEL,
                role: ROLE,
                reason: "spam links",
            },
        });
    });

    test("reports the first problem by name", () => {
        const specs = [{ name: "n", type: "integer" as const, required: true }];
        expect(parsePrefixArgs("", specs)).toEqual({
            ok: false,
            arg: "n",
            error: "is required",
        });
        expect(parsePrefixArgs("x", specs)).toMatchObject({
            ok: false,
            error: "must be a number",
        });
        expect(parsePrefixArgs("1.5", specs)).toMatchObject({
            error: "must be a whole number",
        });
        expect(
            parsePrefixArgs("0", [{ name: "n", type: "integer", min: 1 }]),
        ).toMatchObject({ error: "must be at least 1" });
        expect(
            parsePrefixArgs("9", [{ name: "n", type: "number", max: 5 }]),
        ).toMatchObject({ error: "must be at most 5" });
        expect(
            parsePrefixArgs("3", [
                { name: "n", type: "integer", choices: [1, 2] },
            ]),
        ).toMatchObject({ error: "must be one of: 1, 2" });
        expect(
            parsePrefixArgs("maybe", [{ name: "b", type: "boolean" }]),
        ).toMatchObject({ error: "must be yes or no" });
        expect(
            parsePrefixArgs("off", [{ name: "b", type: "boolean" }]),
        ).toEqual({ ok: true, values: { b: false } });
        expect(
            parsePrefixArgs("x", [{ name: "u", type: "user" }]),
        ).toMatchObject({ error: "must be a user mention or ID" });
        expect(
            parsePrefixArgs("x", [{ name: "r", type: "role" }]),
        ).toMatchObject({ error: "must be a role mention or ID" });
        expect(
            parsePrefixArgs("x", [{ name: "c", type: "channel" }]),
        ).toMatchObject({ error: "must be a channel mention or ID" });
        expect(
            parsePrefixArgs("x", [{ name: "m", type: "mentionable" }]),
        ).toMatchObject({ error: "must be a user or role mention" });
        expect(
            parsePrefixArgs("abcdef", [
                { name: "s", type: "string", maxLength: 3 },
            ]),
        ).toMatchObject({ error: "must be at most 3 characters" });
        expect(
            parsePrefixArgs("RED", [
                { name: "s", type: "string", choices: ["red"] },
            ]),
        ).toEqual({ ok: true, values: { s: "RED" } });
        expect(
            parsePrefixArgs("blue", [
                { name: "s", type: "string", choices: ["red"] },
            ]),
        ).toMatchObject({ error: "must be one of: red" });
        expect(
            parsePrefixArgs(
                ["a"],
                [
                    { name: "s", type: "string" },
                    { name: "t", type: "string" },
                ],
            ),
        ).toEqual({ ok: true, values: { s: "a", t: undefined } });
        expect(() =>
            parsePrefixArgs("a b", [
                { name: "r", type: "rest" },
                { name: "s", type: "string" },
            ]),
        ).toThrow(TypeError);
    });

    test("builds specs from slash command options", () => {
        expect(
            argsFromCommandOptions(
                [
                    { name: "user", type: 6, required: true },
                    { name: "sub", type: 1 },
                    { name: "count", type: 4, min_value: 1, max_value: 9 },
                    { name: "color", type: 3, choices: [{ value: "red" }] },
                    { name: "reason", type: 3, max_length: 50 },
                ],
                true,
            ),
        ).toEqual([
            {
                name: "user",
                type: "user",
                required: true,
                min: undefined,
                max: undefined,
                maxLength: undefined,
                choices: undefined,
            },
            {
                name: "count",
                type: "integer",
                required: undefined,
                min: 1,
                max: 9,
                maxLength: undefined,
                choices: undefined,
            },
            {
                name: "color",
                type: "string",
                required: undefined,
                min: undefined,
                max: undefined,
                maxLength: undefined,
                choices: ["red"],
            },
            {
                name: "reason",
                type: "rest",
                required: undefined,
                min: undefined,
                max: undefined,
                maxLength: 50,
                choices: undefined,
            },
        ]);
        expect(
            argsFromCommandOptions([{ name: "n", type: 10 }], true)[0]!.type,
        ).toBe("number");
    });
});

describe("members", () => {
    test("message members compute permissions from roles", () => {
        const message = guildMessage({
            roles: [ROLE],
            joined_at: new Date().toISOString(),
        });
        expect(message.member?.user.id).toBe(USER);
        expect(message.member?.permissions.has("Administrator")).toBe(true);
        expect(message.member?.permissionsIn(CHANNEL)?.bitfield).toBe(8n);
        expect(message.member?.permissionsIn("missing")).toBeNull();
        expect(guildMessage().member).toBeNull();
    });

    test("supplied permissions win; unattached members have none", () => {
        const supplied = new GuildMember({
            user: { id: USER, username: "u" },
            guild_id: GUILD,
            permissions: "32",
        });
        expect(supplied.permissions.bitfield).toBe(32n);
        const bare = new GuildMember({
            user: { id: USER, username: "u" },
            guild_id: GUILD,
        });
        expect(bare.permissions.bitfield).toBe(0n);
        expect(bare.permissionsIn(CHANNEL)).toBeNull();
        expect(() => bare.kick()).toThrow("not attached");
    });

    test("member actions go through the client", async () => {
        const calls: unknown[][] = [];
        const record =
            (name: string) =>
            async (...args: unknown[]) => {
                calls.push([name, ...args]);
                return undefined as never;
            };
        const member = new GuildMember(
            { user: { id: USER, username: "u" }, guild_id: GUILD },
            context({
                kickMember: record("kick"),
                banMember: record("ban"),
                editMember: record("edit"),
                addMemberRole: record("add"),
                removeMemberRole: record("remove"),
            }),
        );
        await member.kick("r");
        await member.ban({ reason: "b", deleteMessageSeconds: 60 });
        await member.setNickname("nick", "n");
        await member.timeout(null);
        await member.addRole(ROLE, "a");
        await member.removeRole(ROLE);
        expect(() => member.timeout(0)).toThrow(RangeError);
        const before = Date.now();
        await member.timeout(60_000, "t");
        expect(calls.slice(0, 6)).toEqual([
            ["kick", GUILD, USER, "r"],
            ["ban", GUILD, USER, { reason: "b", deleteMessageSeconds: 60 }],
            ["edit", GUILD, USER, { nick: "nick" }, "n"],
            [
                "edit",
                GUILD,
                USER,
                { communication_disabled_until: null },
                undefined,
            ],
            ["add", GUILD, USER, ROLE, "a"],
            ["remove", GUILD, USER, ROLE, undefined],
        ]);
        const until = Date.parse(
            (calls[6]![3] as { communication_disabled_until: string })
                .communication_disabled_until,
        );
        expect(until).toBeGreaterThanOrEqual(before + 60_000);
    });

    test("the member manager sends audit-log reasons", async () => {
        const requests: unknown[][] = [];
        const rest = {
            delete: async (...args: unknown[]) =>
                void requests.push(["delete", ...args]),
            put: async (...args: unknown[]) =>
                void requests.push(["put", ...args]),
            patch: async (...args: unknown[]) => {
                requests.push(["patch", ...args]);
                return {
                    user: { id: USER, username: "u" },
                    roles: [],
                    joined_at: new Date().toISOString(),
                };
            },
        };
        const attached = context({ kickMember: async () => {} });
        const members = new GuildMemberManager(
            GUILD,
            rest as never,
            () => attached,
        );
        await members.kick(USER, "k");
        await members.addRole(USER, ROLE, "a");
        await members.removeRole(USER, ROLE, "r");
        const edited = await members.timeout(USER, 1_000, "t");
        expect(requests[0]).toEqual([
            "delete",
            `/guilds/${GUILD}/members/${USER}`,
            { reason: "k" },
        ]);
        expect(requests[1]).toEqual([
            "put",
            `/guilds/${GUILD}/members/${USER}/roles/${ROLE}`,
            undefined,
            { reason: "a" },
        ]);
        expect(requests[2]).toEqual([
            "delete",
            `/guilds/${GUILD}/members/${USER}/roles/${ROLE}`,
            { reason: "r" },
        ]);
        expect(requests[3]![3]).toEqual({ reason: "t" });
        // Fetched and edited members can act on their own.
        await expect(edited.kick()).resolves.toBeUndefined();
    });
});

describe("permission overwrites", () => {
    test("update changes only the named bits", async () => {
        let sent: unknown;
        const rest = {
            put: async (_path: string, body: unknown) => void (sent = body),
        };
        const overwrites = new PermissionOverwriteManager(
            rest as never,
            CHANNEL,
            () => [{ id: USER, type: 1, allow: "3", deny: "4" }],
        );
        await overwrites.update(USER, { allow: 4n, deny: 1n, inherit: 2n });
        expect(sent).toEqual({ type: 1, allow: "4", deny: "1" });
    });

    test("update fetches unknown overwrites and needs a type for new ones", async () => {
        let sent: unknown;
        const rest = {
            get: async () => ({
                id: CHANNEL,
                type: 0,
                permission_overwrites: [],
            }),
            put: async (_path: string, body: unknown) => void (sent = body),
        };
        const overwrites = new PermissionOverwriteManager(
            rest as never,
            CHANNEL,
        );
        await expect(overwrites.update(ROLE, { allow: 1024n })).rejects.toThrow(
            TypeError,
        );
        await overwrites.update(
            ROLE,
            { allow: 1024n },
            { type: 0, reason: "r" },
        );
        expect(sent).toEqual({ type: 0, allow: "1024", deny: "0" });
        const noneRest = {
            get: async () => ({ id: CHANNEL, type: 0 }),
            put: rest.put,
        };
        await new PermissionOverwriteManager(noneRest as never, CHANNEL).update(
            ROLE,
            {},
            { type: 0 },
        );
        expect(sent).toEqual({ type: 0, allow: "0", deny: "0" });
    });

    test("channels read their cached overwrites", async () => {
        let sent: unknown;
        const rest = {
            put: async (_path: string, body: unknown) => void (sent = body),
        };
        const channels = new ChannelManager(rest as never);
        channels.upsert({
            id: CHANNEL,
            type: 0,
            guild_id: GUILD,
            permission_overwrites: [
                { id: USER, type: 1, allow: "1", deny: "0" },
            ],
        });
        await channels
            .permissionOverwrites(CHANNEL)
            .update(USER, { deny: 2048n });
        expect(sent).toEqual({ type: 1, allow: "1", deny: "2048" });
    });
});

describe("messages", () => {
    test("files become an upload", () => {
        expect(toRequest({ content: "x" })).toEqual({ content: "x" });
        expect(toRequest({ content: "x", files: [] })).toEqual({
            content: "x",
        });
        const upload = toRequest({
            content: "x",
            files: [
                { name: "a.txt", data: "hi", contentType: "text/plain" },
                { name: "b.bin", data: new Uint8Array([1]) },
            ],
        }) as {
            body: unknown;
            files: { name: string; data: Uint8Array; contentType?: string }[];
        };
        expect(upload.body).toEqual({ content: "x" });
        expect(Array.from(upload.files[0]!.data)).toEqual([104, 105]);
        expect(upload.files[0]!.contentType).toBe("text/plain");
        expect(Array.from(upload.files[1]!.data)).toEqual([1]);
    });

    test("channel send uploads files", async () => {
        let body: unknown;
        const rest = {
            post: async (_path: string, requestBody: unknown) => {
                body = requestBody;
                return {
                    id: "123456789012345675",
                    channel_id: CHANNEL,
                    author: { id: USER, username: "u" },
                    content: "x",
                };
            },
        };
        await new ChannelManager(rest as never).send(CHANNEL, {
            content: "x",
            files: [{ name: "a.txt", data: "hi" }],
        });
        expect((body as { body: unknown }).body).toEqual({ content: "x" });
    });

    test("component collectors need a client", () => {
        expect(() => guildMessage().createComponentCollector()).toThrow(
            "not attached",
        );
    });

    test("component collectors keep this message's components only, and always end", async () => {
        let captured: {
            time?: number;
            filter?: (i: unknown) => Promise<boolean> | boolean;
        } = {};
        const message = new Message(
            {
                id: "123456789012345676",
                channel_id: CHANNEL,
                author: { id: USER, username: "u" },
                content: "",
            } as never,
            context({
                collectInteractions: (options) => {
                    captured = options as typeof captured;
                    return { next: async () => "picked" } as never;
                },
            }),
        );
        const interaction = (messageId: string, componentType = 2) => ({
            isMessageComponent: () => true,
            messageId,
            componentType,
        });
        message.createComponentCollector({
            componentType: 2,
            filter: () => true,
        });
        expect(captured.time).toBe(15 * 60_000);
        expect(await captured.filter!(interaction("123456789012345676"))).toBe(
            true,
        );
        expect(await captured.filter!(interaction("123456789012345677"))).toBe(
            false,
        );
        expect(
            await captured.filter!(interaction("123456789012345676", 3)),
        ).toBe(false);
        message.createComponentCollector({ idle: 5_000 });
        expect(captured.time).toBeUndefined();
        expect(await captured.filter!(interaction("123456789012345676"))).toBe(
            true,
        );
        expect(await message.awaitComponent({ time: 1_000 })).toBe(
            "picked" as never,
        );
    });
});

describe("builders", () => {
    test("modals take text inputs directly", () => {
        const modal = new CreateModal()
            .setCustomId("m")
            .setTitle("Title")
            .addTextInputs(
                new CreateTextInput()
                    .setCustomId("a")
                    .setLabel("A")
                    .setStyle(TextInputType.Short),
                new CreateTextInput()
                    .setCustomId("b")
                    .setLabel("B")
                    .setStyle(TextInputType.Paragraph),
            )
            .toJSON();
        expect(modal.custom_id).toBe("m");
        expect(modal.components).toHaveLength(2);
        expect(modal.components[1]!.components[0]!.type).toBe(4);
    });

    test("componentsV2Message sets the flag and keeps other fields", () => {
        const container = new CreateContainer().addComponents(
            new CreateTextDisplay().setContent("hi"),
        );
        expect(
            componentsV2Message(container, {
                flags: 64,
                allowed_mentions: { parse: [] },
            }),
        ).toEqual({
            allowed_mentions: { parse: [] },
            components: [
                { type: 17, components: [{ type: 10, content: "hi" }] },
            ],
            flags: 32768 | 64,
        });
        expect(componentsV2Message([container]).flags).toBe(32768);
        expect(() => componentsV2Message([])).toThrow(TypeError);
    });

    test("embed setters clear with null", () => {
        const embed = new CreateEmbed()
            .setTitle("t")
            .setDescription("d")
            .setURL("https://example.com")
            .setThumbnail("https://example.com/a.png")
            .setImage({ url: "https://example.com/b.png" })
            .setTitle(null)
            .setDescription(null)
            .setURL(null)
            .setThumbnail(null)
            .setImage(null);
        expect(embed.toJSON()).toEqual({});
    });

    test("renamed permissions still resolve", () => {
        expect(new PermissionSet("ManageEmojisAndStickers").bitfield).toBe(
            1n << 30n,
        );
        expect(new PermissionSet("UseSlashCommands").bitfield).toBe(1n << 31n);
    });
});
