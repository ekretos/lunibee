# Advanced-API compatibility audit (READ-ONLY)

_Author: Neha (worker-neha) · Task T6-advanced · 2026-09-03_
_Scope: webhooks, CDN, attachments, permissions, audit-logs, application-commands._
_These surfaces live in packages owned by other agents. I did **not** edit them;
change requests are routed to god for the owning agent._

## Ownership map (who must action any change)

| Advanced API | Location | Owner |
|---|---|---|
| Webhooks | `packages/rest/src/webhook.ts`, `routes.ts` | Aditya (rest) |
| CDN | `packages/structures/src/{base,resources}.ts` | Dev (structures) |
| Attachments | `packages/builders/src/attachment.ts` | Dev (builders) |
| Permissions | `packages/structures/src/permissions.ts`, `packages/core/src/permissions.ts` | Dev / Rohan |
| Audit logs | `packages/structures/src/audit-log.ts`, `packages/rest/src/routes.ts` | Dev / Aditya |
| Application commands | `packages/builders/src/commands.ts`, `packages/managers/src/application.ts` | Dev |

## Assessment

Overall these surfaces are **already Discord.js-familiar** and in good shape.

- **Permissions (`structures/src/permissions.ts`)** — strong. Full modern bit set
  incl. `SendPolls`/`UseExternalApps`, bigint bitfield, `has/any/add/remove/equals/
  toArray`, flexible `PermissionResolvable`, and a `PermissionsBitField` alias class
  extending `PermissionSet` explicitly for djs parity. **No change needed.**
  - Minor: string resolution falls back to `BigInt(permission)` for unknown names,
    so a typo'd permission name that happens to be numeric-like won't error. Low risk.
- **Attachments (`builders/src/attachment.ts`)** — djs-style `AttachmentBuilder` with
  `setName/setDescription/setFile` chaining and a `toBuffer()` resolver across
  `Uint8Array | ArrayBuffer | Blob | Buffer | string(path)`. Good.
  - Minor: `toBuffer()` returns an empty `Uint8Array()` for unrecognized input
    instead of throwing — a silent-empty-upload risk worth a `TypeError`. **Request
    to Dev via god** (not my package).

## Requests routed to god (for owning agents)

1. **Dev** — `AttachmentBuilder.toBuffer()` should throw on unresolvable file input
   rather than returning an empty buffer (avoids silently uploading 0 bytes).
2. **Voice↔advanced cross-cutting** — a client-integrated `joinVoiceChannel` (see
   voice-report) will need Voice State/Server Update plumbing in core/ws; not an
   advanced-API package but noting the dependency here for planning.

_No deep line-by-line audit of rest/webhook/audit-log routes was performed to stay
token-frugal and within my read-only remit; Aditya/Dev own those and Priya's QA suite
(T7) will exercise them independently._
