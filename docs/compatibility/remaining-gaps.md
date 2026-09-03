# Remaining Gaps & Per-Agent Work Split

> Actionable gap list distilled from `compatibility-matrix.md`. Each item names the owning
> Phase-1 agent, the bucket (`api-conventions.md §1`), and whether it touches a coordination
> zone. **Rule reminder: alias/adapt additively; never rename a Lunibee canonical export.**

## A. Cross-cutting coordination flags

- **`packages/types` is Arjun-owned.** Any new `API*` type, enum member, or enum
  renumbering → propose to Arjun (message god). Affects Rohan, Vikram, Aditya, Dev, Neha,
  who all import from it. Do not edit in a worktree without sign-off.
- **Public barrel collisions.** New aliases must be surfaced in
  `packages/lunibee/src/index.ts`. Existing precedence on name clash is
  **builders > structures > types** (see barrel comments). New collisions → Arjun.
- **Event map is two-part.** Adding an event requires editing BOTH `ClientEvent`
  (`core/events.ts`) and `ClientEvents` (`core/index.ts`). Single owner: **Rohan**.
- **`Cache`/`Collection`** are shared by managers + core; changes ripple. Coordinate any
  signature change with Dev + Rohan.

## B. Gaps by owner

### Rohan — Client & Interactions (`core`, `lunibee`)
1. 🔀 `export { ClientEvent as Events }` and `IntentsBitField → Intents` alias. *(low risk)*
2. 🏗 Emit `guildAvailable` (typed in `ClientEvents` but never emitted).
3. 🔧 Interaction guards: add `isButton()`, `isStringSelectMenu()`, `isAnySelectMenu()`
   as thin wrappers over `isMessageComponent()` + `componentType`.
4. 🔧 Decide whether raw-payload events (`guildMemberAdd` → `APIGuildMember`, etc.) should
   emit wrapped structures for djs-parity. **Design-level — propose before implementing;
   this changes event payload types (breaking) and needs god sign-off.**
5. 🏗 Verify `AutocompleteInteraction.getFocused()` exists; add if missing.

### Vikram — Gateway (`ws`)
1. 🔧 Name-map opcodes/close/`Status` to djs (`GatewayState` ↔ `Status`) via aliases.
2. ✅/verify reconnect + resume + heartbeat/zombie handling behaves like djs; add
   reconnect/resume tests. Report divergences rather than reshaping the single-`Gateway`
   model into a shard manager (that's ⚑ intentionally-different).

### Aditya — REST (`rest`)
1. 🔀 `export { RESTError as DiscordAPIError }`.
2. 🔧 Additive `{ body }` overload on `get/post/patch/put/delete` **without** breaking the
   canonical positional signature (⚑). Do not flip the default.
3. 🔧 Verify `request(options)` shape vs `@discordjs/rest`; align option names additively.
4. Rate-limit/error/endpoint tests.

### Dev — Structures, Managers, Builders (`structures`, `managers`, `builders`)
1. 🔧 Add `createdTimestamp` getter to `BaseStructure` **once** (centrally). *(low risk,
   sanctioned)*
2. 🔀 Select-menu aliases: `StringSelectBuilder → StringSelectMenuBuilder`; provide
   `UserSelectMenuBuilder`/`RoleSelectMenuBuilder`/`ChannelSelectMenuBuilder`/
   `MentionableSelectMenuBuilder` as typed aliases/wrappers over `EntitySelectBuilder`.
3. 🔧 `ContextMenuCommandBuilder` compat over `UserCommandBuilder`/`MessageCommandBuilder`.
4. 🔧 `CachedManager` alias for `Manager`/`ResourceManager` base.
5. 🏗 Lower-priority missing managers: `GuildBanManager`, `GuildScheduledEventManager`,
   `StageInstanceManager`, `PermissionOverwriteManager` — scope with Arjun before building.
6. Verify Components V2 builder JSON matches Discord payloads; investigate as noted in T5.
7. 🔧 Channel subclassing: djs has many channel types; Lunibee has `Channel`/`TextChannel`.
   Adding subclasses is larger design — propose scope before expanding.

### Neha — Voice & Sharding (`voice`, `sharding`)
1. 🔧 Factory wrappers: `joinVoiceChannel()`, `createAudioPlayer()`, `createAudioResource()`
   over the existing classes; `VoiceConnectionState → VoiceConnectionStatus` alias.
2. 🏗 `entersState()`, `getVoiceConnection()` helpers.
3. 🔀 `ShardManager → ShardingManager` alias; 🔧 map `broadcastEval`/`Shard` concepts onto
   `ShardBus`/`ClusterManager` additively.

### Priya — QA (`packages/testing`) [Phase 2]
- Independent compat suite; do **not** assume Phase-1 impls correct. Cross-check every
  🔀/🔧/🏗 row lands with both a working alias AND unchanged canonical behaviour. Record in
  `test-results.md` / `known-incompatibilities.md`.

## C. Intentionally-different (⚑ — do NOT force compat; document only)

- Custom minimal `EventEmitter` on `Client` (no Node-EE extras).
- `Gateway` single-connection model vs djs `WebSocketManager`/`Shard`.
- REST positional body (`post(path, body)`).
- `Cache` (Lunibee extra beyond `Collection`).
- Bun-first runtime assumptions (`@types/bun`, Bun test, Bun build).

## D. Sequencing / dependency notes

- All Phase-1 work rebases on `dev` **after** this doc set lands (the gate). `packages/types`
  additions block dependents → land those first, through Arjun.
- The `createdTimestamp` add (Dev #1) and select-menu aliases (Dev #2) are the lowest-risk,
  highest-parity wins — good first commits to validate the alias convention.
- Anything marked "propose before implementing" (Rohan #4, Dev #5/#7) is a design decision
  for god, not a worker call.
