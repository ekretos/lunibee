# Lunibee ⇄ Discord.js — Known Incompatibilities

_Owner: Priya (QA / breaker). Verified 2026-09-03 against `dev` @ `c04ea10`._

Each entry below is a **confirmed** divergence from Discord.js behaviour (or from Discord's wire
protocol) that survived independent testing. Every one is backed by an executable
`test.failing(...)` in `packages/testing/src/compat.*.test.ts`, so it is regression‑guarded: when
the owner fixes it, that test flips to **failing**, signalling the marker should be removed.

Severity key: **High** = wrong data reaches Discord or a documented djs API is unusable;
**Medium** = a common djs pattern breaks but a Lunibee‑native workaround exists;
**Low** = ergonomic / familiarity gap only.

Naming caveat: Lunibee intentionally keeps its own naming in places (route helper names, error class
`RESTError` vs djs `DiscordAPIError`, `Permission`/`Permissions` vs `PermissionFlagsBits`,
interaction‑response enum key names). Those are **allowed** per the mission board and are **not**
listed as incompatibilities — only genuine behavioural/wire/type mismatches are.

---

## KI‑1 — `@lunibee/builders` exports a duplicate `ButtonStyle` missing `Premium` — **High**

- **Where:** `packages/builders/src/components.ts` (local `ButtonStyle`) vs
  `packages/types/src/index.ts` (`ButtonStyle`).
- **Symptom:** `@lunibee/builders` re‑exports its **own** `ButtonStyle` constant which stops at
  `Link: 5` and omits `Premium: 6`. `@lunibee/types` has the complete set. A developer who does
  `import { ButtonStyle } from "@lunibee/builders"` and then `.setStyle(ButtonStyle.Premium)`
  gets `undefined` as the style → an **invalid Discord payload** (a premium/SKU button silently
  becomes styleless).
- **discord.js:** a single `ButtonStyle` enum including `Premium = 6`.
- **Fix direction:** have `builders` re‑export `ButtonStyle`/`ComponentType` from `@lunibee/types`
  instead of redefining them, eliminating the duplicate‑source drift entirely.
- **Owner:** Dev (builders). **Test:** `compat.enums.test.ts` › "builders ButtonStyle does not drift…".

## KI‑2 — `EmbedBuilder.addFields` rejects the array form — **Medium**

- **Where:** `packages/builders/src/embed.ts` → `addFields(...fields: EmbedField[])`.
- **Symptom:** discord.js's `addFields` is `RestOrArray` — both `addFields(a, b)` and
  `addFields([a, b])` are valid. Lunibee only accepts the spread form; `addFields([{…}])` treats the
  array as a single field, whose `name` is `undefined`, and throws
  `RangeError: Embed field name must contain 1‑256 characters.` Copy‑pasted djs code that passes an
  array breaks.
- **Workaround that exists:** `setFields([...])` accepts an array.
- **Fix direction:** normalize the first argument — if `fields.length === 1 && Array.isArray(fields[0])`,
  spread it (the standard djs `normalizeArray` shim).
- **Owner:** Dev (builders). **Test:** `compat.builders.test.ts` › "addFields accepts an array argument…".

## KI‑3 — `PermissionFlagsBits` values are strings, not bigints — **High**

- **Where:** `packages/core/src/permissions.ts` → `enum PermissionFlagsBits { Administrator = "8", … }`.
- **Symptom:** discord.js's `PermissionFlagsBits.*` are **bigint** values (`Administrator === 8n`),
  which is what makes `Flags.A | Flags.B` and `perms.bitfield & Flags.X` valid bigint bitwise ops.
  Lunibee's are **string** enum members (`Administrator === "8"`). Two concrete breakages follow:
  1. **32‑bit truncation.** `"8" | "32"` coerces the strings through JS's *number* bitwise `|`,
     which operates on **32‑bit integers**. High permission bits are silently mangled — e.g.
     `PermissionFlagsBits.ModerateMembers` (`"1099511627776"`, bit 40) OR'd this way truncates to a
     wrong value. The canonical djs idiom of composing permissions with `Flags.A | Flags.B` is
     therefore unsafe above bit 30.
  2. **`bigint`/string type clash.** `PermissionsBitField.bitfield` is a `bigint`, so any djs‑style
     `perms.bitfield & PermissionFlagsBits.Administrator` throws
     `TypeError: Cannot mix BigInt and other types` (`8n & "8"`).
  - Note: `PermissionsBitField.has(PermissionFlagsBits.X)` still works, because the resolver
    special‑cases the string enum internally. The breakage is the raw `Flags` **values and type**.
