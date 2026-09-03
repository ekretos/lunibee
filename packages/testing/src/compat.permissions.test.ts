/**
 * PermissionsBitField compatibility. The class is documented as "Discord.js-compatible"
 * and exposes a static `Flags` — so it must behave like discord.js's PermissionsBitField
 * for the common patterns (has/any/add/remove, Flags.* resolution, toArray).
 */
import { describe, expect, test } from "bun:test";
import {
    PermissionsBitField,
    PermissionFlagsBits,
    Permissions,
    PermissionSet,
} from "@lunibee/core";
import * as structures from "@lunibee/structures";

describe("PermissionsBitField — core behavior", () => {
    test("has() resolves single Flags value like discord.js", () => {
        const perms = new PermissionsBitField(
            Permissions.Administrator | Permissions.BanMembers,
        );
        expect(perms.has(PermissionFlagsBits.Administrator)).toBe(true);
        expect(perms.has(PermissionFlagsBits.BanMembers)).toBe(true);
        expect(perms.has(PermissionFlagsBits.KickMembers)).toBe(false);
    });
    test("has() with multiple perms is an AND check", () => {
        const perms = new PermissionsBitField([
            "Administrator",
            "ManageGuild",
        ]);
        expect(perms.has("Administrator", "ManageGuild")).toBe(true);
        expect(perms.has("Administrator", "KickMembers")).toBe(false);
    });
    test("any() is an OR check", () => {
        const perms = new PermissionsBitField(Permissions.SendMessages);
        expect(perms.any("SendMessages", "Administrator")).toBe(true);
        expect(perms.any("Administrator", "BanMembers")).toBe(false);
    });
    test("add/remove return new immutable sets", () => {
        const base = new PermissionsBitField(Permissions.SendMessages);
        const more = base.add("EmbedLinks");
        expect(more).not.toBe(base);
        expect(more.has("EmbedLinks")).toBe(true);
        expect(base.has("EmbedLinks")).toBe(false);
        expect(more.remove("EmbedLinks").has("EmbedLinks")).toBe(false);
    });
    test("toArray returns held permission names", () => {
        const perms = new PermissionsBitField([
            "Administrator",
            "BanMembers",
        ]);
        const arr = perms.toArray().map((n) => n.toLowerCase());
        expect(arr).toContain("administrator");
        expect(arr).toContain("banmembers");
    });
    test("static Flags is exposed (discord.js parity)", () => {
        expect(PermissionsBitField.Flags).toBeDefined();
        expect(PermissionsBitField.Flags.Administrator).toBeDefined();
    });
    test("bitfield is a bigint", () => {
        expect(typeof new PermissionsBitField(8n).bitfield).toBe("bigint");
    });
});

describe("PermissionsBitField — discord.js divergences", () => {
    // discord.js PermissionsBitField.Flags.* are BIGINT values (8n), enabling
    // `Flags.A | Flags.B`. Lunibee's PermissionFlagsBits is a string enum ("8"),
    // so bitwise composition string-concatenates instead of OR-ing.
    test.failing("Flags values are bigints supporting bitwise OR", () => {
        expect(typeof PermissionFlagsBits.Administrator).toBe("bigint");
        const combined =
            (PermissionFlagsBits.Administrator as unknown as bigint) |
            (PermissionFlagsBits.ManageGuild as unknown as bigint);
        // Administrator(8) | ManageGuild(32) === 40n in discord.js.
        expect(combined).toBe(40n);
    });

    // discord.js re-exports PermissionsBitField from its top-level entry. Lunibee's
    // @lunibee/structures package ships a permissions module but does NOT export it
    // from the package index — only @lunibee/core does. Importers of the structures
    // package cannot reach PermissionsBitField.
    test.failing("@lunibee/structures re-exports PermissionsBitField", () => {
        expect(
            (structures as Record<string, unknown>).PermissionsBitField,
        ).toBeDefined();
    });
});

describe("PermissionSet — resolution edge cases", () => {
    test("constructing from a raw decimal string works", () => {
        expect(new PermissionSet("8").has("Administrator")).toBe(true);
    });
    test("negative bitfield is rejected", () => {
        expect(() => new PermissionSet(-1)).toThrow();
    });
});
