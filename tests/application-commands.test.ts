import { describe, expect, test } from "bun:test";
import { ApplicationCommandManager } from "../packages/managers/src/application.ts";

describe("ApplicationCommandManager", () => {
    const recordedCalls: { method: string; path: string; body?: unknown }[] =
        [];

    const mockRest = {
        get: async <T>(path: string): Promise<T> => {
            recordedCalls.push({ method: "GET", path });
            return [
                {
                    id: "cmd_1",
                    name: "test",
                    description: "desc",
                    application_id: "app_123",
                    version: "1",
                },
            ] as T;
        },
        post: async <T>(path: string, body?: unknown): Promise<T> => {
            recordedCalls.push({ method: "POST", path, body });
            return {
                id: "cmd_2",
                name: (body as any)?.name,
                description: (body as any)?.description,
                application_id: "app_123",
                version: "1",
            } as T;
        },
        put: async <T>(path: string, body?: unknown): Promise<T> => {
            recordedCalls.push({ method: "PUT", path, body });
            return [
                {
                    id: "cmd_3",
                    name: "bulk",
                    description: "desc",
                    application_id: "app_123",
                    version: "1",
                },
            ] as T;
        },
        patch: async <T>(path: string, body?: unknown): Promise<T> => {
            recordedCalls.push({ method: "PATCH", path, body });
            return {
                id: "cmd_1",
                name: "updated",
                description: "desc",
                application_id: "app_123",
                version: "1",
            } as T;
        },
        delete: async <T>(path: string): Promise<T> => {
            recordedCalls.push({ method: "DELETE", path });
            return undefined as T;
        },
    };

    const manager = new ApplicationCommandManager(
        mockRest as any,
        "123456789012345678",
    );

    test("Global application commands CRUD", async () => {
        const list = await manager.fetch();
        expect(list).toHaveLength(1);

        const created = await manager.create({
            name: "hello",
            description: "says hello",
        });
        expect(created.name).toBe("hello");

        const overwritten = await manager.set([
            { name: "all", description: "all commands" },
        ]);
        expect(overwritten).toHaveLength(1);

        const edited = await manager.edit("123456789012345671", {
            name: "updated",
        });
        expect(edited.name).toBe("updated");

        await manager.delete("123456789012345671");
    });

    test("Guild-scoped application commands CRUD", async () => {
        const guildId = "987654321098765432";
        const guildList = await manager.fetchGuild(guildId);
        expect(guildList).toHaveLength(1);

        const guildCreated = await manager.createGuild(guildId, {
            name: "guild_cmd",
            description: "guild only",
        });
        expect(guildCreated.name).toBe("guild_cmd");

        const guildOverwritten = await manager.setGuild(guildId, [
            { name: "g_bulk", description: "bulk" },
        ]);
        expect(guildOverwritten).toHaveLength(1);

        const guildEdited = await manager.editGuild(
            guildId,
            "123456789012345671",
            {
                name: "updated",
            },
        );
        expect(guildEdited.name).toBe("updated");

        await manager.deleteGuild(guildId, "123456789012345671");
    });
});
