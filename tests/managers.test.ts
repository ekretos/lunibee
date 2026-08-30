import { describe, expect, test } from "bun:test";
import { Manager, ResourceManager } from "../packages/managers/src/base.ts";
import { RoleManager } from "../packages/managers/src/role.ts";
import { GuildMemberManager } from "../packages/managers/src/member.ts";
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
          JSON.stringify({ id: "123456789012345682", name: "SuperMod" }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.includes("/roles") && opts.method === "GET") {
        return new Response(
          JSON.stringify([
            { id: "123456789012345681", name: "Admin", color: 0xff0000 },
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
            user: { id: "123456789012345679", username: "testuser" },
            nick: "NewNick",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
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

      const memberMgr = new GuildMemberManager("123456789012345678", rest);
      await memberMgr.kick("123456789012345679");
      await memberMgr.ban("123456789012345679", { deleteMessageSeconds: 3600 });
      await memberMgr.unban("123456789012345679");
      await memberMgr.addRole("123456789012345679", "123456789012345680");
      await memberMgr.removeRole("123456789012345679", "123456789012345680");

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
});
