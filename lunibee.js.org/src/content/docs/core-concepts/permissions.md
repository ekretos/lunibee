---
title: "Permissions & Bitfields"
description: Complete guide for Discord permissions, bitwise calculations, and camelCase getters in Lunibee.
---

Lunibee provides simple permission checks for everyday bot code while still exposing immutable permission sets when you need more control.

## Check a permission

```ts
if (member.permissions.administrator) {
  console.log("Member is an administrator.");
}

if (member.permissions.manageMessages) {
  console.log("Member can manage messages.");
}
```

## Check multiple permissions

Use `.has()` when **all** permissions are required:

```ts
import { Permission } from "lunibee";

if (member.permissions.has(
  Permission.kickMembers,
  Permission.banMembers,
)) {
  console.log("Member can kick and ban.");
}
```

Use `.any()` when at least one permission is enough:

```ts
if (member.permissions.any(
  Permission.kickMembers,
  Permission.banMembers,
)) {
  console.log("Member can perform at least one moderation action.");
}
```

## Build a permission set

`PermissionSet` is immutable. Methods return a new set instead of changing the original.

```ts
import { PermissionSet, Permission } from "lunibee";

const base = new PermissionSet([
  Permission.viewChannel,
  Permission.sendMessages,
]);

const elevated = base.add(
  Permission.embedLinks,
  Permission.attachFiles,
);

const restricted = elevated.remove(Permission.sendMessages);
```

## Inspect permissions

```ts
console.log(elevated.viewChannel);      // true
console.log(elevated.sendMessages);     // true
console.log(restricted.sendMessages);   // false
console.log(elevated.toArray());
```

## Permission constants

Use Lunibee's `Permission` constants instead of manually calculating Discord permission bits:

```ts
Permission.viewChannel
Permission.sendMessages
Permission.manageChannels
Permission.manageMessages
Permission.manageRoles
Permission.administrator
```

This keeps permission logic readable and avoids duplicating bit-shift calculations throughout your application.

## Common permissions

| Getter | Meaning |
|---|---|
| `.viewChannel` | View a channel |
| `.sendMessages` | Send messages |
| `.manageMessages` | Manage messages |
| `.manageChannels` | Manage channels |
| `.manageRoles` | Manage roles |
| `.kickMembers` | Kick members |
| `.banMembers` | Ban members |
| `.moderateMembers` | Timeout/moderate members |
| `.connect` | Connect to voice |
| `.speak` | Speak in voice |
| `.administrator` | Full administrator permission |

Lunibee exposes the complete Discord permission set through the same camelCase style. Use autocomplete on `Permission` or `member.permissions` when you need a less common flag.
