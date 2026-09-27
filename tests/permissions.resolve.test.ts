import { describe, expect, test } from "bun:test";
import {
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
