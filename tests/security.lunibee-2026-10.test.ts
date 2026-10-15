import { describe, expect, test } from "bun:test";
import { HttpTransport, REST, Routes } from "../packages/rest/src/index.ts";
import { codeBlock } from "../packages/formatters/src/index.ts";
import {
    Client,
    GatewayIntentBits,
    command,
    option,
} from "../packages/core/src/index.ts";
import { parsePrefixArgs } from "../packages/utils/src/index.ts";

// Security report "Lunibee 0.3.1 — Security Assessment" (2026-10-15),
// findings LUNIBEE-001 to LUNIBEE-007.

function recordingRest() {
    const urls: string[] = [];
    const rest = new REST({
        token: "BOT.TOKEN.SECRET",
        retries: 0,
        globalLimit: false,
        transport: new HttpTransport({
            fetch: async (url) => {
                urls.push(String(url));
                return new Response("{}", {
                    headers: { "content-type": "application/json" },
                });
            },
        }),
    });
    return { rest, urls };
}

describe("LUNIBEE-001: tab, LF, CR, other controls and '#' cannot steer a REST path", () => {
    test("dot segments split by whitespace are refused before any request", async () => {
        const { rest, urls } = recordingRest();
        for (const path of [
            "/channels/111/messages/.\t./.\t./.\t./guilds/222/members/333",
            "/channels/111/messages/.\n./.\n./.\n./guilds/222/members/333",
            "/channels/111/messages/.\r./.\r./.\r./guilds/222/members/333",
            "/invites/\t../users/@me/guilds",
            "/channels/1/messages/2/reactions/x#/@me",
            "/channels/1/messages/2/reactions/a b/@me",
            "/channels/1/messages/\u0000/x",
            "/channels/1/messages/\u007f/x",
            // Encoded whitespace around dots, alone or after an encoded slash.
            "/channels/1/messages/%09../x",
            "/channels/1/messages/x%2F.%09.%2Fy",
        ])
            await expect(rest.delete(path)).rejects.toThrow(TypeError);
        expect(urls).toEqual([]);
    });

    test("ordinary paths, queries and encoded route segments still work", async () => {
        const { rest, urls } = recordingRest();
        await rest.get("/guilds/1/members/search?query=a%20b&limit=5");
        await rest.get("/guilds/1/members/search", { query: { query: "a b" } });
        expect(urls).toHaveLength(2);
        // A route helper encodes a hostile "emoji" into one segment; one that
        // decodes to dot segments is refused rather than sent anywhere.
        const payload = ".\t./".repeat(5) + "guilds/3/members/4/roles/5#";
        await expect(
            rest.put(Routes.messageReactionMe("1", "2", payload)),
        ).rejects.toThrow(TypeError);
        await rest.put(Routes.messageReactionMe("1", "2", "👍"));
        expect(urls).toHaveLength(3);
        expect(urls[2]).toEndWith("/@me");
    });
});

describe("LUNIBEE-006: codeBlock() cannot be closed by any run of backticks", () => {
    // Discord's rule: a block opens with ``` (optionally a language line) and
    // ends at the first ``` after it.
    const FENCE = /^```(?:([a-z0-9_+\-.#]+?)\n)?\n*([^\n][^]*?)\n*```/i;

    test("runs of 3 to 8 backticks stay inside the block", () => {
        for (let n = 3; n <= 8; n++) {
            const input = `${"`".repeat(n)}\n# Injected\n[Verify](https://evil.example) @everyone\n`;
            const out = codeBlock(input);
            const match = FENCE.exec(out)!;
            expect(out.slice(match[0].length)).toBe("");
            expect(match[2]!.replaceAll("​", "")).toBe(input.trimEnd());
        }
    });

    test("text without adjacent backticks is unchanged", () => {
        expect(codeBlock("a `b` c", "ts")).toBe("```ts\na `b` c\n```");
    });
});

