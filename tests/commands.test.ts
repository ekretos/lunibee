import { afterEach, describe, expect, test } from "bun:test";
import { Client, command, option } from "../packages/core/src/index.ts";

const GUILD = "200000000000000000";
const CHANNEL = "100000000000000000";
const USER = "300000000000000000";
const TARGET = "400000000000000000";
const APP = "500000000000000000";

const warnings: { code?: string; message: string }[] = [];
const originalWarning = process.emitWarning;
afterEach(() => {
    process.emitWarning = originalWarning;
    warnings.length = 0;
});
function captureWarnings(): void {
    process.emitWarning = ((message: string, options?: { code?: string }) => {
        warnings.push({ message, code: options?.code });
    }) as typeof process.emitWarning;
}

type Call = { method: string; path: string; body?: unknown };

/** A client that records and answers REST calls, and can be fed gateway events. */
function setup(intents: number | string[] = 0) {
    const bot = new Client({ token: "a.b", intents: intents as number });
    const calls: Call[] = [];
    for (const method of ["get", "post", "put", "patch", "delete"] as const)
        (bot.rest as unknown as Record<string, unknown>)[method] = async (
            path: string,
            body?: unknown,
        ) => {
            calls.push({ method: method.toUpperCase(), path, body });
            return method === "post" && path.endsWith("/messages")
                ? {
                      id: "600000000000000000",
                      channel_id: CHANNEL,
                      content: "",
                      author: { id: APP, username: "bot" },
                  }
                : [];
        };
    const emit = (event: string, data: unknown) =>
        (bot.gateway as unknown as { emit(e: string, d: unknown): void }).emit(
            event,
            data,
        );
    return { bot, calls, emit };
}

const botUser = { id: APP, username: "bot" };
const readyEvent = { user: botUser, application: { id: APP } };

const slashInteraction = (
    name: string,
    options: unknown[] = [],
    resolved: unknown = {},
) => ({
    id: "700000000000000000",
    application_id: APP,
    type: 2,
    token: "tok",
    version: 1,
    guild_id: GUILD,
    channel_id: CHANNEL,
    member: {
        user: { id: USER, username: "ann" },
        roles: [],
        joined_at: "2024-01-01T00:00:00.000Z",
    },
    data: { id: "800000000000000000", name, type: 1, options, resolved },
});

const message = (content: string, extra: Record<string, unknown> = {}) => ({
    id: "900000000000000000",
    channel_id: CHANNEL,
    guild_id: GUILD,
    content,
    author: { id: USER, username: "ann" },
    member: { roles: [], joined_at: "2024-01-01T00:00:00.000Z" },
    attachments: [],
    ...extra,
});

