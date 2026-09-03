import { describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";

describe("Client Events & Dispatch Full Coverage", () => {
    test("Client handles Gateway lifecycle and dispatch events", async () => {
        const client = new Client({
            token: "test_token",
            intents: 513,
        });

        const received: string[] = [];

        client.on("ready", () => received.push("ready"));
        client.on("open", () => received.push("open"));
        client.on("close", () => received.push("close"));
        client.on("messageCreate", () => received.push("messageCreate"));
        client.on("messageUpdate", () => received.push("messageUpdate"));
        client.on("messageDelete", () => received.push("messageDelete"));
        client.on("messageDeleteBulk", () =>
            received.push("messageDeleteBulk"),
        );
        client.on("guildCreate", () => received.push("guildCreate"));
        client.on("guildUpdate", () => received.push("guildUpdate"));
        client.on("guildDelete", () => received.push("guildDelete"));
        client.on("channelCreate", () => received.push("channelCreate"));
        client.on("channelUpdate", () => received.push("channelUpdate"));
        client.on("channelDelete", () => received.push("channelDelete"));
        client.on("interactionCreate", () =>
            received.push("interactionCreate"),
        );

        const gw = client.ws;

        gw.emit("READY", { user: { id: "100", username: "BotUser" } });
        expect(client.isReady()).toBe(true);
        expect(
            typeof client.uptime === "number" || client.uptime === null,
        ).toBe(true);
        expect(client.user?.id).toBe("100");

        gw.emit("open");
        gw.emit("MESSAGE_CREATE", {
            id: "200",
            channel_id: "300",
            content: "hello",
            author: { id: "400", username: "User" },
        });
        gw.emit("MESSAGE_UPDATE", {
            id: "200",
            channel_id: "300",
            content: "edited",
            author: { id: "400", username: "User" },
        });
        gw.emit("MESSAGE_DELETE", { id: "200", channel_id: "300" });
        gw.emit("MESSAGE_DELETE_BULK", { ids: ["200"], channel_id: "300" });

        gw.emit("GUILD_CREATE", {
            id: "500",
            name: "Guild1",
            members: [{ user: { id: "600", username: "M1" } }],
            channels: [{ id: "300", name: "general", type: 0 }],
        });
        gw.emit("GUILD_UPDATE", { id: "500", name: "Guild1Updated" });
        gw.emit("GUILD_DELETE", { id: "500", unavailable: false });

        gw.emit("CHANNEL_CREATE", { id: "700", name: "new-channel", type: 0 });
        gw.emit("CHANNEL_UPDATE", {
            id: "700",
            name: "renamed-channel",
            type: 0,
        });
        gw.emit("CHANNEL_DELETE", {
            id: "700",
            name: "renamed-channel",
            type: 0,
        });

        gw.emit("INTERACTION_CREATE", {
            id: "800",
            application_id: "900",
            type: 2,
            token: "tok",
            version: 1,
            data: { id: "cmd", name: "test" },
        });
        gw.emit("close", { code: 1000, action: "closed" });

        expect(received).toContain("ready");
        expect(received).toContain("open");
        expect(received).toContain("messageCreate");
        expect(received).toContain("messageUpdate");
        expect(received).toContain("messageDelete");
        expect(received).toContain("messageDeleteBulk");
        expect(received).toContain("guildCreate");
        expect(received).toContain("guildUpdate");
        expect(received).toContain("guildDelete");
        expect(received).toContain("channelCreate");
        expect(received).toContain("channelUpdate");
        expect(received).toContain("channelDelete");
        expect(received).toContain("interactionCreate");
        expect(received).toContain("close");

        client.destroy();
        expect(client.state).toBe("destroyed");
    });
});
