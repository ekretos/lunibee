import { describe, expect, test } from "bun:test";
import { Client, IntentBits, GatewayIntentBits, resolveGatewayIntents } from "../packages/core/src/index.ts";

describe("Client lifecycle & Intents", () => {
  test("starts idle and exposes readiness state", () => {
    const client = new Client({ token: "test-token", intents: 1 });
    expect(client.state).toBe("idle");
    expect(client.isReady()).toBe(false);
    client.destroy();
    expect(client.state).toBe("destroyed");
    expect(client.isReady()).toBe(false);
    client.destroy();
    expect(client.state).toBe("destroyed");
  });

  test("rejects login after destruction", async () => {
    const client = new Client({ token: "test-token", intents: 1 });
    client.destroy();
    await expect(client.login()).rejects.toThrow("destroyed client");
  });

  test("supports intents as array of IntentBits and GatewayIntentBits", () => {
    const intentsArray = [
      IntentBits.guild,
      IntentBits.guildMessages,
      IntentBits.messageContent,
    ];
    const resolved = resolveGatewayIntents(intentsArray);
    expect(resolved).toBe(
      GatewayIntentBits.Guilds |
      GatewayIntentBits.GuildMessages |
      GatewayIntentBits.MessageContent
    );

    const client = new Client({
      token: "test-token",
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    expect(client.state).toBe("idle");
    client.destroy();
  });

  test("supports intents as string array", () => {
    const resolved = resolveGatewayIntents(["guilds", "guildMessages", "messageContent"]);
    expect(resolved).toBe(
      GatewayIntentBits.Guilds |
      GatewayIntentBits.GuildMessages |
      GatewayIntentBits.MessageContent
    );
  });
});
