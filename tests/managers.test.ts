import { describe, expect, test } from "bun:test";
import { Manager, ResourceManager } from "../packages/managers/src/base.ts";
import { RoleManager } from "../packages/managers/src/role.ts";
import { GuildMemberManager } from "../packages/managers/src/member.ts";
import { GuildManager } from "../packages/managers/src/guild.ts";
import { UserManager } from "../packages/managers/src/user.ts";
import { REST } from "@lunibee/rest";

describe("Managers Coverage", () => {
    test("Manager basic collection methods", () => {
        const mgr = new Manager<string, { id: string; name: string }>();
        mgr.set("1", { id: "1", name: "Alpha" });
        expect(mgr.get("1")?.name).toBe("Alpha");
        expect(mgr.has("1")).toBe(true);
        expect(mgr.size).toBe(1);
        expect(mgr.first()?.name).toBe("Alpha");
        expect(mgr.values().length).toBe(1);
        expect(mgr.find((v) => v.name === "Alpha")?.id).toBe("1");
        expect([...mgr].length).toBe(1);
        mgr.delete("1");
        expect(mgr.size).toBe(0);
        mgr.set("2", { id: "2", name: "Beta" });
        mgr.clear();
        expect(mgr.size).toBe(0);
    });

    test("ResourceManager resolve, fetch, fetchMany, and upsert", async () => {
        const store = new Map<string, { id: string; val: number }>([
            ["a", { id: "a", val: 10 }],
            ["b", { id: "b", val: 20 }],
        ]);

        const resMgr = new ResourceManager(
            async (id: string) => {
                const item = store.get(id);
                if (!item) throw new Error("Not found");
                return item;
            },
            (item) => item.id,
        );

        const fetched = await resMgr.fetch("a");
        expect(fetched.val).toBe(10);
        expect(resMgr.get("a")?.val).toBe(10);

        const resolved = await resMgr.resolve("a");
        expect(resolved.val).toBe(10);

        const many = await resMgr.fetchMany(["a", "b"]);
        expect(many.length).toBe(2);

        resMgr.upsert({ id: "c", val: 30 });
        expect(resMgr.get("c")?.val).toBe(30);
        resMgr.update({ id: "c", val: 40 });
        expect(resMgr.get("c")?.val).toBe(40);
    });

    test("RoleManager and GuildMemberManager execute REST operations", async () => {
        const original = globalThis.fetch;
        const rest = new REST({ token: "test" });

        (globalThis as any).fetch = async (url: string, opts: any) => {
            if (
                url.includes("/roles/123456789012345682") &&
                opts.method === "PATCH"
            ) {
                return new Response(
                    JSON.stringify({
                        id: "123456789012345682",
                        name: "SuperMod",
                    }),
                    {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    },
                );
            }
            if (url.includes("/roles") && opts.method === "GET") {
                return new Response(
                    JSON.stringify([
                        {
                            id: "123456789012345681",
                            name: "Admin",
                            color: 0xff0000,
                        },
                    ]),
                    {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    },
                );
            }
            if (url.includes("/roles") && opts.method === "POST") {
                return new Response(
                    JSON.stringify({
                        id: "123456789012345682",
                        name: "Mod",
                        color: 0x00ff00,
                    }),
                    {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    },
                );
            }
            if (
                url.includes("/members/123456789012345679") &&
                opts.method === "PATCH"
            ) {
                return new Response(
                    JSON.stringify({
                        user: {
                            id: "123456789012345679",
                            username: "testuser",
                        },
                        nick: "NewNick",
                    }),
                    {
                        status: 200,
                        headers: { "content-type": "application/json" },
                    },
                );
            }
            return new Response(null, { status: 204 });
        };

        try {
            const roleMgr = new RoleManager("123456789012345678", rest);
            const roles = await roleMgr.fetchAll();
            expect(roles[0]?.name).toBe("Admin");

            const createdRole = await roleMgr.create({
                name: "Mod",
                color: 0x00ff00,
            });
            expect(createdRole.id).toBe("123456789012345682");

            const editedRole = await roleMgr.edit("123456789012345682", {
                name: "SuperMod",
            });
            expect(editedRole.name).toBe("SuperMod");
            await roleMgr.deleteRole("123456789012345682");

            const memberMgr = new GuildMemberManager(
                "123456789012345678",
                rest,
            );
            await memberMgr.kick("123456789012345679");
            await memberMgr.ban("123456789012345679", {
                deleteMessageSeconds: 3600,
            });
            await memberMgr.unban("123456789012345679");
            await memberMgr.addRole("123456789012345679", "123456789012345680");
            await memberMgr.removeRole(
                "123456789012345679",
                "123456789012345680",
            );

            const editedMember = await memberMgr.edit("123456789012345679", {
                nick: "NewNick",
            });
            expect(editedMember.nickname).toBe("NewNick");

            await memberMgr.timeout("123456789012345679", 60_000);
            await memberMgr.timeout("123456789012345679", null);
        } finally {
            globalThis.fetch = original;
        }
    });

    test("GuildManager executes REST operations", async () => {
        const rest = new REST({ token: "test" });
        const guildMgr = new GuildManager(rest);
        let lastUrl = "";
        let lastOpts: any;

        (rest as any).get = async (url: string) => {
            lastUrl = url;
            if (url === "/guilds/1") return { id: "1", name: "Guild 1" };
            // Single auto-moderation rule fetch returns one rule object.
            if (/\/auto-moderation\/rules\/\d+$/.test(url))
                return {
                    id: "123456789012345679",
                    guild_id: "1",
                    name: "rule",
                    creator_id: "1",
                    event_type: 1,
                    trigger_type: 1,
                    trigger_metadata: {},
                    actions: [],
                    enabled: true,
                    exempt_roles: [],
                    exempt_channels: [],
                };
            return [];
        };
        const autoModRule = (id: string, name: string) => ({
            id,
            guild_id: "1",
            name,
            creator_id: "1",
            event_type: 1,
            trigger_type: 1,
            trigger_metadata: {},
            actions: [],
            enabled: true,
            exempt_roles: [],
            exempt_channels: [],
        });
        (rest as any).post = async (url: string, opts: any) => {
            lastUrl = url;
            lastOpts = opts;
            if (/\/auto-moderation\/rules$/.test(url))
                return autoModRule("123456789012345679", opts.name);
            return { id: "2", name: opts.name };
        };
        (rest as any).patch = async (url: string, opts: any) => {
            lastUrl = url;
            lastOpts = opts;
            if (/\/auto-moderation\/rules\/\d+$/.test(url))
                return autoModRule("123456789012345679", opts.name);
            return { id: "1", name: opts.name };
        };
        (rest as any).delete = async (url: string) => {
            lastUrl = url;
        };

        const created = await guildMgr.create({ name: "New Guild" });
        expect(created.id).toBe("2");
        expect(lastUrl).toBe("/guilds");

        const edited = await guildMgr.edit("1", { name: "Edited Guild" });
        expect(edited.id).toBe("1");
        expect(lastUrl).toBe("/guilds/1");
        expect(lastOpts.name).toBe("Edited Guild");

        await guildMgr.deleteGuild("1");
        expect(lastUrl).toBe("/guilds/1");

        await guildMgr.fetchPreview("1");
        expect(lastUrl).toBe("/guilds/1/preview");

        await guildMgr.fetchActiveThreads("1");
        expect(lastUrl).toBe("/guilds/1/threads/active");

        await guildMgr.fetchWebhooks("1");
        expect(lastUrl).toBe("/guilds/1/webhooks");

        await guildMgr.fetchInvites("1");
        expect(lastUrl).toBe("/guilds/1/invites");

        await guildMgr.fetchAutoModerationRules("1");
        expect(lastUrl).toBe("/guilds/1/auto-moderation/rules");

        await guildMgr.fetchAutoModerationRule("1", "123456789012345679");
        expect(lastUrl).toBe("/guilds/1/auto-moderation/rules/123456789012345679");

        await guildMgr.createAutoModerationRule("1", { name: "rule" });
        expect(lastUrl).toBe("/guilds/1/auto-moderation/rules");
        expect(lastOpts.name).toBe("rule");

        await guildMgr.editAutoModerationRule("1", "123456789012345679", { name: "rule2" });
        expect(lastUrl).toBe("/guilds/1/auto-moderation/rules/123456789012345679");
        expect(lastOpts.name).toBe("rule2");

        await guildMgr.deleteAutoModerationRule("1", "123456789012345679");
        expect(lastUrl).toBe("/guilds/1/auto-moderation/rules/123456789012345679");

        // Also cover the fetch in constructor (ResourceManager.fetch)
        const fetched = await guildMgr.fetch("1");
        expect(fetched.id).toBe("1");
    });

    test("UserManager executes REST operations", async () => {
        const rest = new REST({ token: "test" });
        const userMgr = new UserManager(rest);
        let lastUrl = "";
        let lastOpts: any;

        (rest as any).get = async (url: string) => {
            lastUrl = url;
            if (url === "/users/@me")
                return { id: "123456789012345679", username: "bot" };
            if (url === "/users/1") return { id: "1", username: "user1" };
            return {};
        };
        (rest as any).post = async (url: string, opts: any) => {
            lastUrl = url;
            lastOpts = opts;
            return { id: "ch1" };
        };
        (rest as any).patch = async (url: string, opts: any) => {
            lastUrl = url;
            lastOpts = opts;
            return { id: "123456789012345679", username: opts.username };
        };
        (rest as any).delete = async (url: string) => {
            lastUrl = url;
        };

        const me = await userMgr.fetchMe();
        expect(me.id).toBe("123456789012345679");
        expect(lastUrl).toBe("/users/@me");

        const edited = await userMgr.editMe({ username: "newbot" });
        expect(edited.username).toBe("newbot");
        expect(lastUrl).toBe("/users/@me");
        expect(lastOpts.username).toBe("newbot");

        await userMgr.leaveGuild("guild1");
        expect(lastUrl).toBe("/users/@me/guilds/guild1");

        const dm = await userMgr.createDM("1");
        expect(dm.id).toBe("ch1");
        expect(lastUrl).toBe("/users/@me/channels");
        expect(lastOpts.recipient_id).toBe("1");

        const fetched = await userMgr.fetch("1");
        expect(fetched.id).toBe("1");
        expect(lastUrl).toBe("/users/1");
    });

    test("EmojiManager executes REST operations", async () => {
        const { REST } = await import("../packages/rest/src/index.ts");
        const { EmojiManager } = await import("../packages/managers/src/emoji.ts");
        const rest = new REST({ token: "test" });
        const emojiMgr = new EmojiManager(rest, "12345");
        
        let lastUrl = "";
        let lastOpts: any;
        
        (rest as any).get = async (url: string) => {
            lastUrl = url;
            if (url.includes("/emojis/")) return { id: "123456789012345678", name: "test_emoji" };
            return [{ id: "123456789012345678", name: "test_emoji" }];
        };
        (rest as any).post = async (url: string, body: any) => {
            lastUrl = url;
            lastOpts = body;
            return { id: "123456789012345679", name: body.name };
        };
        (rest as any).patch = async (url: string, body: any) => {
            lastUrl = url;
            lastOpts = body;
            return { id: "123456789012345678", name: body.name };
        };
        (rest as any).delete = async (url: string) => {
            lastUrl = url;
        };

        const fetched = await emojiMgr.fetch("123456789012345678");
        expect(fetched.id).toBe("123456789012345678");
        expect(lastUrl).toBe("/guilds/12345/emojis/123456789012345678");
        
        const all = await emojiMgr.fetchAll();
        expect(all.length).toBe(1);
        expect(lastUrl).toBe("/guilds/12345/emojis");
        
        const created = await emojiMgr.create({ name: "cool", image: "data:image/jpeg;base64," });
        expect(created.name).toBe("cool");
        expect(lastUrl).toBe("/guilds/12345/emojis");
        
        const edited = await emojiMgr.edit("123456789012345678", { name: "uncool" });
        expect(edited.name).toBe("uncool");
        expect(lastUrl).toBe("/guilds/12345/emojis/123456789012345678");
        
        await emojiMgr.deleteEmoji("123456789012345678");
        expect(lastUrl).toBe("/guilds/12345/emojis/123456789012345678");
    });
});
