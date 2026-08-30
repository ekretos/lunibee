import { describe, expect, test } from "bun:test";
import {
  PermissionSet,
  PermissionsBitField,
  Permission,
  Permissions,
  PermissionFlagsBits,
  PermissionOverwriteType,
} from "../packages/core/src/permissions.ts";

describe("Permissions Full Coverage", () => {
  test("all direct boolean getters on PermissionSet", () => {
    // Enable all permissions
    let allBits = 0n;
    for (const bit of Object.values(Permission)) allBits |= bit;

    const set = new PermissionSet(allBits);
    expect(set.createInstantInvite).toBe(true);
    expect(set.kickMembers).toBe(true);
    expect(set.banMembers).toBe(true);
    expect(set.administrator).toBe(true);
    expect(set.manageChannels).toBe(true);
    expect(set.manageGuild).toBe(true);
    expect(set.addReactions).toBe(true);
    expect(set.viewAuditLog).toBe(true);
    expect(set.prioritySpeaker).toBe(true);
    expect(set.stream).toBe(true);
    expect(set.viewChannel).toBe(true);
    expect(set.sendMessages).toBe(true);
    expect(set.sendTTSMessages).toBe(true);
    expect(set.manageMessages).toBe(true);
    expect(set.embedLinks).toBe(true);
    expect(set.attachFiles).toBe(true);
    expect(set.readMessageHistory).toBe(true);
    expect(set.mentionEveryone).toBe(true);
    expect(set.useExternalEmojis).toBe(true);
    expect(set.viewGuildInsights).toBe(true);
    expect(set.connect).toBe(true);
    expect(set.speak).toBe(true);
    expect(set.muteMembers).toBe(true);
    expect(set.deafenMembers).toBe(true);
    expect(set.moveMembers).toBe(true);
    expect(set.useVAD).toBe(true);
    expect(set.changeNickname).toBe(true);
    expect(set.manageNicknames).toBe(true);
    expect(set.manageRoles).toBe(true);
    expect(set.manageWebhooks).toBe(true);
    expect(set.manageGuildExpressions).toBe(true);
    expect(set.useApplicationCommands).toBe(true);
    expect(set.requestToSpeak).toBe(true);
    expect(set.manageEvents).toBe(true);
    expect(set.manageThreads).toBe(true);
    expect(set.createPublicThreads).toBe(true);
    expect(set.createPrivateThreads).toBe(true);
    expect(set.useExternalStickers).toBe(true);
    expect(set.sendMessagesInThreads).toBe(true);
    expect(set.useEmbeddedActivities).toBe(true);
    expect(set.moderateMembers).toBe(true);
    expect(set.viewCreatorMonetizationAnalytics).toBe(true);
    expect(set.useSoundboard).toBe(true);
    expect(set.createGuildExpressions).toBe(true);
    expect(set.createEvents).toBe(true);
    expect(set.useExternalSounds).toBe(true);
    expect(set.sendVoiceMessages).toBe(true);
    expect(set.sendPolls).toBe(true);
    expect(set.useExternalApps).toBe(true);
  });

  test("bitfield operations and immutability", () => {
    const base = new PermissionSet(Permission.sendMessages);
    const added = base.add(
      Permission.embedLinks,
      "attachFiles",
      PermissionFlagsBits.BanMembers,
    );
    expect(
      added.has(
        Permission.sendMessages,
        Permission.embedLinks,
        Permission.attachFiles,
        Permission.banMembers,
      ),
    ).toBe(true);
    expect(added.any("sendMessages", "kickMembers")).toBe(true);

    const removed = added.remove(Permission.sendMessages);
    expect(removed.has("sendMessages")).toBe(false);
    expect(removed.equals(added)).toBe(false);
    expect(removed.equals(removed.bitfield)).toBe(true);
    expect(typeof removed.toString()).toBe("string");
    expect(Array.isArray(removed.toArray())).toBe(true);

    const bf = new PermissionsBitField(8n);
    expect(bf.administrator).toBe(true);
    expect(PermissionsBitField.Flags.Administrator).toBe(
      PermissionFlagsBits.Administrator,
    );
    expect(PermissionsBitField.All.administrator).toBe(1n << 3n);
    expect(PermissionOverwriteType.Role).toBe(0);
    expect(PermissionOverwriteType.Member).toBe(1);

    expect(() => new PermissionSet(-1n)).toThrow();
    expect(() => new PermissionSet("invalid" as any)).toThrow();
  });
});