describe("command() definitions", () => {
    test("builds the slash payload from typed options", () => {
        const timeout = command({
            name: "timeout",
            description: "Time a member out",
            permissions: ["ModerateMembers"],
            nsfw: true,
            options: {
                user: option.user({ required: true, description: "Who" }),
                minutes: option.integer({ min: 1, max: 60, default: 10 }),
                ratio: option.number({ min: 0.5 }),
                reason: option.string({ max: 500, min: 2 }),
                flag: option.boolean(),
                role: option.role(),
                who: option.mentionable(),
                where: option.channel({ kinds: ["text", "thread"] }),
                file: option.attachment(),
                mode: option.choice(["soft", "hard"] as const),
                size: option.string({
                    choices: ["s", { name: "Large", value: "l" }],
                }),
                level: option.integer({
                    choices: [1, { name: "Two", value: 2 }],
                }),
            },
            run() {},
        });
        const json = timeout.toJSON() as {
            name: string;
            description: string;
            default_member_permissions: string;
            contexts: number[];
            nsfw: boolean;
            options: Record<string, unknown>[];
        };
        expect(json).toMatchObject({
            name: "timeout",
            description: "Time a member out",
            default_member_permissions: String(1n << 40n),
            contexts: [0],
            nsfw: true,
        });
        const byName = Object.fromEntries(json.options.map((o) => [o.name, o]));
        expect(Object.keys(byName)).toEqual([
            "user",
            "minutes",
            "ratio",
            "reason",
            "flag",
            "role",
            "who",
            "where",
            "file",
            "mode",
            "size",
            "level",
        ]);
        expect(byName.user).toMatchObject({
            type: 6,
            required: true,
            description: "Who",
        });
        expect(byName.minutes).toMatchObject({
            type: 4,
            min_value: 1,
            max_value: 60,
            description: "minutes",
        });
        expect(byName.ratio).toMatchObject({ type: 10, min_value: 0.5 });
        expect(byName.reason).toMatchObject({
            type: 3,
            min_length: 2,
            max_length: 500,
        });
        expect(byName.flag).toMatchObject({ type: 5 });
        expect(byName.role).toMatchObject({ type: 8 });
        expect(byName.who).toMatchObject({ type: 9 });
        expect(byName.where).toMatchObject({
            type: 7,
            channel_types: [0, 10, 11, 12],
        });
        expect(byName.file).toMatchObject({ type: 11 });
        expect(byName.mode).toMatchObject({
            type: 3,
            choices: [
                { name: "soft", value: "soft" },
                { name: "hard", value: "hard" },
            ],
        });
        expect(byName.size).toMatchObject({
            choices: [
                { name: "s", value: "s" },
                { name: "Large", value: "l" },
            ],
        });
        expect(byName.level).toMatchObject({
            type: 4,
            choices: [
                { name: "1", value: 1 },
                { name: "Two", value: 2 },
            ],
        });
    });

    test("the handler's options are typed", () => {
        command({
            name: "typed",
            description: "d",
            options: {
                user: option.user({ required: true }),
                mode: option.choice(["a", "b"] as const, { required: true }),
                minutes: option.integer({ default: 10 }),
                reason: option.string(),
            },
            run({ options }) {
                const user: string = options.user;
                const minutes: number = options.minutes;
                const reason: string | undefined = options.reason;
                const mode: "a" | "b" = options.mode;
                // @ts-expect-error a missing option is possibly undefined
                const notSure: string = options.reason;
                // @ts-expect-error an option that does not exist
                options.nothing;
                void [user, minutes, reason, mode, notSure];
            },
        });
    });

    test("refuses what Discord or the handler would trip on", () => {
        const base = { description: "d", run() {} };
        expect(() => command({ ...base, name: "Bad Name" })).toThrow(
            RangeError,
        );
        expect(() => command({ ...base, name: "ok", description: "" })).toThrow(
            RangeError,
        );
        expect(() =>
            command({ ...base, name: "ok", description: "x".repeat(101) }),
        ).toThrow(RangeError);
        expect(() => command({ ...base, name: "ok", slash: false })).toThrow(
            TypeError,
        );
        expect(() =>
            command({
                ...base,
                name: "ok",
                prefix: { aliases: ["Bad Alias"] },
            }),
        ).toThrow(RangeError);
        expect(() =>
            command({
                ...base,
                name: "ok",
                options: {
                    first: option.string(),
                    second: option.string({ required: true }),
                },
            }),
        ).toThrow(/required but follows/);
        expect(() =>
            command({
                ...base,
                name: "ok",
                options: { "Bad Option": option.string() },
            }),
        ).toThrow(RangeError);
    });

    test("usage lines show required, optional and attachment options", () => {
        const c = command({
            name: "ban",
            description: "d",
            prefix: { aliases: ["b"] },
            options: {
                user: option.user({ required: true }),
                days: option.integer({ default: 1 }),
                proof: option.attachment(),
            },
            run() {},
        });
        expect(c.usage("!")).toBe("!ban <user> [days] [proof📎]");
        expect(c.prefix).toEqual({ aliases: ["b"] });
        expect(c.guildOnly).toBe(false);
        expect(
            command({
                name: "p",
                description: "d",
                slash: false,
                prefix: true,
                run() {},
            }).toJSON(),
        ).toMatchObject({ name: "p" });
    });
});

