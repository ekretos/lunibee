---
title: "Permissions & Bitfields"
description: Complete guide for Discord permissions, bitwise calculations, and camelCase getters in Lunibee.
---


Lunibee provides dual-approach permission checking:
1. **Bitwise Bitfields** (`PermissionsBitField` and `PermissionFlagsBits`) for raw bitwise math and serialized Discord API strings.
2. **Direct Boolean Getters** on `member.permissions` (e.g. `member.permissions.administrator`, `member.permissions.kickMembers`).

---

## `PermissionsBitField`

```ts
import { PermissionsBitField, PermissionFlagsBits } from "lunibee";

if (member.permissions.administrator) {
  console.log("Member is a server administrator.");
}

// Property destructuring:
const { administrator, kickMembers, banMembers } = member.permissions;
if (administrator || (kickMembers && banMembers)) {
  console.log("Authorized for moderation action.");
}
```

---

## 2. Multi-Permission Checks (`has` vs `any`)

When evaluating multiple permissions, Lunibee provides `.has()` for **ALL** checks and `.any()` for **ANY** checks:

### Check if member has ALL permissions (AND)
Pass multiple arguments to verify that **every** permission is present:

```ts
import { Permission } from "lunibee";
// 1. Using clean Permission constants:
if (member.permissions.has(Permission.kickMembers, Permission.banMembers)) {
  console.log("Member has BOTH kick AND ban permissions.");
}
// 2. Using string names:
if (member.permissions.has("kickMembers", "banMembers")) {
  console.log("Member has both permissions.");
}
```

### Check if member has AT LEAST ONE permission (OR)
Use `.any()` to check if **at least one** of the specified permissions is enabled:

```ts
import { Permission } from "lunibee";
// Returns true if the member has either Kick OR Ban:
if (member.permissions.any(Permission.kickMembers, Permission.banMembers)) {
  console.log("Member can either kick or ban.");
}
```

---

## 3. Immutable BitField Manipulation

`PermissionSet` operations are completely immutable:

```ts
import { PermissionSet, Permission } from "lunibee";
const basePermissions = new PermissionSet([
  Permission.viewChannel,
  Permission.sendMessages,
]);
// Add permissions
const elevated = basePermissions.add(Permission.embedLinks, Permission.attachFiles);
// Remove permissions
const restricted = elevated.remove(Permission.sendMessages);
// Inspect results
console.log(elevated.embedLinks); // true
console.log(restricted.sendMessages); // false
console.log(elevated.toArray()); // ['viewChannel', 'sendMessages', 'embedLinks', 'attachFiles']
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
