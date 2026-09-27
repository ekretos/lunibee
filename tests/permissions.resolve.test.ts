import { describe, expect, test } from "bun:test";
import {
    Client,
    Permission,
    PermissionOverwriteType,
    PermissionSet,
    computePermissions,
} from "../packages/core/src/index.ts";

const GUILD = "1";
const base = {
    guildId: GUILD,
    memberId: "10",
    memberRoleIds: ["2"],
    roles: [
        {
            id: GUILD,
            permissions: Permission.viewChannel | Permission.sendMessages,
        },
        { id: "2", permissions: Permission.addReactions },
    ],
};

describe("computePermissions", () => {
    test("combines @everyone and member roles", () => {
        const set = computePermissions(base);
        expect(set.has("viewChannel", "sendMessages", "addReactions")).toBe(
            true,
        );
        expect(set.missing("kickMembers", "sendMessages")).toEqual([
            "kickMembers",
        ]);
    });

    test("owner and administrator get everything", () => {
        expect(
            computePermissions({ ...base, ownerId: "10" }).has("banMembers"),
        ).toBe(true);
        const admin = computePermissions({
            ...base,
            roles: [
                ...base.roles,
                { id: "3", permissions: Permission.administrator },
            ],
            memberRoleIds: ["3"],
            overwrites: [
                { id: GUILD, type: 0, allow: 0n, deny: Permission.viewChannel },
            ],
        });
        expect(admin.has("viewChannel", "manageGuild")).toBe(true);
    });

    test("applies overwrites in @everyone, role, member order", () => {
        const set = computePermissions({
            ...base,
            overwrites: [
                {
                    id: GUILD,
                    type: PermissionOverwriteType.Role,
                    allow: 0n,
                    deny: Permission.sendMessages | Permission.viewChannel,
                },
                {
                    id: "2",
                    type: PermissionOverwriteType.Role,
                    allow: Permission.sendMessages,
                    deny: Permission.addReactions,
                },
                {
                    id: "99",
                    type: PermissionOverwriteType.Role,
                    allow: Permission.kickMembers,
                    deny: 0n,
                },
                {
                    id: "10",
                    type: PermissionOverwriteType.Member,
                    allow: Permission.viewChannel,
                    deny: 0n,
                },
            ],
        });
        expect(set.has("sendMessages", "viewChannel")).toBe(true);
        expect(set.any("addReactions", "kickMembers")).toBe(false);
        expect(new PermissionSet(0n).missing()).toEqual([]);
    });

    test("unknown roles contribute nothing", () => {
        const set = computePermissions({
            ...base,
            memberRoleIds: ["404"],
            roles: [],
        });
        expect(set.bitfield).toBe(0n);
    });
});

describe("Client.permissionsFor", () => {
    test("uses cached guild, roles, member and channel overwrites", () => {
        const client = new Client({ token: "a.b", intents: 0 });
        const gw = client.gateway as unknown as {
            emit(event: string, data: unknown): void;
        };
        const G = "200000000000000000";
        const U = "300000000000000000";
        const CH = "100000000000000000";
        expect(client.permissionsFor(U, G)).toBeNull();
        gw.emit("GUILD_CREATE", {
            id: G,
            name: "g",
            owner_id: "1",
            roles: [{ id: G, name: "@everyone", permissions: "3072" }],
            members: [
                {
                    user: { id: U, username: "u" },
                    roles: [],
                    joined_at: "2020-01-01T00:00:00Z",
                },
            ],
            channels: [
                {
                    id: CH,
                    type: 0,
                    name: "general",
                    permission_overwrites: [
                        { id: U, type: 1, allow: "0", deny: "2048" },
                    ],
                },
            ],
        });
        expect(client.permissionsFor(U, G)?.has("sendMessages")).toBe(true);
        const channel = client.permissionsFor(U, CH)!;
        expect(channel.has("viewChannel")).toBe(true);
        expect(channel.has("sendMessages")).toBe(false);
    });
});