describe("LUNIBEE-007: forum posts get the client's allowedMentions default", () => {
    function client(allowedMentions?: { parse: [] }) {
        const bodies: Array<{ url: string; body: unknown }> = [];
        const bot = new Client({
            token: "bot.token",
            intents: [],
            allowedMentions,
            rest: {
                transport: new HttpTransport({
                    fetch: async (url, init) => {
                        const raw = init.body;
                        bodies.push({
                            url: String(url),
                            body:
                                typeof raw === "string"
                                    ? JSON.parse(raw)
                                    : raw instanceof FormData
                                      ? JSON.parse(
                                            String(raw.get("payload_json")),
                                        )
                                      : undefined,
                        });
                        return Response.json({
                            id: "900000000000000001",
                            type: 11,
                            guild_id: "1",
                            parent_id: "2",
                            name: "post",
                        });
                    },
                }),
            } as never, // `transport` is passed through to REST at runtime
        });
        return { bot, bodies };
    }
    const text = "@everyone <@&123456789012345678> free nitro";

    test("the post's first message carries the default", async () => {
        const { bot, bodies } = client({ parse: [] });
        await bot.channels.threads("200000000000000003").createForumPost({
            name: "Suggestion",
            message: { content: text },
        });
        expect(bodies[0]!.body).toMatchObject({
            name: "Suggestion",
            message: { content: text, allowed_mentions: { parse: [] } },
        });
        bot.destroy();
    });

    test("a message's own allowed_mentions wins, and files keep their alt text", async () => {
        const { bot, bodies } = client({ parse: [] });
        await bot.channels.threads("200000000000000003").createForumPost({
            name: "Report",
            appliedTags: ["1"],
            message: {
                content: text,
                allowed_mentions: { parse: ["users"] },
                files: [
                    {
                        name: "a.txt",
                        data: new Uint8Array([1]),
                        description: "alt",
                    },
                ],
            },
        });
        expect(bodies[0]!.body).toMatchObject({
            applied_tags: ["1"],
            message: {
                allowed_mentions: { parse: ["users"] },
                attachments: [{ id: 0, description: "alt" }],
            },
        });
        bot.destroy();
    });

    test("without a default nothing is added", async () => {
        const { bot, bodies } = client();
        await bot.channels
            .threads("200000000000000003")
            .createForumPost({ name: "x", message: { content: "hi" } });
        expect(
            (bodies[0]!.body as { message: Record<string, unknown> }).message,
        ).not.toHaveProperty("allowed_mentions");
        bot.destroy();
    });
});

describe("LUNIBEE-005: a prefix choice reaches the handler as the choice itself", () => {
    test("parsePrefixArgs returns the canonical choice", () => {
        const specs = [
            {
                name: "scope",
                type: "string" as const,
                choices: ["mine", "all"],
            },
        ];
        for (const input of ["all", "ALL", "aLl"])
            expect(parsePrefixArgs(input, specs)).toMatchObject({
                ok: true,
                values: { scope: "all" },
            });
        expect(parsePrefixArgs("everything", specs)).toMatchObject({
            ok: false,
        });
        // An exact match wins over a case-insensitive one.
        expect(
            parsePrefixArgs("A", [
                { name: "x", type: "string", choices: ["a", "A"] },
            ]),
        ).toMatchObject({ values: { x: "A" } });
    });

    test("a command() handler comparing exactly sees the canonical value", async () => {
        const GUILD = "100000000000000001";
        const CHANNEL = "100000000000000002";
        const bot = new Client({
            token: "bot.token",
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
        });
        const gateway = bot.gateway as unknown as {
            emit(e: string, d: unknown): void;
        };
        gateway.emit("GUILD_CREATE", {
            id: GUILD,
            name: "g",
            owner_id: "100000000000000099",
            roles: [
                {
                    id: GUILD,
                    name: "@everyone",
                    permissions: String((1n << 10n) | (1n << 11n)),
                },
            ],
            channels: [
                {
                    id: CHANNEL,
                    type: 0,
                    name: "general",
                    permission_overwrites: [],
                },
            ],
        });
        const seen: string[] = [];
        bot.commands
            .add(
                command({
                    name: "purge",
                    description: "Delete messages",
                    options: {
                        scope: option.choice(["mine", "all"] as const, {
                            default: "mine",
                        }),
                    },
                    prefix: true,
                    slash: false,
                    run: ({ options }) => void seen.push(options.scope),
                }),
            )
            .listen({ prefix: "!" });
        gateway.emit("MESSAGE_CREATE", {
            id: "100000000000000010",
            channel_id: CHANNEL,
            guild_id: GUILD,
            content: "!purge ALL",
            type: 0,
            author: { id: "100000000000000050", username: "member" },
            member: { roles: [], joined_at: "2024-01-01T00:00:00.000Z" },
            timestamp: "2024-01-01T00:00:00.000Z",
            attachments: [],
            embeds: [],
            mentions: [],
            mention_roles: [],
        });
        await Bun.sleep(30);
        expect(seen).toEqual(["all"]);
        bot.destroy();
    });
});

