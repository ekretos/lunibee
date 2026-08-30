import { describe, expect, test } from "bun:test";
import { Client } from "../packages/core/src/index.ts";

describe("Client lifecycle", () => {
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
});
