# Lunibee Architecture (compatibility audit)

> Phase-0 architecture reference for the Discord.js-familiar compatibility effort.
> Audited from `ekretos/lunibee@dev`. Reference-only — describes what exists today so
> Phase-1 agents build **on top of** Lunibee without renaming it into Discord.js.

## 1. Shape of the project

- **Bun-first monorepo.** `type: module`, ESM only, Bun workspaces (`packages/*`).
  Build via `bun scripts/build.ts` (+ `build-dts.ts`). Typecheck: `bunx tsc --noEmit`.
  Tests: `bun test`. TypeScript `^7.0.2`.
- **Single published package `lunibee`** (v0.1.6) re-exports every workspace package
  and also exposes subpath entries (`lunibee/core`, `/rest`, `/structures`, …). The
  public barrel is `packages/lunibee/src/index.ts` — **this file is the one public API
  surface consumers see**; anything added to a sub-package must be surfaced here.
- **Internal packages** are `@lunibee/<name>` (workspace refs), source-linked
  (`module`/`types` → `src/index.ts`), so cross-package edits are live without a build.

## 2. Package map & ownership

| Package | Purpose | Discord.js analogue | Owner (Phase 1) |
|---|---|---|---|
| `core` | `Client`, events, permissions, collector, client-state | `discord.js` Client core | Rohan |
| `lunibee` | Public re-export barrel | `discord.js` root | Rohan (surfacing) |
| `ws` | `Gateway` (single class, opcodes, lifecycle) | `@discordjs/ws` `WebSocketManager` | Vikram |
| `rest` | `REST`, `Routes`, `RESTError`, webhook, redis/store rate-limit | `@discordjs/rest` | Aditya |
| `structures` | `Message`, `User`, `Guild`, `Channel`, `Interaction`*, `Embed`, `AuditLog`, resources | `discord.js` structures | Dev |
| `managers` | `*Manager` caches + REST ops | `discord.js` managers | Dev |
| `builders` | Embed/Component/Command/Attachment builders (+ Components V2) | `@discordjs/builders` | Dev |
| `voice` | `VoiceConnection`, `AudioPlayer`, `AudioStream` | `@discordjs/voice` | Neha |
| `sharding` | `ShardManager`, `ClusterManager`, `ShardBus` | `discord.js` sharding | Neha |
| `types` | `API*` payload types + enums + intents/permission bits | `discord-api-types` | **Arjun (shared danger zone)** |
| `collection` | `Collection extends Map`, `Cache` | `@discordjs/collection` | (shared, read) |
| `utils`, `formatters`, `handlers`, `create`, `cli` | helpers / scaffolding | `@discordjs/formatters`, misc | (as needed) |

**`packages/types` is the coordination zone.** Every `API*`/enum change routes through
Arjun to avoid conflicting edits across five workers who all import from it.

## 3. Dependency direction (must not be violated)

```
types  ←──────────────── everything (leaf; no internal deps)
collection ← managers, core
rest ← managers, core, structures(?)
structures ← managers, core
managers ← core
ws ← core
builders ← types
core ← (managers, rest, structures, ws, collection, types)
lunibee ← (all)
```

`core/Client` wires managers + gateway + structures together. Do not introduce
back-edges (e.g. `types` importing anything, or `structures` importing `core`).
`bun run check:deps` enforces the graph — run it before proposing cross-package moves.

## 4. Client & event model (key divergence from Discord.js)

- `Client` (`core/src/index.ts`) extends a **custom minimal `EventEmitter`**, *not*
  Node's `events.EventEmitter`. It provides `on / once / off / removeAllListeners` and a
  **`protected emit`** (consumers cannot emit). Async listener rejections are routed to
  the `error` event. **Do not assume Node EE extras** (`prependListener`,
  `setMaxListeners`, `rawListeners`, `eventNames`) — they do not exist.
- **Event names already match Discord.js string literals** (`ready`, `messageCreate`,
  `interactionCreate`, `guildCreate`, …). The typed map is `ClientEvents` in
  `core/src/index.ts`; the enum of names is **`ClientEvent`** (Discord.js calls it
  `Events`). Gateway dispatch (`READY`, `MESSAGE_CREATE`, …) is translated to camelCase
  client events inside the `Client` constructor.
- Managers on the client: `client.users`, `client.guilds`, `client.channels`,
  `client.application.commands` — names match Discord.js. `client.ws` **and**
  `client.gateway` both return the `Gateway`. Lifecycle: `login()`, `destroy()`,
  `isReady()`, `uptime`, `ping`, `readyAt`, `user`, `setPresence()`.

## 5. Interactions (structures/interactions.ts)

Already strongly Discord.js-familiar: `Interaction` + `CommandInteraction`,
`ComponentInteraction`, `ModalSubmitInteraction`, `AutocompleteInteraction`; type guards
`isChatInputCommand() / isMessageComponent() / isModalSubmit() / isAutocomplete()`;
`interaction.options.getString/getInteger/getUser/…` (`CommandOptions` ≈ Discord.js
`CommandInteractionOptionResolver`); `commandName`, `customId`, `values`; and
`reply / deferReply / editReply / deleteReply / followUp / update / deferUpdate /
showModal`. The `Client` implements the `InteractionClient` transport interface.

## 6. Builders

Discord.js-style fluent builders: `EmbedBuilder`, `ButtonBuilder`+`ButtonStyle`,
`ActionRowBuilder`, `ModalBuilder`, `TextInputBuilder`+`TextInputStyle`,
`SlashCommandBuilder` (with `.addStringOption(o => …)`, `.setName/.setDescription/
.setDefaultMemberPermissions/.setDMPermission`, `UserCommandBuilder`,
`MessageCommandBuilder`), `AttachmentBuilder`, plus a **Components V2** set
(`ContainerBuilder`, `SectionBuilder`, `TextDisplayBuilder`, `MediaGalleryBuilder`,
`FileComponentBuilder`, `SeparatorBuilder`, `ThumbnailBuilder`). Select-menu naming
diverges — see the matrix.

## 7. REST & Gateway

- `REST`: `.get/.post/.patch/.put/.delete/.request`, `setToken`, `setHooks`, retry
  policy, `Routes` map, `RESTError`. Body is passed **positionally** (`post(path, body)`),
  unlike `@discordjs/rest`'s `post(path, { body })`.
- `Gateway`: one class (not a manager-of-shards), `connect/close/send/on/off/emit`,
  `setPresence/setVoiceState/requestGuildMembers`, `ping`, opcodes, `GatewayState`.

## 8. Where new compatibility APIs go

New Discord.js-familiar surface is added **inside the owning package**, then re-exported
through `packages/lunibee/src/index.ts`. Aliases (Discord.js-name → Lunibee impl) live
next to the canonical export in the same package. No new top-level packages in this
effort. Naming rules for all of the above: **`api-conventions.md` (the gate).**