describe("LUNIBEE-003: a message's placeholder channel never stands in for the real one", () => {
    const GUILD = "100000000000000001";
    const CHANNEL = "100000000000000002";
    const MOD = "100000000000000003";
    const VIEW = 1n << 10n;
    const SEND = 1n << 11n;

    function setup(intents: number[]) {
        const log: Array<{ method: string; url: string; body?: string }> = [];
        const bot = new Client({
            token: "bot.token.value",
            intents,
            rest: {
                retries: 0,
                globalLimit: false,
                transport: new HttpTransport({
                    fetch: async (url, init) => {
                        log.push({
                            method: String(init.method),
                            url: String(url),
                            body:
                                typeof init.body === "string"
                                    ? init.body
                                    : undefined,
                        });
                        if (init.method === "GET")
                            return Response.json({
                                id: CHANNEL,
                                type: 0,
                                guild_id: GUILD,
                                name: "staff",
                                permission_overwrites: [
                                    {
                                        id: GUILD,
                                        type: 0,
                                        allow: "0",
                                        deny: String(VIEW),
                                    },
                                ],
                            });
                        return new Response(null, { status: 204 });
                    },
                }),
            } as never,
        });
        const gateway = bot.gateway as unknown as {
            emit(e: string, d: unknown): void;
        };
        const say = (content: string) =>
            gateway.emit("MESSAGE_CREATE", {
                id: "100000000000000010",
                channel_id: CHANNEL,
                guild_id: GUILD,
                content,
                type: 0,
                author: { id: MOD, username: "mod" },
                member: { roles: [], joined_at: "2024-01-01T00:00:00.000Z" },
                timestamp: "2024-01-01T00:00:00.000Z",
                attachments: [],
                embeds: [],
                mentions: [],
                mention_roles: [],
            });
        return { bot, gateway, log, say };
    }

    test("locking a channel known only from a message keeps its other overwrite bits", async () => {
        const { bot, log, say } = setup([
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ]);
        bot.on("messageCreate", async (message) => {
            if (message.content === "!lock")
                await message.channel.editPermissionOverwrite(
                    message.guildId!,
                    { SendMessages: false },
                    { type: 0 },
                );
        });
        say("!lock");
        await Bun.sleep(50);
        expect(bot.channels.get(CHANNEL)!.partial).toBe(true);
        expect(log.map((r) => r.method)).toEqual(["GET", "PUT"]);
        const deny = BigInt(JSON.parse(log[1]!.body!).deny);
        expect(deny & VIEW).toBe(VIEW);
        expect(deny & SEND).toBe(SEND);
        bot.destroy();
    });

    test("permission checks on a partial channel are unknown, not guild-level", () => {
        const { bot, gateway, say } = setup([GatewayIntentBits.Guilds]);
        gateway.emit("GUILD_CREATE", {
            id: GUILD,
            name: "g",
            owner_id: "100000000000000099",
            roles: [
                {
                    id: GUILD,
                    name: "@everyone",
                    permissions: String(VIEW | SEND),
                },
            ],
            members: [
                {
                    user: { id: MOD, username: "mod" },
                    roles: [],
                    joined_at: "2024-01-01T00:00:00.000Z",
                },
            ],
            channels: [],
        });
        say("hi");
        expect(bot.channels.get(CHANNEL)!.partial).toBe(true);
        expect(bot.permissionsFor(MOD, CHANNEL)).toBeNull();
        expect(
            bot.guilds.members(GUILD).get(MOD)!.permissionsIn(CHANNEL),
        ).toBeNull();
        bot.destroy();
    });

    test("message.channel is the cached channel; real channel data clears partial", () => {
        const { bot, gateway, say } = setup([GatewayIntentBits.Guilds]);
        let seen: { channel: unknown; type: number } | undefined;
        bot.on(
            "messageCreate",
            (m) => void (seen = { channel: m.channel, type: m.channel.type }),
        );
        say("before");
        expect(bot.channels.get(CHANNEL)!.partial).toBe(true);
        gateway.emit("CHANNEL_CREATE", {
            id: CHANNEL,
            type: 5,
            guild_id: GUILD,
            name: "news",
            permission_overwrites: [
                { id: GUILD, type: 0, allow: "0", deny: String(VIEW) },
            ],
        });
        const cached = bot.channels.get(CHANNEL)!;
        expect(cached.partial).toBe(false);
        expect(cached.permissionOverwrites).toHaveLength(1);
        say("after");
        expect(seen!.channel).toBe(cached);
        expect(seen!.type).toBe(5);
        bot.destroy();
    });
});

