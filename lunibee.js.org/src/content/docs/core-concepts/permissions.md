---
title: "Permissions & Bitfields"
description: Complete guide for Discord permissions, bitwise calculations, and camelCase getters in Lunibee.
---

# Permissions & Bitfields

Lunibee provides dual-approach permission checking:
1. **Bitwise Bitfields** (`PermissionsBitField` and `PermissionFlagsBits`) for raw bitwise math and serialized Discord API strings.
2. **Direct Boolean Getters** on `member.permissions` (e.g. `member.permissions.administrator`, `member.permissions.kickMembers`).

---

## `PermissionsBitField`

```ts
import { PermissionsBitField, PermissionFlagsBits } from "lunibee";

// Instantiate from BigInt, number, string, array, or another bitfield
const perms = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
]);

// Check permissions
if (perms.has(PermissionFlagsBits.Administrator)) {
  console.log("User is an Administrator!");
}

// Check multiple permissions
if (perms.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
  console.log("User can send messages and embed links.");
}

// Check if user has ANY of the specified permissions
if (perms.any([PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers])) {
  console.log("User can moderate members.");
}

// Add / remove permissions (immutable bitwise operations)
const updated = perms.add(PermissionFlagsBits.AttachFiles).remove(PermissionFlagsBits.SendMessages);

// Convert to array of permission names
const names = perms.toArray(); // ["ViewChannel", "SendMessages", "EmbedLinks"]
```

---

## Direct CamelCase Boolean Getters

All `PermissionSet` and `GuildMember.permissions` instances provide instant boolean property getters:

```ts
if (member.permissions.administrator) {
  // User has full administrator access
}

if (member.permissions.kickMembers && member.permissions.banMembers) {
  // User can both kick and ban
}

if (member.permissions.manageMessages) {
  // User can delete other users' messages
}
```

### Supported Permission Flags

| Property Getter | Permission Flag Bit |
|---|---|
| `.createInstantInvite` | `CreateInstantInvite` |
| `.kickMembers` | `KickMembers` |
| `.banMembers` | `BanMembers` |
| `.administrator` | `Administrator` |
| `.manageChannels` | `ManageChannels` |
| `.manageGuild` | `ManageGuild` |
| `.addReactions` | `AddReactions` |
| `.viewAuditLog` | `ViewAuditLog` |
| `.prioritySpeaker` | `PrioritySpeaker` |
| `.stream` | `Stream` |
| `.viewChannel` | `ViewChannel` |
| `.sendMessages` | `SendMessages` |
| `.sendTTSMessages` | `SendTTSMessages` |
| `.manageMessages` | `ManageMessages` |
| `.embedLinks` | `EmbedLinks` |
| `.attachFiles` | `AttachFiles` |
| `.readMessageHistory` | `ReadMessageHistory` |
| `.mentionEveryone` | `MentionEveryone` |
| `.useExternalEmojis` | `UseExternalEmojis` |
| `.viewGuildInsights` | `ViewGuildInsights` |
| `.connect` | `Connect` |
| `.speak` | `Speak` |
| `.muteMembers` | `MuteMembers` |
| `.deafenMembers` | `DeafenMembers` |
| `.moveMembers` | `MoveMembers` |
| `.useVAD` | `UseVAD` |
| `.changeNickname` | `ChangeNickname` |
| `.manageNicknames` | `ManageNicknames` |
| `.manageRoles` | `ManageRoles` |
| `.manageWebhooks` | `ManageWebhooks` |
| `.manageGuildExpressions` | `ManageGuildExpressions` |
| `.useApplicationCommands` | `UseApplicationCommands` |
| `.requestToSpeak` | `RequestToSpeak` |
| `.manageEvents` | `ManageEvents` |
| `.manageThreads` | `ManageThreads` |
| `.createPublicThreads` | `CreatePublicThreads` |
| `.createPrivateThreads` | `CreatePrivateThreads` |
| `.useExternalStickers` | `UseExternalStickers` |
| `.sendMessagesInThreads` | `SendMessagesInThreads` |
| `.useEmbeddedActivities` | `UseEmbeddedActivities` |
| `.moderateMembers` | `ModerateMembers` |
| `.viewCreatorMonetizationAnalytics` | `ViewCreatorMonetizationAnalytics` |
| `.useSoundboard` | `UseSoundboard` |
| `.useExternalSounds` | `UseExternalSounds` |
| `.sendVoiceMessages` | `SendVoiceMessages` |