describe("bot.commands registry", () => {
    const make = (name: string, prefix?: boolean | { aliases: string[] }) =>
        command({ name, description: "d", prefix, run() {} });

    test("add, get, list, replace and name clashes", () => {
        const { bot } = setup();
        const ping = make("ping", { aliases: ["p"] });
        bot.commands.add(ping, make("pong"));
        expect(bot.commands.get("ping")).toBe(ping);
        expect(bot.commands.get("P")).toBe(ping);
        expect(bot.commands.list().map((c) => c.name)).toEqual([
            "ping",
            "pong",
        ]);
        expect(() =>
            bot.commands.add(make("other", { aliases: ["p"] })),
        ).toThrow(/already used by the ping/);
        const replacement = make("ping");
        bot.commands.add(replacement);
        expect(bot.commands.get("ping")).toBe(replacement);
        expect(bot.commands.get("p")).toBeUndefined();
        expect(bot.commands.get("missing")).toBeUndefined();
    });

    test("deploy needs a ready client and sends only slash commands", async () => {
        const { bot, calls, emit } = setup();
        bot.commands.add(
            make("ping"),
            command({
                name: "textonly",
                description: "d",
                slash: false,
                prefix: true,
                run() {},
            }),
        );
        await expect(bot.commands.deploy()).rejects.toThrow(
            /after the client is ready/,
        );
        emit("READY", {
            user: { id: APP, username: "bot" },
            application: { id: APP },
        });
        expect(await bot.commands.deploy()).toBe(1);
        expect(await bot.commands.deploy({ guildId: GUILD })).toBe(1);
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            `PUT /applications/${APP}/commands`,
            `PUT /applications/${APP}/guilds/${GUILD}/commands`,
        ]);
        expect(
            (calls[0]!.body as { name: string }[]).map((c) => c.name),
        ).toEqual(["ping"]);
    });

    test("listen() can only be called once and rejects an empty prefix", () => {
        const { bot } = setup();
        expect(() => bot.commands.listen({ prefix: "" })).toThrow(TypeError);
        const second = setup();
        second.bot.commands.listen();
        expect(() => second.bot.commands.listen()).toThrow(/already called/);
    });
});

describe("running slash commands", () => {
    test("reads options and answers with an interaction reply", async () => {
        const { bot, calls, emit } = setup();
        emit("READY", readyEvent);
        const seen: unknown[] = [];
        bot.commands
            .add(
                command({
                    name: "timeout",
                    description: "d",
                    options: {
                        user: option.user({ required: true }),
                        minutes: option.integer({ default: 10 }),
                        reason: option.string(),
                        loud: option.boolean(),
                        where: option.channel(),
                        role: option.role(),
                        who: option.mentionable(),
                        ratio: option.number(),
                    },
                    async run({
                        options,
                        reply,
                        source,
                        userId,
                        guildId,
                        interaction,
                    }) {
                        seen.push({
                            ...options,
                            source,
                            userId,
                            guildId,
                            hasInteraction: !!interaction,
                        });
                        await reply("done");
                        await reply({ content: "more", ephemeral: true });
                    },
                }),
            )
            .listen();
        emit(
            "INTERACTION_CREATE",
            slashInteraction(
                "timeout",
                [
                    { name: "user", type: 6, value: TARGET },
                    { name: "reason", type: 3, value: "spam" },
                    { name: "loud", type: 5, value: true },
                    { name: "where", type: 7, value: CHANNEL },
                    { name: "role", type: 8, value: GUILD },
                    { name: "who", type: 9, value: TARGET },
                    { name: "ratio", type: 10, value: 1.5 },
                ],
                {
                    users: { [TARGET]: { id: TARGET, username: "bob" } },
                    channels: { [CHANNEL]: { id: CHANNEL, type: 0 } },
                    roles: { [GUILD]: { id: GUILD, name: "r" } },
                },
            ),
        );
        await Bun.sleep(10);
        expect(seen).toEqual([
            {
                user: TARGET,
                minutes: 10,
                reason: "spam",
                loud: true,
                where: CHANNEL,
                role: GUILD,
                who: { id: TARGET, type: "user" },
                ratio: 1.5,
                source: "slash",
                userId: USER,
                guildId: GUILD,
                hasInteraction: true,
            },
        ]);
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            "POST /interactions/700000000000000000/tok/callback",
            `POST /webhooks/${APP}/tok`,
        ]);
    });

    test("defer() then reply() edits the original response", async () => {
        const { bot, calls, emit } = setup();
        emit("READY", readyEvent);
        bot.commands
            .add(
                command({
                    name: "slow",
                    description: "d",
                    async run({ defer, reply }) {
                        await defer({ ephemeral: true });
                        await reply("finished");
                    },
                }),
            )
            .listen();
        emit("INTERACTION_CREATE", slashInteraction("slow"));
        await Bun.sleep(10);
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            "POST /interactions/700000000000000000/tok/callback",
            `PATCH /webhooks/${APP}/tok/messages/@original`,
        ]);
        expect((calls[0]!.body as { type: number }).type).toBe(5);
    });

    test("other interactions and prefix-only commands are ignored", async () => {
        const { bot, calls, emit } = setup();
        let ran = 0;
        bot.commands
            .add(
                command({
                    name: "textonly",
                    description: "d",
                    slash: false,
                    prefix: true,
                    run: () => void ran++,
                }),
            )
            .listen();
        emit("INTERACTION_CREATE", slashInteraction("textonly"));
        emit("INTERACTION_CREATE", slashInteraction("unknown"));
        emit("INTERACTION_CREATE", {
            ...slashInteraction("textonly"),
            type: 3,
            data: { custom_id: "x", component_type: 2 },
        });
        await Bun.sleep(10);
        expect(ran).toBe(0);
        expect(calls).toHaveLength(0);
    });

    test("an error in a handler reaches the client's error listeners", async () => {
        const { bot, emit } = setup();
        const errors: Error[] = [];
        bot.on("error", (error) => void errors.push(error));
        bot.commands
            .add(
                command({
                    name: "boom",
                    description: "d",
                    run() {
                        throw new Error("exploded");
                    },
                }),
            )
            .listen();
        emit("INTERACTION_CREATE", slashInteraction("boom"));
        await Bun.sleep(10);
        expect(errors.map((e) => e.message)).toEqual(["exploded"]);
    });
});