- **Fix direction:** define `PermissionFlagsBits` as bigint values (mirroring the existing
  `Permissions` PascalCase bigint map), or make `PermissionsBitField.Flags` point at a bigint map.
- **Owner:** Rohan (core). **Test:** `compat.permissions.test.ts` › "Flags values are bigints supporting bitwise OR".

## KI‑4 — `@lunibee/structures` does not export `PermissionsBitField` — **Medium**

- **Where:** `packages/structures/src/index.ts` (index re‑exports) vs
  `packages/structures/src/permissions.ts` (defined but unexported).
- **Symptom:** The structures package contains a full `permissions.ts` (`Permissions`,
  `PermissionSet`, `PermissionsBitField`) but its `index.ts` never re‑exports it, so
  `import { PermissionsBitField } from "@lunibee/structures"` is a compile/runtime error
  (`Export named 'PermissionsBitField' not found`). It is reachable **only** via `@lunibee/core`.
  discord.js surfaces `PermissionsBitField` from its top‑level entry, so anyone reaching for it via
  the structures package (the natural home for it) can't find it.
- **Extra risk:** `structures/permissions.ts` is a **second, divergent** permissions implementation
  (simpler `has()`, no `static Flags`, `Permissions`‑keyed `toArray`) that duplicates
  `core/permissions.ts`. Two copies will drift. Recommend consolidating to one canonical module and
  re‑exporting it from both package indexes.
- **Fix direction:** either re‑export the canonical permissions from `structures/index.ts`, or
  delete the structures duplicate and re‑export from core. Route the `packages/types`‑vs‑duplication
  decision through Arjun.
- **Owner:** Dev (structures) + Arjun. **Test:** `compat.permissions.test.ts` › "@lunibee/structures re‑exports PermissionsBitField".

## KI‑5 — `Message` lacks `createdTimestamp` / `createdAt` — **Low**

- **Where:** `packages/structures/src/index.ts` → `Message`.
- **Symptom:** discord.js exposes `message.createdTimestamp` (number, ms) and `message.createdAt`
  (Date). Lunibee's `Message` exposes only `timestamp` (a `Date`). djs code reading
  `message.createdTimestamp` gets `undefined`.
- **Workaround that exists:** `message.timestamp.getTime()`.
- **Fix direction:** add `get createdAt(): Date` (alias of `timestamp`) and
  `get createdTimestamp(): number` (`this.timestamp.getTime()`). Cheap, non‑breaking; same pattern
  applies to other snowflake‑bearing structures (`createdAt` from the snowflake) if broader djs
  parity is desired.
- **Owner:** Dev (structures). **Test:** `compat.structures.test.ts` › "exposes discord.js createdTimestamp accessor".

---

## Also observed (not encoded as failing tests)

- **`tests/managers.test.ts` "GuildManager executes REST operations" fails** — a **test‑fixture
  defect** (the mock returns `[]` for the single‑rule GET), not a library incompatibility. The impl
  and its snowflake validation are correct. → Dev (managers). See `test-results.md`.
- **`packages/lunibee` has no `package.json`** — latent packaging gap; `export * from
  "@lunibee/formatters"` is undeclared, so a clean source‑only test run can fail to resolve it until
  `dist/` is built. → Rohan / Arjun (packaging). See `test-results.md`.

## Confirmed **compatible** (spot‑checked, no action needed)

Enum wire values (ComponentType/ChannelType/GatewayIntentBits/InteractionResponseType numbers),
builder payload shapes and limits, REST route paths, `PermissionsBitField` core semantics via
`@lunibee/core`, `Collection` Map‑subclass + return‑type contracts, and structure snake→camel
mapping with djs nullability. Details in `test-results.md`.