describe("LUNIBEE-002: prefix channel and role arguments stay in the message's server", () => {
    const GA = "100000000000000001";
    const CA = "100000000000000002";
    const VA = "100000000000000003";
    const RA = "100000000000000004";
    const GB = "200000000000000001";
    const CB = "200000000000000002";
    const RB = "200000000000000004";
    const UNCACHED_B = "200000000000000005";
    const OWNER = "100000000000000050";

    function setup() {
        const sent: string[] = [];
        const replies: string[] = [];
        const bot = new Client({
            token: "bot.token",
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
            rest: {
                retries: 0,
                globalLimit: false,
                transport: new HttpTransport({
                    fetch: async (url, init) => {
                        const path = new URL(String(url)).pathname;
                        if (path.endsWith("/messages")) {
                            replies.push(JSON.parse(String(init.body)).content);
                            return Response.json({
                                id: "9",
                                channel_id: CA,
                                content: "",
                                author: { id: "1", username: "b" },
                                timestamp: "2024-01-01T00:00:00.000Z",
                            });
                        }
                        if (path.endsWith(`/guilds/${GA}/roles`))
                            return Response.json([
                                { id: RA, name: "a", permissions: "0" },
                            ]);
                        if (init.method === "GET")
                            // Discord answers for a channel the bot can see in server B.
                            return Response.json({
                                id: UNCACHED_B,
                                type: 0,
                                guild_id: GB,
                                name: "b",
                            });
                        sent.push(`${init.method} ${path}`);
                        return Response.json({
                            id: path.split("/")[4],
                            type: 0,
                            guild_id: GA,
                            name: "x",
                        });
                    },
                }),
            } as never,
        });
        const gateway = bot.gateway as unknown as {
            emit(e: string, d: unknown): void;
        };
        gateway.emit("GUILD_CREATE", {
            id: GA,
            name: "A",
            owner_id: OWNER,
            roles: [{ id: GA, name: "@everyone", permissions: "3072" }],
            channels: [
                { id: CA, type: 0, name: "general" },
                { id: VA, type: 2, name: "voice" },
            ],
        });
        gateway.emit("GUILD_CREATE", {
            id: GB,
            name: "B",
            owner_id: "200000000000000099",
            roles: [
                { id: GB, name: "@everyone", permissions: "3072" },
                { id: RB, name: "b", permissions: "0" },
            ],
            channels: [{ id: CB, type: 0, name: "announcements" }],
        });
        const ran: unknown[] = [];
        bot.commands
            .add(
                command({
                    name: "slowmode",
                    description: "Set slowmode",
                    permissions: ["ManageChannels"],
                    options: {
                        channel: option.channel({
                            required: true,
                            kinds: ["text"],
                        }),
                        seconds: option.integer({
                            required: true,
                            min: 0,
                            max: 21600,
                        }),
                    },
                    prefix: true,
                    run: async ({ bot: b, options }) => {
                        ran.push(options.channel);
                        await b
                            .channel(options.channel)
                            .edit({ rate_limit_per_user: options.seconds });
                    },
                }),
                command({
                    name: "grant",
                    description: "Grant",
                    options: { role: option.role({ required: true }) },
                    prefix: true,
                    run: ({ options }) => void ran.push(options.role),
                }),
                command({
                    name: "show",
                    description: "Show a channel",
                    options: { where: option.channel({ required: true }) },
                    prefix: true,
                    run: ({ options }) => void ran.push(options.where),
                }),
                command({
                    name: "ping",
                    description: "Ping",
                    options: { who: option.mentionable({ required: true }) },
                    prefix: true,
                    run: ({ options }) => void ran.push(options.who),
                }),
            )
            .listen({ prefix: "!" });
        let n = 10;
        const say = (
            content: string,
            guild: string | null = GA,
            channel = CA,
        ) =>
            gateway.emit("MESSAGE_CREATE", {
                id: `1000000000000000${n++}`,
                channel_id: channel,
                guild_id: guild ?? undefined,
                content,
                type: 0,
                author: { id: OWNER, username: "owner" },
                member: guild
                    ? { roles: [], joined_at: "2024-01-01T00:00:00.000Z" }
                    : undefined,
                timestamp: "2024-01-01T00:00:00.000Z",
                attachments: [],
                embeds: [],
                mentions: [],
                mention_roles: [],
            });
        return { bot, sent, replies, ran, say };
    }

    test("a channel in another server, cached or fetched, or of the wrong kind is refused", async () => {
        const { bot, sent, replies, ran, say } = setup();
        say(`!slowmode <#${CB}> 21600`);
        say(`!slowmode <#${UNCACHED_B}> 21600`);
        say(`!slowmode <#${VA}> 21600`);
        say(`!slowmode <#${CA}> 5`);
        await Bun.sleep(80);
        expect(sent).toEqual([`PATCH /api/v10/channels/${CA}`]);
        expect(ran).toEqual([CA]);
        expect(replies.sort()).toEqual([
            "`channel` must be a channel in this server. Usage: `!slowmode <channel> <seconds>`",
            "`channel` must be a channel in this server. Usage: `!slowmode <channel> <seconds>`",
            "`channel` must be a text channel. Usage: `!slowmode <channel> <seconds>`",
        ]);
        bot.destroy();
    });

    test("roles and role mentionables must be in the server; @everyone and fetched roles are fine", async () => {
        const { bot, replies, ran, say } = setup();
        say(`!grant <@&${RB}>`);
        say(`!ping <@&${RB}>`);
        say(`!grant <@&${GA}>`);
        say(`!grant <@&${RA}>`); // not cached: fetched from the server's role list
        say(`!ping <@${OWNER}>`); // a user mentionable is not a role
        await Bun.sleep(80);
        expect(ran).toHaveLength(3);
        expect(ran).toContain(GA);
        expect(ran).toContain(RA);
        expect(ran).toContainEqual({ id: OWNER, type: "user" });
        expect(
            replies.filter((r) => r.includes("must be a role in this server")),
        ).toHaveLength(2);
        bot.destroy();
    });

    test("in a DM a channel argument may only name the DM, and roles are refused", async () => {
        const { bot, replies, ran, say } = setup();
        const DM = "300000000000000001";
        say(`!grant <@&${RA}>`, null, DM);
        say(`!show <#${CA}>`, null, DM);
        say(`!show <#${DM}>`, null, DM);
        await Bun.sleep(80);
        expect(ran).toEqual([DM]);
        expect(
            replies.some((r) => r.includes("must be a role in this server")),
        ).toBe(true);
        expect(replies.some((r) => r.includes("must be this channel"))).toBe(
            true,
        );
        bot.destroy();
    });
});