describe("running prefix commands", () => {
    const intents = (1 << 9) | (1 << 15);

    test("parses the same options from a message and replies to it", async () => {
        const { bot, calls, emit } = setup(intents);
        const seen: unknown[] = [];
        bot.commands
            .add(
                command({
                    name: "timeout",
                    description: "d",
                    prefix: { aliases: ["mute"] },
                    options: {
                        user: option.user({ required: true }),
                        minutes: option.integer({
                            min: 1,
                            max: 60,
                            default: 10,
                        }),
                        reason: option.string({ max: 100 }),
                    },
                    async run({ options, reply, source, userId, message }) {
                        seen.push({
                            ...options,
                            source,
                            userId,
                            hasMessage: !!message,
                        });
                        await reply({ content: "ok", ephemeral: true });
                    },
                }),
            )
            .listen({ prefix: "!" });
        emit("MESSAGE_CREATE", message(`!mute <@${TARGET}> 5 being loud now`));
        emit("MESSAGE_CREATE", message(`!timeout ${TARGET}`));
        await Bun.sleep(10);
        expect(seen).toEqual([
            {
                user: TARGET,
                minutes: 5,
                reason: "being loud now",
                source: "prefix",
                userId: USER,
                hasMessage: true,
            },
            {
                user: TARGET,
                minutes: 10,
                reason: undefined,
                source: "prefix",
                userId: USER,
                hasMessage: true,
            },
        ]);
        expect(
            calls.every((c) => c.path === `/channels/${CHANNEL}/messages`),
        ).toBe(true);
        expect(calls[0]!.body).toMatchObject({
            content: "ok",
            message_reference: { message_id: "900000000000000000" },
        });
        expect(
            (calls[0]!.body as Record<string, unknown>).ephemeral,
        ).toBeUndefined();
    });

    test("a bad argument gets the usage line; bots and other text are ignored", async () => {
        const { bot, calls, emit } = setup(intents);
        let ran = 0;
        bot.commands
            .add(
                command({
                    name: "give",
                    description: "d",
                    prefix: true,
                    options: {
                        user: option.user({ required: true }),
                        amount: option.integer({
                            min: 1,
                            max: 5,
                            required: true,
                        }),
                    },
                    run: () => void ran++,
                }),
            )
            .listen({ prefix: ["!", "?"] });
        emit("MESSAGE_CREATE", message(`!give ${TARGET} 9`));
        emit("MESSAGE_CREATE", message(`?give`));
        emit("MESSAGE_CREATE", message(`!give ${TARGET} 2`));
        emit(
            "MESSAGE_CREATE",
            message(`!give ${TARGET} 2`, {
                author: { id: USER, username: "bot", bot: true },
            }),
        );
        emit("MESSAGE_CREATE", message(`give ${TARGET} 2`));
        emit("MESSAGE_CREATE", message(`!unknown`));
        await Bun.sleep(10);
        expect(ran).toBe(1);
        expect(
            calls.map((c) => (c.body as { content: string }).content),
        ).toEqual([
            "`amount` must be at most 5. Usage: `!give <user> <amount>`",
            "`user` is required. Usage: `?give <user> <amount>`",
        ]);
    });

    test("permissions and guild-only are checked before the handler runs", async () => {
        const { bot, calls, emit } = setup(intents);
        let ran = 0;
        bot.commands
            .add(
                command({
                    name: "kick",
                    description: "d",
                    prefix: true,
                    permissions: ["KickMembers", "BanMembers"],
                    run: () => void ran++,
                }),
                command({
                    name: "here",
                    description: "d",
                    prefix: true,
                    guildOnly: true,
                    run: () => void ran++,
                }),
            )
            .listen({ prefix: "!" });
        emit("MESSAGE_CREATE", message("!kick"));
        emit(
            "MESSAGE_CREATE",
            message("!here", { guild_id: undefined, member: undefined }),
        );
        await Bun.sleep(10);
        expect(ran).toBe(0);
        expect(
            calls.map((c) => (c.body as { content: string }).content),
        ).toEqual([
            "You need **Kick Members**, **Ban Members**.",
            "This command only works in servers.",
        ]);
        emit("GUILD_CREATE", {
            id: GUILD,
            name: "g",
            owner_id: USER,
            roles: [{ id: GUILD, name: "@everyone", permissions: "0" }],
            members: [],
            channels: [],
        });
        emit("MESSAGE_CREATE", message("!kick"));
        await Bun.sleep(10);
        expect(ran).toBe(1);
    });

    test("an attachment option takes the message's attachments in order", async () => {
        const { bot, calls, emit } = setup(intents);
        const seen: unknown[] = [];
        bot.commands
            .add(
                command({
                    name: "upload",
                    description: "d",
                    prefix: true,
                    options: {
                        file: option.attachment({ required: true }),
                        note: option.string(),
                    },
                    run: ({ options }) => void seen.push(options),
                }),
            )
            .listen({ prefix: "!" });
        const file = {
            id: "1",
            filename: "a.png",
            size: 3,
            url: "https://x/a.png",
            proxy_url: "https://x/a.png",
        };
        emit(
            "MESSAGE_CREATE",
            message("!upload nice one", { attachments: [file] }),
        );
        emit("MESSAGE_CREATE", message("!upload"));
        await Bun.sleep(10);
        expect(seen).toEqual([{ file, note: "nice one" }]);
        expect(
            calls.map((c) => (c.body as { content: string }).content),
        ).toEqual(["`file` is required. Usage: `!upload <file📎> [note]`"]);
    });

    test("warns when the intents a prefix command needs are missing", () => {
        captureWarnings();
        setup(0).bot.commands.listen({ prefix: "!" });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.code).toBe("LUNIBEE_MESSAGE_CONTENT_INTENT");
        expect(warnings[0]!.message).toContain(
            "MessageContent and GuildMessages or DirectMessages intents",
        );
        setup(1 << 9).bot.commands.listen({ prefix: "!" });
        expect(warnings).toHaveLength(2);
        expect(warnings[1]!.message).toContain("the MessageContent intent;");
        setup((1 << 9) | (1 << 15)).bot.commands.listen({ prefix: "!" });
        setup(0).bot.commands.listen();
        expect(warnings).toHaveLength(2);
    });
});
