---
title: Permissions
description: Ergonomic permission checks, direct boolean properties, and multi-permission resolution in Lunibee.
---


Discord represents user, member, and role permissions as 64-bit integer bitfields. Lunibee offers two powerful and ergonomic ways to check and manipulate permissions:

---

## 1. Direct Boolean Properties (Zero Boilerplate)

Every `PermissionSet` in Lunibee provides camelCase boolean getters. You can check permissions directly without calling methods or importing constants:

```ts
// Single permission checks:
if (member.permissions.kickMembers) {
  console.log("Member can kick members!");
}

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
