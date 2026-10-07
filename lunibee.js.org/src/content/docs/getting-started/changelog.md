---
title: Changelog
description: Lunibee version history and release notes.
---

## v0.3.0 (unreleased)

A new way to reach Discord, alongside the existing one. Design: [`docs/lunibee-3-workflow.md`](https://github.com/ekretos/lunibee/blob/0.3.0/docs/lunibee-3-workflow.md).

### ✨ Added

* **Handles.** `bot.guild(id)`, `bot.channel(id)`, `bot.member(guildId, userId)`, `bot.role(guildId, roleId)`, `bot.person(id)` and `bot.message(channelId, messageId)` name a thing by its ids. Every handle reads the same way (`peek()` cache only, `get()` cache then Discord, `fetch()` Discord now) and carries the actions Discord offers on it (`kick`, `timeout("10m")`, `send`, `reply`, `react`, …). `bot.guild(id).members`, `.roles` and `.channels` are collections. See [Handles](/reference/handles/).
* **`bot.api`**, Discord's REST API as a chained path: `bot.api.guilds(id).members(userId).patch({ nick }, { reason })`. Typed results for the common routes, `bot.api.to(...)` for the rest, and `pages()` / `all({ max })` that follow Discord's cursors for members, bans, messages, guilds and other lists. See [bot.api](/reference/api/).
* **`command()` and `option.*`.** One definition, typed options (`option.user({ required: true })`, `option.integer({ min, max, default })`, `option.channel({ kinds })`, `option.choice([...])`…), run as a slash command, a prefix command (`prefix: true`), or both. `bot.commands.add()`, `.deploy()` and `.listen({ prefix })` register and route them. Prefix commands read the same options from the message, check `permissions`, answer a bad argument with the usage line, and warn at startup when the `MessageContent` intent is missing. See [Commands](/reference/commands/).
* **Channel kinds.** `channel.kind` is `"text"`, `"voice"`, `"thread"`, `"forum"`… in place of the numeric `type`; `channel.is(...kinds)` narrows the type and `channel.as(...kinds)` asserts it; `bot.channel(id).as("voice")` fetches and narrows. `channelKindOf()`, `channelTypesOf()` and `ChannelKinds` convert to and from Discord's numbers. See [Channel](/reference/channel/#kinds-030).
* **`bot.guild(id).createChannel({ kind, … })`** creates text, announcement, voice, stage, category, forum and media channels with the options each kind accepts, and returns the right class.
* **`parseDuration()`** turns `"90s"`, `"10m"`, `"1h30m"` into milliseconds.
* **CLI: `create command --slash|--prefix|--both`** writes a `command()` file (slash by default, `--prefix` for prefix-only, `--both` for one file answering both) and **`lunibee sync commands`** regenerates `src/commands/index.ts` with `registerCommands(bot)`. `create command` now emits the `command()` form instead of `data` + `execute()`; existing command files keep working.

* **Cross-process `ShardBus`.** `ShardBusTransport` with `BroadcastChannelTransport` (one process) and `IpcTransport` (forked clusters, relayed by the `ClusterManager`). Children forked by the manager use IPC automatically. A request to a shard whose cluster died rejects immediately, pending requests are capped (`maxPending`), and handler errors without an `onError` listener become a `LUNIBEE_SHARD_BUS_ERROR` process warning instead of being dropped. See [Sharding](/core-concepts/sharding/).
* **`ShardSupervisor`** and `ClusterManager` options `supervisor` (backoff, jitter, `maxRestarts` per `window`) and `onGiveUp`. Defaults keep today's fixed-delay restarts.

### 🔧 Changed

* **Typed message options.** `MessageCreateOptions`, `MessageEditOptions`, `InteractionReplyOptions`, `InteractionUpdateOptions` and `FollowUpOptions` live in `@lunibee/types` and replace `Record<string, unknown>` on channel send/edit, message reply/edit and interaction replies. `embeds` take `CreateEmbed` builders or raw embeds, `files` need a `name` and `data`, `ephemeral` is a boolean. Unknown keys still pass through. A caller that passed a wrongly-shaped value (for example `embeds: unknown[]`) now gets a compile error. See [Sending Messages](/recipes/sending-messages/).

* **Previous state on more update events.** `messageUpdate`, `voiceStateUpdate`, `presenceUpdate`, `stageInstanceUpdate`, `guildScheduledEventUpdate` and `autoModerationRuleUpdate` pass `previous` (or `null`) as a second argument. `messageUpdate`'s `previous` is now `Message | null` instead of `Message | undefined`. New option `cache: { presences: true }` keeps presences so `presenceUpdate` can report the previous one.

### ⚠️ Removed

Everything deprecated in 0.2.x is gone. `lunibee migrate --fix` renames the old names and lists the calls to change by hand.

* **The 49 pre-0.2.2 names:** every `…Builder` (`ButtonBuilder` → `CreateButton`, `SlashCommandBuilder` → `CreateSlashCommand`, `EmbedBuilder` → `CreateEmbed`…), `ButtonStyle` / `TextInputStyle` (→ `ButtonType` / `TextInputType`) and the old `…Type` sets (`ChannelType` → `ChannelEnum`, `ComponentType` → `ComponentEnum`, `InteractionType` → `InteractionEnum`, `WebhookType` → `WebhookEnum`, `PermissionOverwriteType` → `PermissionOverwriteEnum`…).
* **`Routes.channelPins` and `Routes.channelPin`** → `Routes.channelMessagesPins` (returns `{ items, has_more }`) and `Routes.channelMessagesPin`.
* **`setDMPermission()` and `dm_permission`** → `setContexts(0)` for guilds only, `setContexts(0, 1)` to allow the bot's DMs.
* **`fetchInvite({ withExpiration })`**: Discord always returns `expires_at`.
* **`deleteRole`, `deleteEmoji`, `deleteChannel`, `deleteGuild`** → `remove(id, reason?)`. **`sendMessage()`** on `Channel` and `ChannelManager` → `send()`. **`ChannelManager.bulkDelete()`** → `bulkDeleteMessages(id, ids, reason?)`.
* **The positional `reason` after an options object** on `members.edit`, scheduled events `create`/`edit`, stage instances `create`/`edit` and permission overwrites `edit` → `{ …options, reason }`.

### 📚 Documentation

* Quick Start, `examples/basic` and the Upgrading page use `bot`, `command()` and handles. The Upgrading page has a before/after table for 0.3.0.

## v0.2.4

Security release. Fixes the findings of the 0.2.3 security review; the status of each one is in [`docs/audits/security-0.2.3.md`](https://github.com/ekretos/lunibee/blob/0.2.4/docs/audits/security-0.2.3.md). **Upgrade recommended.**

### 🔒 Security

* **REST paths can no longer be rewritten into another route.** `.`/`..` segments, percent-encoded dots and backslashes are refused before the request, so a string passed as an id cannot send the bot token to a different endpoint. `leaveGuild()`, `fetchWebhook()`, `fetchGuildPreview()`, `fetchSticker()`, `followUpInteraction()` and `removeReaction()` validate ids, and tokens are always URL-encoded.
* **Webhook and interaction tokens stay out of rate-limit keys** (including Redis), errors and hooks; redaction now ignores the path's case.
* **The Gateway only resumes on Discord's hosts.** A `resume_gateway_url` that is not `wss:` on `discord.gg` (or the gateway you connected to) is ignored and the default gateway is used, so the RESUME frame never carries the token elsewhere.
* **A caller's `authorization` header can no longer be merged with the bot token.** Library headers replace any spelling of the same header.
* **Gateway frames are capped** at 64 MiB inflated, so a compressed frame cannot exhaust memory.
* **Webhook URLs must be Discord's** (`WebhookClient({ url })` no longer accepts look-alike hosts or embedded URLs); `thread_id` is encoded; CDN asset hashes are encoded.
* **Listener warnings never print the bot token**; it is replaced with `[token]`.
* **`lunibee migrate` / `lunibee fix` escape every RegExp metacharacter** in names they search for (CodeQL `js/incomplete-sanitization`); `publish:all` no longer runs `npm` through a shell.

### ⚠️ Behaviour changes

* **Timed-out members** keep only View Channel and Read Message History in `member.permissions`, `member.permissionsIn()`, `client.permissionsFor()` and `computePermissions({ timedOutUntil })`, as Discord applies it. Owners and administrators are exempt.
* **IDENTIFY properties** default to `os: process.platform`, `browser` and `device: "Lunibee"` instead of Discord's Android client, so the bot no longer shows the mobile status icon. Set `properties` in the client options to change them.
* **`link()` and `codeBlock()`** escape their input: brackets in a link label, parentheses and spaces in its URL, and ``` inside a code block.
* `fetchWebhook()`, `fetchGuildPreview()`, `fetchSticker()` and `followUpInteraction()` reject a malformed id (a rejected promise with a `TypeError`), and `REST` rejects paths with dot segments.

### ✨ Added

* **`CreateAttachment(path, { root })`**: confines a file path to a folder (symlinks resolved). Use it, or pass bytes, whenever the path comes from a user.
* `Routes.currentUserGuild`, `Routes.sticker`, `Routes.messageReactionUser`.

### 🐛 Fixed

* **`WebhookClient.send({ files })` uploads the files.** They were serialized into the JSON body and never reached Discord; they are now sent as multipart form data. Component builders in `components` are serialized with `toJSON()` like embeds.
* **Integer and number option choices** are checked like string choices: a name must be 1-100 characters. A string choice with an invalid value no longer leaves earlier choices from the same call behind.

### ✨ Added

* **More `Collection` methods, matching discord.js:** `mapValues()`, `reduceRight()`, `concat()`, `equals()`, `merge()`, `symmetricDifference()`, `toReversed()`, `toSorted()` (the same as `sorted()`), the static `Collection.groupBy()` and `Collection.combineEntries()`, and the `ReadonlyCollection` and `Keep` types. `union()`, `intersection()` and `difference()` now accept any `ReadonlyCollection`. There is no in-place `sort()` or `reverse()`.
* **`Symbol.species` on `Collection`.** `filter()`, `clone()`, `sorted()`, `partition()`, `union()`, `intersection()` and `difference()` return an instance of your subclass, as in discord.js. They build it with `new Species()` (no arguments, so no `ttl` or `maxSize`); a subclass that cannot be built that way, or should hand back a plain `Collection`, overrides `static get [Symbol.species]()`. Their return types are now `this`.
* **`collection.random(amount)` and `randomKey(amount)`** return that many different values or keys (the reference page already said so, but only one could be picked). **`findLast()` and `findLastKey()`** search from the end. `random()` without an amount no longer copies the collection.
* **`collection.ensure(key, factory, ttl?)`** returns the stored value or stores and returns what `factory(key, collection)` makes (a get-or-create, as in discord.js).
* **`slide: false`** on `Collection`: a read still marks an entry recently used but no longer extends its TTL.

### 🔧 Changed

* **`Cache` is now a thin layer over `Collection`** (fixed TTL, LRU, `maxSize`). A bounded `Cache` used to re-insert an entry on every read, which made it slow once it held many entries: `set` + `get` on a 100,000-entry cache took about 17 µs and now takes about 1.1 µs. Two things differ: `values()` and `entries()` list entries in the order they were first added (they used to follow recency), and `sweepInterval` / `dispose()` are kept but no longer needed, as expired entries are dropped at their deadline.
* **Plain collections are much lighter.** A `Collection` without options no longer allocates expiry, recency and stats structures, or stores its options, up front: 35 bytes per empty collection (a `Map` is 32) instead of about 360. They are created when `ttl` or `maxSize` is set, or on the first `set()` with its own TTL. `set()` with a TTL or `maxSize` is also faster (about 40% for a collection with both), and `get()` is faster: about 30% with a TTL, 40% with a TTL and `maxSize`, and 15-30% with `maxSize` alone (a read is one lookup instead of two). `stats` are unchanged.
* **Lapsed entries no longer push live ones out of a `maxSize` collection.** When a `set()` takes a collection over `maxSize`, entries whose TTL has already lapsed are dropped first (as `expired`), instead of evicting the least recently used live entry while a dead one lingered.
* **Stricter public types, no `any`.** `WebhookClient.editMessage()` resolves to `APIMessage`; `WebhookMessageOptions.components` / `files` take component payloads (or builders) and `RESTFileAttachment`s; `VoiceGatewayTransport.send()` takes a `VoiceGatewayPayload`; `identifyPayload()` returns `GatewayPayload<IdentifyData>`; extra `GatewayProperties` / `IdentifyProperties` keys are strings; `MinimalRedisClient.set()` resolves to `string | null`. Code that compiled before only breaks if it relied on these being `any`.

### 📚 Documentation

* **Version picker.** The site keeps the docs of every release (v0.1.0 to v0.2.3) next to the latest; pick one from the header.

## v0.2.3

Packaging fixes for 0.2.2, and a deprecation pass. Nothing is removed and existing code keeps working; deprecated APIs are struck through in your editor and **removed in 0.3.0**.

### ⚠️ Deprecated (removed in 0.3.0)

* **The pre-0.2.2 names** (`ButtonBuilder`, `ButtonStyle`, `ChannelType`…, all 49 of them) are now removed in **0.3.0** instead of 2.0. See [Upgrading](/getting-started/upgrading/) for the table of new names.
* **`setDMPermission()`** on slash and context-menu command builders: Discord deprecated `dm_permission`. Use `setContexts()`, which slash commands now have too: `setDMPermission(false)` → `setContexts(0)`.
* **`Routes.channelPins` / `Routes.channelPin`**: Discord deprecated `/channels/{id}/pins`. Use `Routes.channelMessagesPins` (returns `{ items, has_more }`) and `Routes.channelMessagesPin`.
* **`fetchInvite({ withExpiration })`**: no effect; Discord always returns `expires_at` and deprecated the `with_expiration` parameter, so it is no longer sent.
* **Manager names that hid the cache/Discord split**: `roles.deleteRole()`, `emojis.deleteEmoji()`, `channels.deleteChannel()` and `guilds.deleteGuild()` become `remove()`; `delete()` keeps meaning "drop from the cache". `channel.sendMessage()` / `channels.sendMessage()` become `send()`, and `channels.bulkDelete()` becomes `bulkDeleteMessages()`.
* **A reason passed after an options object** (`members.edit(id, options, reason)`, scheduled events, stage instances, permission overwrites): put it in the options, `{ ...options, reason }`.

### ✨ Added

* `setContexts()` on `CreateSlashCommand`, the replacement for `setDMPermission()`.
* `Routes.channelMessagesPins` and `Routes.channelMessagesPin`.
* `CreateCommandOption` is exported, so code using the deprecated `CommandOptionBuilder` has a name to move to.
* `contexts` on the `APIApplicationCommand` and `ApplicationCommandData` types.
* **One rule for audit-log reasons.** If a method takes an options object the reason goes in it, otherwise it is the last argument; it is always sent as the `X-Audit-Log-Reason` header. New: `remove(id, reason)` on the role, emoji, channel and guild managers, and a reason on `unban()`, emoji and channel create/edit, `guilds.edit()`, auto-moderation rules, scheduled-event delete, `deleteMessage()`, `bulkDeleteMessages()`, `pinMessage()` / `unpinMessage()`, and on `message.delete()`, `message.pin()`, `message.unpin()` and `channel.delete()`. See [Managers](/packages/managers/#audit-log-reasons).
* `roles.setPositions(positions, reason)` and `channels.createWebhook(channelId, { name, reason })`, for the two routes bots still called by hand.
* `Guild` carries `afkChannelId`, `afkTimeout`, `widgetEnabled`, `widgetChannelId`, `applicationId`, `publicUpdatesChannelId`, `safetyAlertsChannelId`, `maxPresences` and `maxVideoChannelUsers`.
* `RESTErrorCode`: names for the Discord error codes bots handle, e.g. `error.code === RESTErrorCode.UnknownMessage`. `RESTError.hint` says what to check for Missing Access (50001) and Missing Permissions (50013).
* **`lunibee migrate`** (CLI): lists the APIs removed in 0.3.0 in your `src/`; `--fix` renames the old Lunibee names (only where they are imported from Lunibee) and lists the calls to change by hand. See [CLI](/packages/cli/).
* `MessagePayload` and `Buildable<T>` types: type your own message payloads (builders or raw objects); every send and reply method accepts them.

### 🔧 Changed

* **An error thrown by a listener is no longer silent.** With no `error` listener, or when an `error` listener itself throws or rejects, it is reported as a process warning (`LunibeeWarning`, on stderr by default) instead of disappearing.
* `pinMessage()`, `unpinMessage()` and `fetchPinnedMessages()` use Discord's current pin endpoints. Discord requires the **Pin Messages** permission for pinning and unpinning. `fetchPinnedMessages()` still returns the newest pinned messages (up to 50) as `Message[]`.

### 🐛 Fixed

* **`roles.create()` and `roles.edit()` dropped the audit-log reason.** It was taken out of the options and never sent.
* **Lunibee's source failed to compile in strict projects.** Projects using `noUnusedLocals`, `noImplicitOverride` or `noUncheckedIndexedAccess` got errors from inside Lunibee; CI now checks with these flags.
* **Malformed interaction data leaked wrong types**: a non-string `custom_id` came back as a number from `customId`. Interaction fields are now read with type checks (no `any` left in `@lunibee/structures`).
* **Docs:** the Managers page used `emojis.delete()` (which only clears the cache) to delete an emoji, and `guild.members` / `guild.emojis`, which do not exist.
* **`@lunibee/cli` installed without the `lunibee` command.** npm drops a `bin` whose file is missing when it reads `package.json`, which happens before `prepublishOnly` builds it. Packages are now built before `npm publish`.
* **The project scaffolder shipped without code.** `create-lunibee@0.2.2` contained only its README. It is now built before publishing, ships its type declarations, runs on Node as well as Bun, and is renamed **`@lunibee/create`**: `bun create @lunibee my-bot`. `create-lunibee` is deprecated.
* **`@lunibee/builders`, `@lunibee/rest` and `@lunibee/managers` did not declare `@lunibee/types`**, so installing one of them on its own could not resolve it.
* **Publishing refuses broken packages.** `bun run publish:all` and `lunibee publish` build every package, check that every file `package.json` points at exists and that every `bin` has a `#!` line, publish dependencies first, and (`publish:all`) skip versions already on npm so a failed run can be rerun. Extra flags go to `npm publish`: `bun run publish:all -- --otp 123456`.

## v0.2.2

### ✨ Added

* **Context-menu commands**: `isContextMenuCommand()`, `isUserContextMenuCommand()`, `isMessageContextMenuCommand()` and `isCommand()` guards; `ContextMenuCommandInteraction` with `targetId`, `targetUser`, `targetMember` (with member actions) and `targetMessage`; `setContexts()` and `setNameLocalizations()` on `CreateUserCommand` / `CreateMessageCommand`. See [Context Menus](/recipes/context-menus/).
* **Default `allowed_mentions`**: `new Client({ allowedMentions: { parse: [] } })` applies to every message the client sends (channel send/edit, replies, interaction replies, edits, follow-ups); a message's own `allowed_mentions` wins. See [Client options](/reference/client/).
* **`withResponse`**: `reply()`, `update()`, `deferReply()` and `deferUpdate()` accept `withResponse: true` and return the created `Message` from the same request.
* **CDN helpers exported**: `CDN_BASE`, `cdnURL()` and `ImageURLOptions` from `lunibee` and `@lunibee/structures`.
* **Component payload types exported from `lunibee`.** `APIComponent`, `APIActionRowChild`, `APIStringSelectComponent`, `APIEntitySelectComponent`, `APISelectOption`, `APIContainerComponent`, `APITextDisplayComponent`, `APIModalComponent` and the other builder payload types; the builder shapes of an action row, button and text input are `APIActionRowPayload`, `APIButtonPayload` and `APITextInputPayload`.
* **Message stickers, polls and forwards**: `message.stickers`, `message.poll` and `message.messageSnapshots`, refreshed on `messageUpdate`. New `APIPoll` and `APIMessageSnapshot` types.
* **Previous state on update and delete events**: `guildUpdate`, `guildMemberUpdate`, `guildRoleUpdate`, `channelUpdate` and `threadUpdate` pass a copy of the cached structure before the update; `guildRoleDelete`, `channelDelete` and `threadDelete` pass the removed one; `guildEmojisUpdate` and `guildStickersUpdate` pass the previous list. Trailing arguments only, so existing handlers keep working. If you captured previous state from `raw`, you can drop that.
* **CLI rework** (`@lunibee/cli`): per-command `--help`, `--version`, `--cwd`, `--json` on `list`/`check`/`doctor`/`info`/`status`, `--dry-run` and `--force` on every `create`, "did you mean" suggestions for commands, options and events. `create handler` takes several events and any case; `sync handlers --check` exits 1 when the binder is stale and warns about typo folders and missing default exports; `create command` validates names and supports `--description`/`--category`, generating `data` + `execute`; `create component` takes its type and name as arguments and generates a real builder and `handle()`; `list events`/`list components`; `check`/`doctor` exit 1 on errors and verify `.env` is git-ignored, installed versions match and the Bun version; `publish` publishes dependencies first, refuses mixed versions, confirms unless `--yes`, and passes `--dry-run`/`--tag`/`--otp`.
* **`lunibee handler --fix`**: migrates 0.2.1 handlers to the client-first format (adds `_client: Client` and the import), fixes the case of event folders and resyncs `src/handlers/event.ts`. Without `--fix` it reports what needs changing.

### ⚠️ Behaviour changes

* `isChatInputCommand()` is true for slash commands only; context-menu commands no longer match it. Use `isCommand()` for any application command.

### 🐛 Fixed

* **Healthy Gateway connections were closed as zombies every ~45 s.** Incoming frames never reset the silence clock, so with the default `zombieTimeout` every connection was closed and resumed once the staleness deadline passed, on every shard. Any frame from the current socket now counts as traffic. If you set `zombieTimeout: Infinity` to work around this, remove it.
* **`showModal(modal.toJSON())` failed to type-check.** The raw modal type required an index signature that the builder's `APIModalComponent` lacks; a builder and its `toJSON()` output are now accepted alike, without a cast.

### ✏️ New names

Builders are now `CreateX`, `…Style` constants are `…Type`, and `…Type` constants are `…Enum`; every `…Enum` and `…Type` also works as a type. **The old names still work** as deprecated aliases (your editor shows them struck through) and are removed in 2.0. See [Upgrading](/getting-started/upgrading/).

| Before | Now |
|---|---|
| `ButtonBuilder`, `EmbedBuilder`, `ModalBuilder`, `SlashCommandBuilder`… (every `XBuilder`) | `CreateButton`, `CreateEmbed`, `CreateModal`, `CreateSlashCommand`… (`CreateX`) |
| `ButtonStyle`, `TextInputStyle` | `ButtonType`, `TextInputType` |
| `ChannelType`, `ComponentType`, `InteractionType`, `InteractionResponseType` | `ChannelEnum`, `ComponentEnum`, `InteractionEnum`, `InteractionResponseEnum` |
| `ApplicationCommandType`, `ApplicationCommandOptionType` | `ApplicationCommandEnum`, `ApplicationCommandOptionEnum` |
| `StickerType`, `StickerFormatType`, `WebhookType`, `PermissionOverwriteType` | `StickerEnum`, `StickerFormatEnum`, `WebhookEnum`, `PermissionOverwriteEnum` |
| *(new)* | `ActivityEnum` (`Playing`, `Streaming`, `Listening`, `Watching`, `Custom`, `Competing`) |

## v0.2.1

### ✨ Friendlier API

* **Members on messages**: `message.member` (roles, nickname) on guild messages, with `permissions` computed from the cached roles, so prefix commands can check permissions. Message authors' members are kept current in the member cache.
* **Live member permissions**: `GuildMember.permissions` is computed from the cached roles whenever Discord did not send them (everywhere but interactions), and `permissionsIn(channelId)` adds channel overwrites.
* **Member actions**: `member.kick()`, `ban()`, `timeout()`, `setNickname()`, `addRole()`, `removeRole()` and `edit()`, each with an optional audit-log reason; `GuildMemberManager` methods take a `reason` too.
* **Overwrites that merge**: `channel.editPermissionOverwrite(id, { ViewChannel: true, SendMessages: false })` and `permissionOverwrites(id).update()` change only the named permissions.
* **Files**: `files` on `send`, `reply`, `edit` and interaction replies upload attachments.
* **Collectors**: `message.createComponentCollector()`, `message.awaitComponent()` and `interaction.awaitModalSubmit()`, always time-limited.
* **Prefix commands**: `parsePrefixArgs()`, `tokenizeArgs()`, `argsFromCommandOptions()` and mention parsers in `@lunibee/utils` (see [Prefix Commands](/recipes/prefix-commands/)).
* **Builders & typing**: `ModalBuilder.addTextInputs()`, `showModal()` takes a builder, `componentsV2Message()`, embed setters clear with `null`, `deferReply({ ephemeral })`, `options.getMentionableType()`, `ComponentInteraction.messageId`, and `ButtonStyle`, `TextInputStyle`, `ComponentType` and `MessageFlags` usable as types.
* **Permissions**: renamed permission names (`ManageEmojisAndStickers`, `ManageEmojis`, `UseSlashCommands`) still resolve.

### ⚠️ Behaviour changes

* `GuildMember.permissions` is a getter. Members from the Gateway or REST used to report `0`; they now report their computed guild-level permissions.
* `APIModalComponent` (the type `ModalBuilder.toJSON()` returns) now has a required `custom_id` and `title`.

### 📚 Documentation

* New [Prefix Commands](/recipes/prefix-commands/) recipe; "0.2.1 Additions" on the GuildMember, Message, Channel, Interactions, ModalBuilder, Components V2, EmbedBuilder, PermissionSet, Collector and Utils pages; an [upgrade note](/getting-started/upgrading/).

### 🧪 Testing

* `tests/friendly-api.test.ts` covers prefix arguments, member permissions and actions, overwrite merging, file uploads, component collectors and the builder additions.

## v0.2.0

### 💥 Breaking Changes

See [Upgrading to 0.2.0](/getting-started/upgrading/) for code changes.

* **Messages are not cached by default.** Pass `messageCache: { maxSize?, ttl? }` to the client to keep a bounded per-channel cache; without it `MessageManager.cache` stays empty and `resolve()` always fetches.
* **Builders validate on `toJSON()`.** Buttons without a custom ID/URL/SKU or without a label/emoji, selects without a custom ID or with `min_values > max_values`, string selects whose `max_values` exceeds their options, mixed action rows, and modals without a custom ID, title or component now throw.
* **`bulkDeleteMessages()`** accepts 1–100 IDs (one ID becomes a normal delete), removes duplicates, and throws a `RangeError` for messages older than 14 days.
* **Cached objects are updated in place.** `ResourceManager.upsert()`, `GuildManager.patch()` and Gateway updates merge into the cached instance instead of replacing it.
* **`RESTError.path`** shows `:token` in place of webhook and interaction tokens.

### ✨ Features

* **Resource state never expires**: `Collection` gains `set(key, value, ttl?)` (sliding TTL, O(1) LRU `maxSize`, `onEvict`, `stats`, `peek`, `purge`, `ttlRemaining`) and `setWithoutTTL()`; managers store Discord resources without TTL.
* **Gateway cache sync**: guild create/update/delete, members, roles, emojis, stickers, bans, scheduled events, stage instances, channels, threads, voice states, automod rules, invites and soundboard sounds are kept current. New `guilds.members(id)`, `roles(id)`, `emojis(id)`, `stickers(id)`, `soundboard(id)`, `voiceStates(id)`, `autoModerationRules(id)`, `invites(id)`.
* **Large bots**: `ClientOptions.cache` (`users`, `members`, `roles`, `emojis`) turns caching off per resource.
* **Fetch safety**: concurrent fetches of one resource share a request; a fetch that finishes after a newer Gateway update or delete is returned but not cached.
* **Interactions**: single acknowledgement guard, `ephemeral` on edits and follow-ups, `fetchReply()`, `editFollowUp()`, `deleteFollowUp()`, `user`, `member`, `createdTimestamp`, `expiresAt`, `isExpired`.
* **Permissions**: `PermissionSet.missing()`, `computePermissions()`, `client.permissionsFor()`, typed `channel.permissionOverwrites`.
* **Collectors**: `idle`, `signal`, `for await`, `wait()`, `Symbol.dispose`, `onDispose()` and `client.createCollector()`.
* **REST**: `RESTError.kind` / `retryable`, `redactPath()`.
* **Messages**: `iterateMessages()`, `endPoll()`, `fetchPollVoters()`, `sendSoundboardSound()`.
* **Sharding**: startup in rounds of `max_concurrency`, session-start-limit check, `fetchGatewayInfo()`, `health()`.
* **New APIs**: guild stickers and soundboard managers, `client.monetization` (SKUs, entitlements, subscriptions) with `entitlementCreate/Update/Delete` events, soundboard events, `ButtonBuilder.setSKUId()`.

### 🐛 Bug Fixes

* **Message cache**: with `messageCache`, messages from `MESSAGE_CREATE` are cached; `messageUpdate`, `messageDelete` and `messageDeleteBulk` receive the previous/deleted cached message(s) as an extra argument.
* **Buttons**: `setStyle()` clears fields the style cannot carry, and `toJSON()` rejects forbidden field combinations (e.g. a label on a premium button).
* **Permissions**: added bits 48 (`setVoiceChannelStatus`), 51 (`pinMessages`) and 52 (`bypassSlowmode`); owner/administrator results include them. `permissionsFor()` resolves threads through their parent channel.
* **Guild updates**: fields a partial update omits (e.g. `memberCount`) keep their cached values.
* **Redaction**: tokens are redacted even after a malformed webhook/interaction ID.
* **Sharding**: rounds are paced by sent IDENTIFYs (`handshakeTimeout`); `maxConcurrency` is capped at Discord's limit; the session start budget counts only shards that need a connection and never destroys live shards.
* **Voice**: `receiver.subscribe()` throws after the connection is destroyed.

* **Gateway RESUME**: reconnect requests, zombie connections and heartbeat timeouts closed with `1001`, which makes Discord drop the session; they now close with `4900` so RESUME succeeds.
* **Heartbeat**: the regular interval now starts after the jittered first beat instead of alongside it.
* **Gateway sequence**: a lower sequence can no longer roll back the RESUME point.
* **Messages**: `MESSAGE_CREATE` / `MESSAGE_UPDATE` no longer overwrite a cached channel with a stub.
* **Voice**: receiver streams end on disconnect/destroy instead of waiting forever.
* **Collection LRU**: eviction no longer scans deleted slots (about 65 µs → 0.55 µs per eviction at 100k entries).

---

## v0.1.8

### 🚨 Behaviour Changes

* **`ShardManager.spawnDelay` now defaults to `5000` ms** (`ShardManager.IDENTIFY_INTERVAL`). Discord permits one IDENTIFY per 5 seconds; starting shards back to back earned close code `4008` and invalid-session churn. An *N*-shard bot now takes about `(N - 1) × 5s` to connect. Pass `spawnDelay: 0` to opt out.
* **`ClusterManager` supervises its children.** A cluster that exits unexpectedly is re-forked with the same shard assignment after `restartDelay` (5000 ms). Disable with `restartOnExit: false`; observe with `onClusterExit`.

### ✨ Features

* **Discord.js-familiar API**: `Events`, `IntentsBitField`, `CachedManager`, `ShardingManager`, `StringSelectMenuBuilder` / `User`/`Role`/`Mentionable`/`ChannelSelectMenuBuilder`, exported `ContextMenuCommandBuilder` with `setType()`, interaction guards (`isButton()`, `isStringSelectMenu()`, `isAnySelectMenu()`, …) and `interaction.options.getFocused()` for autocomplete.
* **Channel subclasses**: `createChannel()` returns `TextChannel`, `NewsChannel`, `DMChannel`, `VoiceChannel`, `StageChannel`, `CategoryChannel`, `ThreadChannel`, `ForumChannel` or `MediaChannel` (all extend `Channel`); channels emitted by the client use it. New `isThread()`, `isTextBased()`, `isVoiceBased()`, `isDMBased()`.
* **Managers**: `guilds.bans(id)`, `guilds.scheduledEvents(id)`, `channels.permissionOverwrites(id)` and `client.stageInstances`.
* **Voice helpers**: `joinVoiceChannel`, `getVoiceConnection`, `createAudioPlayer`, `createAudioResource`, `entersState`, `VoiceConnectionStatus`.
* **Sharding**: `ShardBus.onError()` receives handler failures; `ShardBus.respond()` with `request()` / `broadcastRequest()` for cross-shard queries.
* **REST**: opt-in `concurrentBuckets` runs requests on a known bucket in parallel up to its remaining allowance.

### 🐛 Bug Fixes

* **Emoji**: constructing a unicode emoji (`id: null`) threw.
* **Invites**: `client.generateInvite()` sent `scopes=` instead of Discord's `scope=`, so invite links lacked the bot scope. `fetchInvite` / `fetchGuildTemplate` now URL-encode the code.
* **Bans**: `GuildMemberManager.ban()` ignored `reason`.

* **Gateway compression**: `compress: true` previously decoded nothing. Discord's `zlib-stream` is zlib-wrapped, but the decoder used raw deflate and drained output on a 50 ms timer, dropping and reordering frames. Frames are now decoded with a persistent inflate stream on the `Z_SYNC_FLUSH` boundary, strictly in arrival order.
* **Gateway sessions**: `connect()` on an already-connected `Gateway` opened a second socket and left the first one dispatching, interleaving two sequence streams and corrupting later RESUMEs. `connect()` is now idempotent and cancels any pending reconnect.
* **Gateway handshake**: IDENTIFY and RESUME no longer share the application send budget, so a busy shard can always complete its handshake.
* **Stale frames**: a compressed frame that finished decoding after its socket was replaced is now discarded instead of dispatched.
* **REST cancellation**: an aborted request waiting in its rate-limit queue permanently wedged that bucket. Fixed.
* **REST retries**: a `429` carrying no `Retry-After` retried immediately instead of waiting the documented one second. Transport failures (DNS, resets, TLS) are now retried for idempotent methods.
* **Redis rate limits**: a Redis outage answered every read with "no limit known", dropping all workers to unlimited sending. Writes are now mirrored in-process and reads fall back to that mirror.
* **Leaks**: the `Cache` TTL sweeper no longer keeps the process alive, and `Collector.next()` no longer leaks a listener per call.

### ✨ Additions

* **Atomic rate-limit reservation**: `RateLimitStore.reserve()` hands one unit of a bucket's allowance to exactly one worker. `RedisRateLimitStore` uses a server-side Lua script when the client exposes `eval`.
* **REST pipeline**: `createRouteKey`, `RequestScheduler`, `RateLimiter`, `HttpTransport` and `ResponseDecoder` are exported, and `new REST({ transport })` injects the HTTP stage for testing.
* **`GatewaySession`**: session id, sequence, resume host and the IDENTIFY-vs-RESUME decision, exported from `@lunibee/ws`.

### 📚 Documentation

* Corrected the `ClusterManager` example: the method is `spawn()`, not `connect()`.
* Corrected the `ShardManager` and `REST` option tables, which listed options that do not exist (`presence`, `autoScale`, `apiVersion`) and omitted the real ones.
* Corrected the `Gateway` option table: `maxReconnectAttempts` defaults to `Infinity`, not `10`.
* Every package now has a full README, and the docs site has a generated API reference under `/api/`.
* Reference pages that described missing APIs were fixed, and the new APIs are documented.

### 🧪 Testing

* Line coverage raised to about 99.5%, with a per-file minimum enforced in CI.

---

## v0.1.7

### 🐛 Bug Fixes

* **Managers**: Removed a duplicate `delete` override in `ChannelManager` that caused a TypeScript `TS2393` duplicate function implementation error at build time.

### 🛠️ Build & Tooling

* **DTS build**: Excluded `*.test.ts` files from `tsconfig.dts.json` to fix a `TS5097` error caused by `.ts` import extensions in test files (valid in Bun, not in `tsc`).
* **`create-lunibee`**: Added a proper CLI entrypoint (`bin` field, `dist/` output), so `bun create lunibee` now scaffolds a new project correctly.

### 📚 Documentation

* **`quick-start.md`**: Switched intent syntax from bitwise OR (`|`) to array form to match the preferred `IntentBits` style.
* **`sharding.md`**: Same array-form intent fix.
* **`README.md`**: Corrected `PermissionsBitField` → `PermissionSet`, and `StringSelectMenuBuilder` → `StringSelectBuilder`.

---

## v0.1.6


### 🎉 Major Highlights

* **Component Builders V2**: Introduced a modern, chainable builder pattern for message components (inspired by Discord.js). Added `ActionRowBuilder`, `ButtonBuilder`, and `StringSelectMenuBuilder` for creating rich UIs effortlessly.

  ```typescript
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("primary-btn")
      .setLabel("Click Me!")
      .setStyle(1) // Primary
  );
  ```
* **💯 100% Test Coverage**: The entire Lunibee monorepo has been rigorously tested and now officially boasts **100% line and function coverage** across all packages!

### ✨ Features & Resource APIs
* **REST Multipart Support**: Added `postWithFiles` and `patchWithFiles` to the REST client, bringing first-class support for attachments and raw form data payloads.

  ```typescript
  await rest.postWithFiles("/channels/123/messages", { content: "Here is your file!" }, [
    { name: "image.png", data: fileBuffer, contentType: "image/png" }
  ]);
  ```
* **Direct Resource Operations**: You can now perform intuitive actions directly on structures. Channels and messages are now properly hydrated with the client context.
  ```typescript del={2,3} ins={5,6}
  // Previously: Context-based operations
  await context.editChannel(channel.id, { name: "general" });
  await context.sendMessage(message.channelId, { content: "Hi!" });
  // Now: Intuitive editing directly from the structure
  await channel.editName("general");
  await message.reply("Hi!");
  ```
* **Advanced Interactions**: Added full structural support and parsing for `ModalSubmitInteraction`, `AutocompleteInteraction`, and component types (11, 15, 16). Added missing getters (like `getAttachment` with required fallbacks) for Slash Command options.

  ```typescript
  // Safely extract a required attachment option
  const attachment = interaction.options.getAttachment("receipt", true);
  console.log(`Uploaded file: ${attachment.filename}`);
  ```

### 🛠️ Core & Events
* **`ClientEvent` Enum**: Introduced and exported a new `ClientEvent` enum in the `@lunibee/core` package to replace hardcoded event strings.
  ```typescript del={4,5} ins={7,8}
  import { ClientEvent } from "@lunibee/core";

  // Previously: Hardcoded strings
  client.on("messageCreate", (message) => {
  // Now: Strongly typed enums
  client.on(ClientEvent.MessageCreate, (message) => {
    console.log(message.content);
  });
  ```

### 💻 CLI & Developer Tooling
* **Interactive Tooling**: Expanded developer tooling by adding an interactive handler generator and support for multiple handlers per event. Fixed a bug to correctly detect existing event handlers.

  ```bash
  $ npx lunibee generate handler
  ? Which event would you like to handle? messageCreate
  ? Name your handler file: welcome-message
  ✔ Created src/events/messageCreate/welcome-message.ts!
  ```
* **Fix**: Fixed the CLI build process to ensure the published Lunibee binary is properly runnable.

### 📚 Documentation
* **Site & Guides**: Made the Lunibee documentation site significantly friendlier. Expanded the quick start workflow and the "package choices" overview.
* **Advanced Guides**: Wrote and expanded practical, task-focused guides for Builders, Sharding, Voice connections, Permissions, Formatters, Utilities, and common Discord types.
* **API References**: Fully documented the new application commands, channel, and message resource APIs.
* **Fixes**: Corrected gateway intent examples and API names.

## v0.1.5

* Initial public beta release containing the core client, gateway, REST API wrappers, structural representations of Discord objects, Voice components, builders, and standard interactions.
