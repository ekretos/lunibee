import { describe, expect, test } from "bun:test";
import { Client, createApi } from "../packages/core/src/index.ts";
import type {
    APIGuildMember,
    APIMessage,
} from "../packages/types/src/index.ts";

type Sent = {
    method: string;
    path: string;
    body?: unknown;
    options?: Record<string, unknown>;
};

/** A client whose REST requests are recorded and answered by `answer`. */
function setup(answer: (sent: Sent) => unknown = () => undefined) {
    const bot = new Client({ token: "a.b", intents: 0 });
    const sent: Sent[] = [];
    (bot.rest as unknown as { request: unknown }).request = async (
        method: string,
        path: string,
        body?: unknown,
        options?: Record<string, unknown>,
    ) => {
        const request = { method, path, body, options };
        sent.push(request);
        return answer(request);
    };
    return { bot, sent };
}

const G = "100000000000000001";
const U = "100000000000000002";
const C = "100000000000000003";
const M = "100000000000000004";

describe("bot.api paths and methods", () => {
    test("names go down, ids go in, methods send", async () => {
        const { bot, sent } = setup(() => ({}));
        const api = bot.api;
        await api.guilds(G).get();
        await api
            .guilds(G)
            .members(U)
            .patch({ nick: "x" }, { reason: "rename" });
        await api.guilds(G).members(U).roles("5").put();
        await api.guilds(G).members(U).roles("5").delete({ reason: "demote" });
        await api.channels(C).messages.post({ content: "hi" });
        await api.channels(C).messages(M).get();
        await api.channels(C).messages(M).crosspost.post();
        await api.channels(C).messages.bulkDelete.post({ messages: [M] });
        await api.guilds(G).auditLogs.get({ query: { limit: 5 } });
        await api.users("@me").get();
        await api.users("@me").guilds(G).delete();
        await api.invites("abc").get();
        await api.applications("7").guilds(G).commands.get();
        await api.webhooks("8")("tok").messages(M).patch({ content: "e" });
        expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([
            `GET /guilds/${G}`,
            `PATCH /guilds/${G}/members/${U}`,
            `PUT /guilds/${G}/members/${U}/roles/5`,
            `DELETE /guilds/${G}/members/${U}/roles/5`,
            `POST /channels/${C}/messages`,
            `GET /channels/${C}/messages/${M}`,
            `POST /channels/${C}/messages/${M}/crosspost`,
            `POST /channels/${C}/messages/bulk-delete`,
            `GET /guilds/${G}/audit-logs`,
            "GET /users/@me",
            `DELETE /users/@me/guilds/${G}`,
            "GET /invites/abc",
            `GET /applications/7/guilds/${G}/commands`,
            `PATCH /webhooks/8/tok/messages/${M}`,
        ]);
        expect(sent[1]).toMatchObject({
            body: { nick: "x" },
            options: { reason: "rename" },
        });
        expect(sent[3]!.options).toEqual({ reason: "demote" });
        expect(sent[8]!.options).toEqual({ query: { limit: 5 } });
        expect(sent[0]!.options).toEqual({});
    });

    test("ids can be numbers or bigints and are encoded, apart from @me", async () => {
        const { bot, sent } = setup();
        await bot.api.guilds(123).get();
        await bot.api.guilds(456n).get();
        await bot.api.channels(C).messages(M).reactions("👍")("@me").put();
        await bot.api
            .channels(C)
            .messages(M)
            .reactions("name:123")("@me")
            .delete();
        expect(sent.map((s) => s.path)).toEqual([
            "/guilds/123",
            "/guilds/456",
            `/channels/${C}/messages/${M}/reactions/%F0%9F%91%8D/@me`,
            `/channels/${C}/messages/${M}/reactions/name%3A123/@me`,
        ]);
    });

    test("a route reports its path and cannot be awaited into a hang", async () => {
        const { bot } = setup();
        const route = bot.api.guilds(G).members;
        expect(route.path).toBe(`/guilds/${G}/members`);
        expect(String(route)).toBe(`/guilds/${G}/members`);
        expect(await Promise.resolve(route)).toBe(route);
        expect(bot.api.guilds(G).path).toBe(`/guilds/${G}`);
        expect(bot.api).toBe(bot.api);
    });

    test("to() reaches routes the typed tree does not list", async () => {
        const { bot, sent } = setup();
        await bot.api.to("guilds", G, "stage-instances").get();
        await bot.api.to("channels", C, "pins", M).put();
        await bot.api.to("users", "@me").get();
        expect(sent.map((s) => s.path)).toEqual([
            `/guilds/${G}/stage-instances`,
            `/channels/${C}/pins/${M}`,
            "/users/@me",
        ]);
        expect(() => bot.api.to()).toThrow(TypeError);
        expect(() => bot.api.to("guilds", "a/b")).toThrow(TypeError);
        expect(() => bot.api.to("guilds", "")).toThrow(TypeError);
    });

    test("bad ids are refused before any request", async () => {
        const { bot, sent } = setup();
        const api = bot.api as unknown as Record<
            string,
            (...args: unknown[]) => unknown
        >;
        expect(() => api.guilds!()).toThrow(/exactly one id/);
        expect(() => api.guilds!("a", "b")).toThrow(/exactly one id/);
        expect(() => api.guilds!("")).toThrow(/cannot be empty/);
        expect(() => api.guilds!({})).toThrow(/string, number or bigint/);
        expect(() => api.guilds!(null)).toThrow(TypeError);
        expect(sent).toHaveLength(0);
        const real = createApi(bot.rest as unknown as never);
        expect(real).toBeDefined();
    });

    test("options reach the REST client: files, signal, reason, query", async () => {
        const { bot, sent } = setup();
        const controller = new AbortController();
        const files = [{ name: "a.txt", data: new Uint8Array([1]) }];
        await bot.api
            .channels(C)
            .messages.post(
                { content: "f" },
                { files, signal: controller.signal, reason: "r" },
            );
        expect(sent[0]!.options).toEqual({
            files,
            signal: controller.signal,
            reason: "r",
        });
    });

    test("results are typed by the route", async () => {
        const member = {
            user: { id: U, username: "ann" },
            roles: [],
        } as unknown as APIGuildMember;
        const message = { id: M, content: "hi" } as unknown as APIMessage;
        const { bot } = setup((s) =>
            s.path.includes("/members/") ? member : message,
        );
        const got = await bot.api.guilds(G).members(U).get();
        const id: string = got.user.id;
        const created = await bot.api
            .channels(C)
            .messages.post({ content: "hi" });
        const text: string = created.content;
        const custom = await bot.api.to("x").get<{ ok: boolean }>();
        void [id, text, custom];
        // @ts-expect-error guilds is not a route of a channel
        void bot.api.channels(C).guilds;
        expect(id).toBe(U);
    });
});

