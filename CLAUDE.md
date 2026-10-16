# CLAUDE.md

@AGENT.md

Follow every rule in AGENT.md above. This file adds the planned work that
future sessions should pick up.

## Naming convention (from 0.2.2)

- Builders are `CreateX`: `CreateButton`, `CreateEmbed`, `CreateSlashCommand`.
- Constant sets of Discord types are `…Enum`: `ChannelEnum`, `ComponentEnum`,
  `ActivityEnum`. Sets of styles are `…Type`: `ButtonType`, `TextInputType`.
  Each is a `const` object plus a same-named value-union type (not a TS
  `enum`: bigint sets such as permissions cannot be enums, and `const enum`
  breaks under Bun's per-file transpiler). `PermissionOverwriteEnum` is the
  one existing TS `enum` among them and stays one.
- Pre-0.2.2 names stay as `@deprecated` aliases, defined at the bottom of the
  file that defines the new name, and are removed in 0.3.1. New code, docs and
  examples use the new names only. `PermissionFlagsBits`, `GatewayIntentBits`, `Routes`,
  `MessageFlags` and the Gateway code sets keep their names.

## Next release: 0.3.2

Fixes from the fifth security audit of 0.3.1, the `CreateThumbnail` / `CreateMediaGallery`
payload bugs, the REST compatibility gaps (`request(options)`, `WebhookClient` aliases),
100% REST coverage, and complete reference pages for REST, Gateway, sharding and voice. Every
finding of the 0.3.2 docs review (D-01 to D-26) is fixed. All in the changelog's
"v0.3.2". Distributed REST coordination (atomic Lua reservations and merges on Redis `TIME`, bot
identity in keys, probes, `failurePolicy`, telemetry, queue limits, `close()`) is in too: docs on `/core-concepts/distributed-rest`. `RedisCache` (`packages/core/src/redis-cache.ts`), a
shared Redis mirror of the Gateway cache, and `RedisCollection` (`packages/collection/src/redis.ts`),
a Collection shared between processes through Redis, are in too.
The external assessment of 2026-10-15 (LUNIBEE-001 to 007) and the 0.3.2 security scan are fixed
(changelog "v0.3.2", Security). Audit reports are not kept in the repository: record findings in
the changelog and in regression tests.
Versions are 0.3.2 and the 0.3.1 docs are archived in the version picker. Left for the
maintainer: the `0.3.2` tag and `publish:all`.

## 0.3.1 (shipped)

The workflow release: handles (`bot.guild(id)`, `peek` / `get` / `fetch`), `bot.api`, channel
`kind`, `command()` with `option.*`, the CLI's `create command --slash|--prefix|--both` and
`sync commands`; typed message payloads; previous state on update events; IPC `ShardBus`,
`ShardSupervisor`, IDENTIFY buckets; `ShardManager` + `ClusterManager` as one system (worker contract, cross-cluster IDENTIFY coordination, readiness, routing, health, recovery); Gateway health and storm backoff; concurrent REST buckets by
default; the REST coverage audit and its gaps; structure polish. The 0.2.x deprecations are
removed. Everything is in `.roadmap/0.3.1.md` (every item ticked as of 2026-10-16, the Bun 1.4
performance items and Step 6b item 13 delivered in 0.3.2) and the changelog's "v0.3.1".
Tagged `0.3.1`.

## 0.2.4 (shipped)

Security fixes for the 0.2.3 review (H1-H3, M1-M5, L1-L3, L5, L7).

## 0.2.3 (shipped)

Deprecation pass and the API-consistency fixes in [FIX.md](FIX.md). Nothing is
removed; deprecated APIs go in 0.3.1 (`.roadmap/0.3.1.md`, Step 0).

## 0.2.2 (shipped)

All items below shipped in 0.2.2; kept as a record. Small, general, non-breaking. Each item needs code, a test that keeps
per-file coverage at the CI threshold, and a docs update (reference page +
changelog), following the release checklist in AGENT.md. Found by comparing
Lunibee with the closed issues of Lilybird, another Bun-first library.

1. **User and Message context-menu commands.**
   - Today `Interaction.isChatInputCommand()` is true for every application
     command (`type === 2`), including context menus.
   - Add `isUserContextMenuCommand()` / `isMessageContextMenuCommand()` (and
     `isContextMenuCommand()`), keyed on `data.type` (2 user, 3 message), and
     make `isChatInputCommand()` true only for `data.type === 1`.
   - Add `targetId`, `targetUser` (from `resolved.users`), `targetMember`
     (from `resolved.members`, attached to the client context) and
     `targetMessage` (a `Message` from `resolved.messages`).
   - Document the `isChatInputCommand()` narrowing as a behaviour change.
2. **Client-wide default `allowed_mentions`.**
   - `ClientOptions.allowedMentions` (Discord shape, e.g. `{ parse: [] }`),
     applied to every message payload the client sends (channel send/edit,
     message reply, interaction reply/edit/follow-up/update, webhooks) when
     the payload has no `allowed_mentions` of its own.
   - A per-message `allowed_mentions` always wins.
3. **Export the CDN helpers.** `CDN_BASE` and `cdnURL()` are defined in
   `packages/structures/src/base.ts` but not exported from
   `@lunibee/structures` (or `lunibee`). Export them (and `ImageURLOptions`
   if missing).
4. **`reply({ withResponse: true })` returns the message.**
   - Discord's interaction callback accepts `?with_response=true` and then
     returns the created message.
   - Support it on `reply()` / `update()` (and deferred variants) and return
     a `Message`, instead of the empty callback response; `fetchReply()` stays.

5. **`showModal()` should accept `ModalBuilder.toJSON()` output.** The raw
   form requires an index signature (`[key: string]: unknown`), which the
   `APIModalComponent` interface lacks, so passing `builder.toJSON()` does not
   type-check (passing the builder does). Drop the index signature or accept
   `APIModalComponent`. Found while moving ZedBot to 0.2.1.
6. **Export the component payload types from `lunibee`.** `APIComponent`,
   `APIActionRowChild`, `APIActionRowComponent` and the other
   `@lunibee/builders` payload types are not exported from the main package,
   so consumers derive them from builder signatures. Found while moving
   ZedBot to 0.2.1.
7. **Message fields AutoMod-style bots need.** `Message` has no
   `stickers` / `sticker_items`, `poll` or `message_snapshots` (forwards),
   so bots read the raw Gateway payload for them. Expose them (raw API shapes
   are fine).

8. **Previous state on update/delete events.** `guildRoleCreate/Update/Delete`,
   `guildEmojisUpdate` and `guildStickersUpdate` emit raw payloads after the
   cache is updated, so a handler cannot see the old role/emoji/sticker (or a
   deleted one). Emit the cached structure (and the previous one on update)
   like channel events do. ZedBot's AntiNuke restore needs this.

CLI (landed on `dev`): handlers are called as `handler(client, ...args)`,
`lunibee create handler <event> [name]` works without prompts, and
`lunibee sync handlers` regenerates the binder.

9. **P1 — zombie reconnect loop (fix first).** `Gateway.#message()` never calls
   `GatewayHeartbeat.receivedMessage()`, so with the default `zombieTimeout` every
   healthy connection is closed as a zombie ~45 s after opening and reconnected,
   forever. Call it for every owned frame; regression tests with a fake clock.
   Steps in `.roadmap/0.2.0.md`, Step 0.

Not planned: a "cache flow" guide beyond the existing Caching & Structures
page, and anything Lilybird-specific (rebranding).
