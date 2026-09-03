# Lunibee ⇄ Discord.js Compatibility — Test Results

_Owner: Priya (QA / breaker). Last run: 2026-09-03 against branch `dev` @ `c04ea10`._

> **Scope note.** These results are an **independent** verification of the Lunibee code as it
> currently sits on `dev`. They were produced without assuming the Phase‑1 implementation work
> (Rohan/Vikram/Aditya/Dev/Neha) is correct, and **before** the architecture contract
> (`docs/compatibility/api-conventions.md`) had landed on `dev` — so the suite is written against
> the **de‑facto Discord.js public API** and Discord's documented wire protocol. When
> `api-conventions.md` lands, these tests should be reconciled against it.

## The suite

Location: `packages/testing/src/compat.*.test.ts` (owned by QA).
Run it with:

```bash
bun test ./packages/testing/src/compat.*.test.ts
# or, from the package:
cd packages/testing && bun run test:compat
```

| File | Area | What it verifies |
|------|------|------------------|
| `compat.enums.test.ts` | Enums / wire values | `ComponentType`, `ButtonStyle`, `ChannelType`, `GatewayIntentBits`, `InteractionResponseType`, `TextInputStyle` numeric values match Discord; builders-vs-types enum drift. |
| `compat.builders.test.ts` | Builders → payload | `EmbedBuilder`, `ButtonBuilder`, `ActionRowBuilder`, `StringSelectBuilder`, `ModalBuilder`, `SlashCommandBuilder` `toJSON()` shapes (snake_case keys, numeric type/style, nesting, limits). |
| `compat.permissions.test.ts` | Permissions | `PermissionsBitField` `has`/`any`/`add`/`remove`/`toArray`, `static Flags`, resolution edge cases; djs divergences. |
| `compat.collection.test.ts` | Collection | Map‑subclass parity; `first`/`last`/`at`/`find`/`filter`/`map`/`some`/`every`/`reduce` and their return‑type contracts. |
| `compat.routes.test.ts` | REST routes | Route builders emit Discord's exact REST paths (names may follow Lunibee conventions; **paths must match the wire**). |
| `compat.structures.test.ts` | Structures | `User`/`Message`/`Channel` snake→camel mapping, djs nullability (`"0"` discriminator → null, no avatar → null), helper methods. |

## Result summary

```
bun test ./packages/testing/src/compat.*.test.ts
 61 pass
  0 fail
 206 expect() calls
Ran 61 tests across 6 files.
```

- **56** assertions verify behaviour that **is** Discord.js/Discord‑wire compatible today. ✅
- **5** tests are marked `test.failing` — they encode a **confirmed incompatibility**. They pass
  today *because the behaviour is wrong*, and will start **failing** (alerting) the moment the
  owning agent fixes the underlying issue, at which point the `test.failing` marker should be
  removed. Full detail in [`known-incompatibilities.md`](./known-incompatibilities.md).

The `test.failing` markers, by area:

| # | Area | One‑line | Owner to route to |
|---|------|----------|-------------------|
| KI‑1 | Builders | `@lunibee/builders` ships a duplicate `ButtonStyle` missing `Premium: 6`. | Dev (builders) |
| KI‑2 | Builders | `EmbedBuilder.addFields([...])` (array form) throws — djs accepts array **or** spread. | Dev (builders) |
| KI‑3 | Permissions | `PermissionFlagsBits` values are **strings** (`"8"`), not **bigints** (`8n`) — breaks `Flags.A \| Flags.B`. | Rohan (core) |
| KI‑4 | Permissions | `@lunibee/structures` does not re‑export `PermissionsBitField` (only `@lunibee/core` does). | Dev (structures) / Arjun |
| KI‑5 | Structures | `Message` has no `createdTimestamp`/`createdAt` accessors (only `timestamp`). | Dev (structures) |

## What passes (compatibility confirmed)

- **Enum wire values** — every checked `ComponentType`, `ButtonStyle` (in `@lunibee/types`),
  `ChannelType`, `GatewayIntentBits`, `InteractionResponseType`, and `TextInputStyle` value equals
  Discord's documented protocol number. The **builders `ComponentType`** matches the canonical
  `@lunibee/types` `ComponentType` (no drift). (Builders `ButtonStyle` does **not** — see KI‑1.)
- **Builder payloads** — Embed/Button/ActionRow/StringSelect/Modal/SlashCommand serialize to
  correct Discord API shapes: snake_case keys (`custom_id`, `min_values`, `icon_url`), numeric
  `type`/`style`, correctly nested action rows, deep‑cloned `toJSON()`, and Discord's structural
  limits (25 embed fields, 5 components/row, required‑before‑optional command options).
- **Permissions (core)** — `PermissionsBitField` behaves like djs for the common patterns:
  `has()` AND‑semantics, `any()` OR‑semantics, immutable `add`/`remove`, `toArray()`, `static Flags`,
  string/decimal resolution, negative‑bitfield rejection, `bigint` backing field.
- **Collection** — is a genuine `Map` subclass; `filter()` returns a `Collection`, `map()` returns
  an array, `find()` returns a single value — all matching discord.js's `Collection` contract.
- **REST routes** — all sampled routes emit byte‑for‑byte the Discord REST paths, including
  `messages/bulk-delete`, URL‑encoded reaction emoji, `@me`, `@original`, and snowflake validation.
- **Structures** — `User`/`Message`/`Channel` map snake_case payloads to camelCase properties with
  djs nullability (`global_name` → `globalName`, `public_flags` → `flags`, `"0"` discriminator →
  `null`, missing avatar → `null`), mention `toString()`, and djs helper methods
  (`message.reply/react/pin`).

## Pre‑existing issues found in the repo (outside the compat suite)

These are not Lunibee↔djs incompatibilities but were surfaced while running the full tree; routing
them to the owners:

1. **`tests/managers.test.ts` › "GuildManager executes REST operations" — FAILING (test defect).**
   The `get` mock returns `[]` for every URL except `/guilds/1`, so `fetchAutoModerationRule` feeds
   `[]` into `new AutoModerationRule(...)`, whose `id` is `undefined`; `BaseStructure`'s snowflake
   guard then (correctly) throws `TypeError: A Discord structure requires a valid snowflake ID.`
   **The implementation is correct; the test fixture is wrong** — the mock should return a valid
   rule payload (`{ id, guild_id, name, ... }`) for the single‑rule GET. → **Dev (managers)**.

2. **`packages/lunibee` has no `package.json` (latent packaging gap).**
   `packages/lunibee/src/index.ts` does `export * from "@lunibee/formatters"`, but the directory has
   only `README.md` + `src/`, so it is **not a workspace member** and declares no dependency on
   `@lunibee/formatters`. Under the isolated linker this resolves only after a full `bun run build`
   populates `dist/`; a clean source‑only `bun test` can fail with
   `Cannot find module '@lunibee/formatters' from packages/lunibee/src/index.ts`. → **Rohan
   (packages/lunibee)** / Arjun for packaging.

## How to extend the suite

Add more `compat.<area>.test.ts` files under `packages/testing/src/`. Assert **Discord‑wire truth**
(exact numbers, snake_case keys, paths) and **djs‑familiar developer ergonomics**. When you confirm
an incompatibility, encode it as `test.failing(...)` with a comment stating the djs behaviour, and
add a row to `known-incompatibilities.md`.
