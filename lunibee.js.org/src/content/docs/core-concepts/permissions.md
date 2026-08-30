---
title: Permissions
description: Bitfield-based permission resolution and checks.
---

# Permissions

Discord represents user, member, and role permissions as 64-bit integer bitfields. `@lunibee/structures` and `@lunibee/core` provide `PermissionsBitField` for expressive, type-safe permission checks.

## Checking Permissions

```ts
// Check a single permission
if (member.permissions.has("ManageMessages")) {
  console.log("Member can manage messages!");
}

// Check multiple permissions simultaneously
if (member.permissions.has(["BanMembers", "KickMembers"])) {
  console.log("Member has moderation permissions.");
}

// Check administrator bypass
if (member.permissions.has("Administrator")) {
  console.log("Member is an admin.");
}
```

## Immutable BitField Manipulation

`PermissionsBitField` operations are immutable and return fresh instances:

```ts
import { PermissionsBitField } from "lunibee";

const basePermissions = new PermissionsBitField(["ViewChannel", "SendMessages"]);

// Add permissions
const elevated = basePermissions.add("EmbedLinks", "AttachFiles");

// Remove permissions
const restricted = elevated.remove("SendMessages");

// Check difference
console.log(elevated.has("EmbedLinks")); // true
console.log(restricted.has("SendMessages")); // false
```
