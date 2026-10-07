import { describe, expect, test } from "bun:test";
import * as lunibee from "../packages/lunibee/src/index.ts";

describe("the lunibee entry point", () => {
    test("exports the 0.3.0 workflow", () => {
        const bot = new lunibee.Client({ token: "a.b", intents: 0 });
        expect(typeof bot.guild("1").peek).toBe("function");
        expect(typeof bot.api.guilds).toBe("function");
        expect(typeof lunibee.command).toBe("function");
        expect(typeof lunibee.option.user).toBe("function");
        expect(lunibee.ChannelKinds.text).toEqual([0]);
        expect(lunibee.channelKindOf(2)).toBe("voice");
        expect(lunibee.channelTypesOf("thread")).toEqual([10, 11, 12]);
    });

    test("exports the 0.3.0 resources", () => {
        for (const name of [
            "ShardSupervisor",
            "IpcTransport",
            "BroadcastChannelTransport",
            "fetchGatewayBot",
            "ApplicationEmojiManager",
            "AuditLog",
            "Sticker",
            "stickerURL",
        ])
            expect(typeof (lunibee as Record<string, unknown>)[name]).toBe(
                "function",
            );
    });

    test("no longer exports the 0.2.x aliases", () => {
        const exports = lunibee as Record<string, unknown>;
        for (const name of ["ButtonBuilder", "ChannelType", "EmbedBuilder"])
            expect(exports[name]).toBeUndefined();
    });
});
