---
title: Permissions
description: Bitfield-based permission resolution, PermissionFlagsBits enum, and check utilities.
---

# Permissions

Discord represents user, member, and role permissions as 64-bit integer bitfields. Lunibee exposes `PermissionFlagsBits` (enum) and the immutable `PermissionsBitField` / `PermissionSet` for expressive, type-safe permission checks.

## Checking Permissions with Enums

You can check permissions using `PermissionFlagsBits` enum values, BigInt constants, or string keys:

```ts
import { PermissionFlagsBits } from "lunibee";

// Check a single permission using enum
if (member.permissions.has(PermissionFlagsBits.ManageMessages)) {
  console.log("Member can manage messages!");
}

// Check multiple permissions simultaneously
if (
  member.permissions.has(
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.KickMembers
  )
) {
  console.log("Member has moderation permissions.");
}

// Check administrator permissions
if (member.permissions.has(PermissionFlagsBits.Administrator)) {
  console.log("Member is an administrator.");
}
```

## Immutable BitField Manipulation

`PermissionsBitField` operations are immutable and return fresh instances:

```ts
import { PermissionsBitField, PermissionFlagsBits } from "lunibee";

const basePermissions = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
]);

// Add permissions
const elevated = basePermissions.add(
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles
);

// Remove permissions
const restricted = elevated.remove(PermissionFlagsBits.SendMessages);

// Inspect permissions
console.log(elevated.has(PermissionFlagsBits.EmbedLinks)); // true
console.log(restricted.has(PermissionFlagsBits.SendMessages)); // false
console.log(elevated.toArray()); // Array of enabled permission names
```

## Permission Overwrite Types

Channel permission overwrites use `PermissionOverwriteType`:

```ts
import { PermissionOverwriteType } from "lunibee";

const roleOverwriteType = PermissionOverwriteType.Role; // 0
const memberOverwriteType = PermissionOverwriteType.Member; // 1
```
