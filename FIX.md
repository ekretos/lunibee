# FIX.md — Make Lunibee humane to write

Found by reading how ZedBot 0.2.0 (a discord.js → Lunibee port) uses Lunibee.
Goal: code written with Lunibee reads like intent, not like plumbing.
Scope: consistency, typing, errors and docs only. **No new concepts.**

Format and severity follow AGENT.md. Each item ships with a regression test,
a reference-page update and a changelog entry. Renames keep the old name as a
`@deprecated` alias (bottom of the defining file) until 0.3.0.

## Evidence (ZedBot `src/`)

| Pattern | Count | Why it happens |
|---|---|---|
| `client.rest.*(Routes.…)` | 109 | Manager/structure methods missing `reason`, inconsistent, or not discoverable |
| `.toJSON()` on builders | 162 | Payload fields typed `unknown[]`, so no autocomplete or checking |
| `as unknown as` / raw reads | 45 | Interaction payload read through `any`; `Guild` misses fields |
| `error.status === 404` checks | several | `RESTError.kind` exists but is not discovered; specific codes have no names |

## Guardrails (do not "brain rot" the API)

- One way to do each thing. A new name replaces an old one; it never adds a third.
- Every deprecated alias has a removal version (0.3.0).
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
- **Status:** Verified (0.2.3). Rule shipped as: options object → `options.reason`, otherwise the
  last argument. The REST delete verb is `remove()`, because `delete()` already means "drop from
  the cache" on every manager. Tests: `tests/audit-reasons.test.ts`, `tests/deprecated.test.ts`.

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
- **Status:** Partly fixed (0.2.3), rest deferred to 0.3.0. `MessagePayload` and `Buildable<T>`
  ship as types users can adopt (`tests/message-payload.test.ts`). Typing the send/reply
  signatures with them broke ZedBot in 16 places (`embeds: unknown[]` payloads), so it moves to
  0.3.0 Step 1, where breaking type changes are allowed.

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
- **Status:** Verified (0.2.3). Every route listed already had a method except role positions and
  channel webhooks (`roles.setPositions()`, `channels.createWebhook()` added); reasons added to
  message delete, bulk delete, pin and unpin. Docs table on the Managers page.

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
- **Status:** Verified (0.2.3). Correction: the guards already narrowed (`this is ComponentInteraction`,
  whose `values` is `string[]`); ZedBot's casts there were unnecessary. The 17 `as any` reads are
  replaced by checked reads. Tests: `tests/interaction-data.test.ts` (also asserts no `any`).

## F5 — Structures carry every field the API type has

- **Severity:** P3
- **Location:** `packages/structures/src/base.ts` (`Guild`, …)
- **Problem:** `Guild` has no `afkChannelId` / `afkTimeout` and maps only part of `APIGuild`.
- **Impact:** ZedBot casts in `backupHandler.ts:135` and `antinuke/discord.ts`.
- **Fix:** Map each `APIX` field or list it as deliberately excluded.
- **Regression test:** Per structure: every `APIX` key is either mapped or in an exclusion list.
- **Status:** Verified for `Guild` (0.2.3), `tests/guild-fields.test.ts`. Other structures were not
  audited field by field; track separately if a consumer needs a missing field.

## F6 — Name the specific Discord error codes

- **Severity:** P3
- **Location:** `packages/rest/src/errors.ts`
- **Today:** `RESTError` already has `kind` (`"notFound"`, `"permission"`, `"rateLimited"`, …),
  `status`, the numeric `code`, `method` and `path`. ZedBot ignores `kind` and checks `status === 404`.
- **Problem:** `kind` cannot tell Unknown Message from Unknown Channel; `code` is a bare number.
- **Fix:** Export Discord's JSON error codes as a `const` object `RESTErrorCode` (CLAUDE.md naming).
  Add a 50013 hint (missing permission or role hierarchy) to the message. No token or body in it.
- **Regression test:** Code names round-trip; the message has no secrets; hint present for 50013.
- **Status:** Verified (0.2.3). `RESTErrorCode` is a curated set of 35 codes, values checked against
  Discord's official docs (discord/discord-api-docs); other codes stay numeric on `code`.
  `RESTError.hint` for 50001/50013; `message` unchanged. Tests: `tests/rest-error-codes.test.ts`.

## F7 — Error listeners are not silently swallowed

- **Severity:** P3
- **Location:** `packages/core/src/index.ts:182` (`catch {}` in `#handleError`)
- **Problem:** An error thrown by an `error` listener disappears.
- **Fix:** Report it with `process.emitWarning` (no loop back into `error`).
- **Regression test:** A throwing error listener produces one warning and no recursion.
- **Status:** Verified (0.2.3). Same failure mode also fixed for listener errors with no `error`
  listener and for rejecting async `error` listeners. Tests: `tests/listener-errors.test.ts`.

## F8 — Keep the release files truthful

- **Severity:** P3
- **Location:** `AGENT.md` (target "v0.2.1"), `CLAUDE.md` ("next: 0.2.2"); packages are 0.2.3
- **Fix:** Update both targets; mark the 0.2.2 items in CLAUDE.md that have shipped as done.
- **Status:** Verified (0.2.3). AGENT.md target v0.2.3; CLAUDE.md marks 0.2.2 shipped.

## F9 — Lunibee's source fails to compile in strict consumer projects

- **Severity:** P2
- **Location:** `builders/commands.ts`, `core/index.ts`, `managers/{guild,index}.ts`, `rest/index.ts`, `sharding/cluster.ts`, `voice/index.ts`, `ws/transport.ts`
- **Problem:** Packages ship `.ts` source, so a consumer with `noUnusedLocals`, `noImplicitOverride`
  or `noUncheckedIndexedAccess` type-checks Lunibee too: 20 errors inside Lunibee in ZedBot.
- **Fix:** Fixed the 20 sites; `tsconfig.strict.json` runs those flags on package source in `typecheck`.
- **Status:** Verified (0.2.3). ZedBot against local Lunibee: 53 → 33 errors, all 33 its own.

## F10 — `roles.create()` / `roles.edit()` drop the audit-log reason

- **Severity:** P2
- **Location:** `packages/managers/src/role.ts`
- **Problem:** `const { reason, ...payload } = options` and then `reason` was never sent.
- **Impact:** Audit log shows no reason; ZedBot called the route directly to get one.
- **Fix:** Pass `{ reason }` to the request. (`noUnusedLocals` would have caught it; see F9.)
- **Status:** Verified (0.2.3), `tests/audit-reasons.test.ts`.

---

## Order

1. F1 + F2: biggest effect, mechanical, non-breaking with aliases.
2. F4, then F6.
3. F3, F5.
4. F7, F8.

Done when ZedBot can drop its `.toJSON()` calls, the Lunibee-related casts and the direct
`Routes` calls listed above without adding new ones.

**State after 0.2.3:** F1, F3–F10 verified. F2 is partly done; its remaining, breaking half is
0.3.0 Step 1. The `.toJSON()` calls in ZedBot are already unnecessary at runtime.
