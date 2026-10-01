# FIX.md — Make Lunibee humane to write

Found by reading how ZedBot 0.2.0 (a discord.js → Lunibee port) uses Lunibee.
Goal: code written with Lunibee reads like intent, not like plumbing.
Scope: consistency, typing, errors and docs only. **No new concepts.**

Format and severity follow AGENT.md. Each item ships with a regression test,
a reference-page update and a changelog entry. Renames keep the old name as a
`@deprecated` alias (bottom of the defining file) until 2.0.

## Evidence (ZedBot `src/`)

| Pattern | Count | Why it happens |
|---|---|---|
| `client.rest.*(Routes.…)` | 109 | Manager/structure methods missing `reason`, inconsistent, or not discoverable |
| `.toJSON()` on builders | 162 | Payload fields typed `unknown[]`, so no autocomplete or checking |
| `as unknown as` / raw reads | 45 | Interaction payload read through `any`; `Guild` misses fields |
| `error.status === 404` checks | several | `RESTError.kind` exists but is not discovered; specific codes have no names |

## Guardrails (do not "brain rot" the API)

- One way to do each thing. A new name replaces an old one; it never adds a third.
- Every deprecated alias has a removal version (2.0).
- No custom-ID router, command framework, implicit fetching or global state in core.
- A change ships only if it removes real lines or casts from ZedBot.

---

## F1 — One verb, one argument shape

- **Severity:** P2
- **Location:** `packages/managers/src/{role,emoji,index,guild,member}.ts`, `packages/structures/src/base.ts` (`Channel`)
- **Problem:** The same action has different names and argument shapes.
  `GuildMember.kick(reason)`, `.ban({ reason })`, `.timeout(ms, reason)`;
  `RoleManager.deleteRole`, `EmojiManager.deleteEmoji`, `ChannelManager.deleteChannel`,
  `GuildManager.deleteGuild`, `BaseManager.delete`; `Channel.send` and `Channel.sendMessage`.
  `RoleManager.edit(id, { reason, … })` but `MemberManager.edit(id, options, reason)`.
  `MemberManager.unban(userId)` and `RoleManager.deleteRole(roleId)` accept no audit-log reason.
- **Impact:** Users must look up each method; missing `reason` pushes them to raw REST.
- **Fix:** `create` / `edit` / `delete` / `send` everywhere. Signature
  `verb(id, payload?, { reason }?)`, so `reason` is always the last options object.
  Old names → `@deprecated` aliases; the positional `reason` on `MemberManager.edit` still works.
- **Regression test:** Each manager: verb exists, alias forwards, `X-Audit-Log-Reason` header sent.
- **Status:** Open

## F2 — Builders accepted everywhere, with types

- **Severity:** P2
- **Location:** `packages/structures/src/interactions.ts:40` (`embeds?: unknown[]`), message/webhook payload types in `managers` and `rest`
- **Problem:** Interaction payloads type `embeds`/`components` as `unknown[]`. Builders work at
  runtime only because `JSON.stringify` calls `toJSON()`; the types neither guide nor check.
  `rest/src/webhook.ts` already types `(APIEmbed | { toJSON(): APIEmbed })[]`. The rest don't.
- **Impact:** 162 defensive `.toJSON()` calls in ZedBot; typos in payloads compile.
- **Fix:** One shared `MessagePayload` type: `embeds: (APIEmbed | CreateEmbed)[]`,
  `components: (APIActionRowComponent | CreateActionRow)[]`, used by channel send/edit,
  message reply/edit, interaction reply/edit/follow-up/update and webhooks.
- **Regression test:** Type tests (`tsc` fixture) accept a builder and a raw object, and
  reject an unknown key. A runtime test that a builder serialises to the same body.
- **Status:** Open

## F3 — Methods for the routes people call directly

- **Severity:** P2
- **Location:** `packages/managers/src`, `packages/structures/src/{base,resources}.ts`
- **Problem:** ZedBot calls `Routes` directly for routes that a method should cover: member edit (7),
  channel messages (6), role edit/delete (8), guild edit (4), channel delete (4), bans get/put/delete (7),
  pins, reactions, permission overwrites, threads from message, emoji and sticker delete.
- **Impact:** Raw route calls skip structures, the cache and typed returns.
- **Fix:** For each route, confirm a manager **and** structure method exists, takes `{ reason }`
  where Discord allows it, and returns a structure. Fill gaps only for these routes.
  Add a "`Routes.x` → method" table to the docs.
- **Regression test:** One test per method: route, method, body, reason header, returned type.
- **Status:** Open

## F4 — Type guards that narrow

- **Severity:** P2
- **Location:** `packages/structures/src/interactions.ts:631-720`, `packages/structures/src/options.ts:194-319` (17 `as any`)
- **Problem:** `ComponentInteraction.values`, `customId`, `componentType`, modal fields and resolved
  options read the payload through `any`. Guards such as `isStringSelectMenu()` do not narrow.
- **Impact:** Consumers cast (`ZedBot help.ts:152`, `Command.ts:459`); wrong reads compile.
- **Fix:** Type `data` by interaction/component kind and make guards return `this is …`.
  No runtime change.
- **Regression test:** Type tests: after the guard `values` is `string[]`; before it, accessing it fails.
  Zero `as any` left in `structures`.
- **Status:** Open

## F5 — Structures carry every field the API type has

- **Severity:** P3
- **Location:** `packages/structures/src/base.ts` (`Guild`, …)
- **Problem:** `Guild` has no `afkChannelId` / `afkTimeout` and maps only part of `APIGuild`.
- **Impact:** ZedBot casts in `backupHandler.ts:135` and `antinuke/discord.ts`.
- **Fix:** Map each `APIX` field or list it as deliberately excluded.
- **Regression test:** Per structure: every `APIX` key is either mapped or in an exclusion list.
- **Status:** Open

## F6 — Name the specific Discord error codes

- **Severity:** P3
- **Location:** `packages/rest/src/errors.ts`
- **Today:** `RESTError` already has `kind` (`"notFound"`, `"permission"`, `"rateLimited"`, …),
  `status`, the numeric `code`, `method` and `path`. ZedBot ignores `kind` and checks `status === 404`.
- **Problem:** `kind` cannot tell Unknown Message from Unknown Channel; `code` is a bare number.
- **Fix:** Export Discord's JSON error codes as a `const` object `RESTErrorCode` (CLAUDE.md naming).
  Add a 50013 hint (missing permission or role hierarchy) to the message. No token or body in it.
- **Regression test:** Code names round-trip; the message has no secrets; hint present for 50013.
- **Status:** Open

## F7 — Error listeners are not silently swallowed

- **Severity:** P3
- **Location:** `packages/core/src/index.ts:182` (`catch {}` in `#handleError`)
- **Problem:** An error thrown by an `error` listener disappears.
- **Fix:** Report it with `process.emitWarning` (no loop back into `error`).
- **Regression test:** A throwing error listener produces one warning and no recursion.
- **Status:** Open

## F8 — Keep the release files truthful

- **Severity:** P3
- **Location:** `AGENT.md` (target "v0.2.1"), `CLAUDE.md` ("next: 0.2.2"); packages are 0.2.3
- **Fix:** Update both targets; mark the 0.2.2 items in CLAUDE.md that have shipped as done.
- **Status:** Open

---

## Order

1. F1 + F2: biggest effect, mechanical, non-breaking with aliases.
2. F4, then F6.
3. F3, F5.
4. F7, F8.

Done when ZedBot can drop its `.toJSON()` calls, the Lunibee-related casts and the direct
`Routes` calls listed above without adding new ones.
