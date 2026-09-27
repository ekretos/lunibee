import { describe, expect, test } from "bun:test";
import {
    createInteraction,
    type InteractionClient,
} from "../packages/structures/src/index.ts";
import { Client } from "../packages/core/src/index.ts";

const ID = "1100000000000000000";
const APP = "1200000000000000000";
const GUILD = "1300000000000000000";
const USER = { id: "1400000000000000000", username: "u" };

function mockClient(withWebhook = true) {
    const calls: unknown[][] = [];
    let release: () => void = () => {};
    const client: InteractionClient = {
        postInteractionResponse: (...args) => {
            calls.push(["post", ...args]);
            return new Promise((resolve) => (release = () => resolve({})));
        },
        editInteractionReply: async (...args) => calls.push(["edit", ...args]),
        deleteInteractionReply: async () => {},
        followUpInteraction: async (...args) => calls.push(["follow", ...args]),
        ...(withWebhook
            ? {
                  interactionWebhookMessage: async (...args: unknown[]) =>
                      calls.push(["webhook", ...args]),
              }
            : {}),
    };
    return { client, calls, release: () => release() };
}

const payload = (extra: Record<string, unknown> = {}) => ({
    id: ID,
    application_id: APP,
    token: "tok",
    type: 2,
    data: { name: "ping" },
    ...extra,
});

describe("Interaction lifecycle", () => {
    test("concurrent acknowledgements send only once", async () => {
        const { client, calls, release } = mockClient();
        const interaction = createInteraction(client, payload());
        const first = interaction.reply("a");
        await expect(interaction.deferReply()).rejects.toThrow(
            "already been acknowledged",
        );
        release();
        await first;
        expect(interaction.replied).toBe(true);
        expect(calls.filter((c) => c[0] === "post")).toHaveLength(1);
    });

    test("a failed acknowledgement can be retried", async () => {
        let fail = true;
        const client: InteractionClient = {
            postInteractionResponse: async () => {
                if (fail) throw new Error("boom");
                return {};
            },
            editInteractionReply: async () => ({}),
            deleteInteractionReply: async () => {},
            followUpInteraction: async () => ({}),
        };
        const interaction = createInteraction(client, payload());
        await expect(interaction.reply("a")).rejects.toThrow("boom");
        fail = false;
        await interaction.reply("a");
        expect(interaction.replied).toBe(true);
    });

    test("ephemeral maps to flags on follow-ups and edits", async () => {
        const { client, calls } = mockClient();
        const interaction = createInteraction(client, payload());
        await interaction.followUp({ content: "x", ephemeral: true });
        await interaction.editFollowUp(ID, { content: "y", ephemeral: true });
        await interaction.deleteFollowUp(ID);
        expect(calls[0]).toEqual([
            "follow",
            "tok",
            { content: "x", flags: 64 },
        ]);
        expect(calls[1]).toEqual([
            "webhook",
            "PATCH",
            APP,
            "tok",
            ID,
            { content: "y", flags: 64 },
        ]);
        expect(calls[2]?.slice(0, 5)).toEqual([
            "webhook",
            "DELETE",
            APP,
            "tok",
            ID,
        ]);
    });

    test("fetchReply requires acknowledgement and webhook support", async () => {
        const { client, calls, release } = mockClient();
        const interaction = createInteraction(client, payload());
        expect(() => interaction.fetchReply()).toThrow("not been acknowledged");
        const acknowledging = interaction.deferReply(true);
        release();
        await acknowledging;
        await interaction.fetchReply();
        expect(calls.at(-1)?.slice(0, 5)).toEqual([
            "webhook",
            "GET",
            APP,
            "tok",
            "@original",
        ]);
        const bare = createInteraction(mockClient(false).client, payload());
        await expect(bare.editFollowUp(ID, "x")).rejects.toThrow(
            "does not support",
        );
    });

    test("user, member and token expiry", () => {
        const { client } = mockClient();
        const guild = createInteraction(
            client,
            payload({ guild_id: GUILD, member: { user: USER, roles: [] } }),
        );
        expect(guild.user?.id).toBe(USER.id);
        expect(guild.member?.guildId).toBe(GUILD);
        const dm = createInteraction(client, payload({ user: USER }));
        expect(dm.user?.id).toBe(USER.id);
        expect(dm.member).toBeNull();
        expect(createInteraction(client, payload()).user).toBeNull();
        expect(guild.expiresAt.getTime() - guild.createdTimestamp).toBe(
            15 * 60_000,
        );
        expect(guild.isExpired).toBe(true);
    });
});

describe("Client.interactionWebhookMessage", () => {
    test("routes original and follow-up messages", async () => {
        const client = new Client({ token: "a.b", intents: 0 });
        const seen: string[] = [];
        const rest = client.rest as unknown as Record<string, unknown>;
        for (const method of ["get", "patch", "delete"])
            rest[method] = async (path: string) =>
                seen.push(`${method} ${path}`);
        await client.interactionWebhookMessage("GET", APP, "tok", "@original");
        await client.interactionWebhookMessage("PATCH", APP, "tok", ID, {});
        await client.interactionWebhookMessage("DELETE", APP, "tok", ID);
        expect(seen).toEqual([
            `get /webhooks/${APP}/tok/messages/@original`,
            `patch /webhooks/${APP}/tok/messages/${ID}`,
            `delete /webhooks/${APP}/tok/messages/${ID}`,
        ]);
    });
});
