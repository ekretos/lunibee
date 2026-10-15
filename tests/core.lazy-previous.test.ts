import { describe, expect, test } from "bun:test";
import { Client, ClientEvent } from "../packages/core/src/index.ts";

const G = "100000000000000001";

describe("previous state is copied only for listeners", () => {
    test("listenerCount follows on, once and off", () => {
        const client = new Client({ token: "a.b", intents: [] });
        const listener = () => {};
        expect(client.listenerCount(ClientEvent.GuildUpdate)).toBe(0);
        client.on(ClientEvent.GuildUpdate, listener);
        client.once(ClientEvent.GuildUpdate, () => {});
        expect(client.listenerCount(ClientEvent.GuildUpdate)).toBe(2);
        client.off(ClientEvent.GuildUpdate, listener);
        expect(client.listenerCount(ClientEvent.GuildUpdate)).toBe(1);
        client.removeAllListeners();
        expect(client.listenerCount(ClientEvent.GuildUpdate)).toBe(0);
        client.destroy();
    });

    test("an update without listeners still updates the cache; a later listener gets an exact previous copy", () => {
        const client = new Client({ token: "a.b", intents: [] });
        const gateway = client.gateway as unknown as {
            emit(event: string, data: unknown): void;
        };
        gateway.emit("GUILD_CREATE", {
            id: G,
            name: "one",
            roles: [{ id: "200000000000000001", name: "r1", permissions: "0" }],
            channels: [
                { id: "300000000000000001", type: 0, name: "c1", guild_id: G },
            ],
        });
        gateway.emit("GUILD_UPDATE", { id: G, name: "two" });
        expect(client.guilds.get(G)!.name).toBe("two");

        const seen: unknown[] = [];
        client.on(
            ClientEvent.GuildUpdate,
            (_data, previous) => void seen.push(previous),
        );
        client.on(
            ClientEvent.ChannelUpdate,
            (_c, previous) => void seen.push(previous),
        );
        client.on(
            ClientEvent.GuildRoleUpdate,
            (_e, previous) => void seen.push(previous),
        );
        const cached = client.guilds.get(G)!;
        gateway.emit("GUILD_UPDATE", { id: G, name: "three" });
        gateway.emit("CHANNEL_UPDATE", {
            id: "300000000000000001",
            type: 0,
            name: "c2",
            guild_id: G,
        });
        gateway.emit("GUILD_ROLE_UPDATE", {
            guild_id: G,
            role: { id: "200000000000000001", name: "r2", permissions: "0" },
        });
        const [guild, channel, role] = seen as Array<Record<string, unknown>>;
        expect(guild).toMatchObject({ id: G, name: "two" });
        expect(guild).not.toBe(cached);
        expect(Object.getPrototypeOf(guild)).toBe(
            Object.getPrototypeOf(cached),
        );
        expect(channel).toMatchObject({ name: "c1" });
        expect(role).toMatchObject({ name: "r1" });
        // The cached instance is updated in place.
        expect(client.guilds.get(G)).toBe(cached);
        expect(cached.name).toBe("three");
        client.destroy();
    });
});