describe("paging", () => {
    const members = (from: number, count: number): APIGuildMember[] =>
        Array.from({ length: count }, (_, i) => ({
            user: { id: String(from + i), username: `u${from + i}` },
            roles: [],
        })) as unknown as APIGuildMember[];

    test("members page by user id after the last one, until a short page", async () => {
        const data = [members(1, 1000), members(1001, 1000), members(2001, 5)];
        const { bot, sent } = setup(() => data.shift());
        const sizes: number[] = [];
        for await (const page of bot.api.guilds(G).members.pages())
            sizes.push(page.length);
        expect(sizes).toEqual([1000, 1000, 5]);
        expect(sent.map((s) => s.options)).toEqual([
            { signal: undefined, query: { limit: 1000 } },
            { signal: undefined, query: { limit: 1000, after: "1000" } },
            { signal: undefined, query: { limit: 1000, after: "2000" } },
        ]);
    });

    test("messages page backwards by id with a smaller default limit", async () => {
        const pages = [
            Array.from({ length: 100 }, (_, i) => ({ id: String(500 - i) })),
            [{ id: "400" }],
        ];
        const { bot, sent } = setup(() => pages.shift());
        const all = await bot.api.channels(C).messages.all();
        expect(all).toHaveLength(101);
        expect(sent.map((s) => (s.options as { query: object }).query)).toEqual(
            [{ limit: 100 }, { limit: 100, before: "401" }],
        );
    });

    test("all() stops at max and shrinks the last request; start, cursor, query and idOf apply", async () => {
        const { bot, sent } = setup((s) => {
            const limit = (s.options as { query: { limit: number } }).query
                .limit;
            return Array.from({ length: limit }, (_, i) => ({ code: `c${i}` }));
        });
        const items = await bot.api.channels(C).invites.all({
            max: 250,
            idOf: (invite) => invite.code,
            start: "s",
            cursor: "before",
            query: { with_counts: true },
        });
        expect(items).toHaveLength(250);
        expect(sent.map((s) => (s.options as { query: object }).query)).toEqual(
            [
                { with_counts: true, limit: 100, before: "s" },
                { with_counts: true, limit: 100, before: "c99" },
                { with_counts: true, limit: 100, before: "c99" },
            ],
        );
        expect(await bot.api.guilds(G).members.all({ max: 0 })).toEqual([]);
    });

    test("an empty page ends the list; a missing id is explained; a signal is passed along", async () => {
        const first = setup(() => []);
        expect(await first.bot.api.users("@me").guilds.all()).toEqual([]);
        const { bot } = setup(() => [{ name: "no id" }]);
        await expect(
            bot.api.guilds(G).emojis.all({ limit: 1 }),
        ).rejects.toThrow(/pass idOf/);
        const controller = new AbortController();
        const seen = setup(() => []);
        for await (const _ of seen.bot.api
            .guilds(G)
            .bans.pages({ signal: controller.signal }))
            void _;
        expect(seen.sent[0]!.options).toMatchObject({
            signal: controller.signal,
            query: { limit: 1000 },
        });
    });
});
