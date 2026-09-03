# API Conventions — Discord.js-familiar surface on Lunibee

> **This file is the Phase-1 gate.** No Phase-1 agent adds or renames public API until
> they have read it. Every new compatibility API MUST follow these rules. Conflicts or
> exceptions are routed to **Arjun → god**, not decided unilaterally.

## 0. Prime directive

**Lunibee is not being renamed into Discord.js.** We add a Discord.js-*familiar* surface
**on top of** Lunibee, preserving Lunibee's existing names, package boundaries, and the
custom event/emitter model. Familiarity is achieved by **additive aliases and matching
signatures**, not by rewriting Lunibee's internals or renaming its canonical exports.

## 1. The decision procedure (apply per API)

For each Discord.js concept, classify it into exactly one of five buckets and act:

| Bucket | When | Action |
|---|---|---|
| **IMPLEMENT** | Lunibee lacks it entirely and it's expected by Discord.js users | Build it in the owning package under the **Lunibee canonical name**, then add a Discord.js-name alias if the two differ. |
| **ADAPT** | Exists but signature/shape differs from Discord.js | Keep the Lunibee canonical method; **add a Discord.js-compatible overload/wrapper** rather than breaking the existing one. |
| **ALIAS** | Same behaviour, only the *name* differs | Add a named re-export / assignment alias. Canonical Lunibee name stays the source of truth. |
| **INTENTIONALLY-DIFFERENT** | Lunibee deliberately diverges (perf, Bun, architecture) | Do **not** force compat. Document the divergence in the matrix + `remaining-gaps.md`. |
| **PRESERVE** | Already matches Discord.js | Leave it. Do not "tidy" a name that already works. |

**Default bias: preserve + alias over rename.** A rename is a breaking change to Lunibee's
own users and must be justified to god with a "strong compatibility reason".

## 2. Naming rules

1. **Canonical name = existing Lunibee name.** If Lunibee already exports `X`, `X` stays
   the real thing. Never delete or repurpose an existing public export to free up a name.
2. **Discord.js name = additive alias.** When Discord.js uses a different name, export it
   *alongside* the canonical one:
   ```ts
   export class StringSelectBuilder { /* canonical Lunibee */ }
   export { StringSelectBuilder as StringSelectMenuBuilder }; // discord.js-familiar alias
   ```
   Prefer `export { Canonical as DjsName }`. For values/classes an assignment alias
   (`export const IntentsBitField = Intents;`) is acceptable when a re-export can't express it.
3. **One canonical, many aliases — never two implementations.** An alias must point at the
   canonical impl. Do **not** copy logic into a second class.
4. **Casing:** classes/enums/builders `PascalCase`; methods/props/functions `camelCase`;
   enum *members* `PascalCase`; event string values `camelCase` (matching Discord.js
   literals exactly). Do not introduce `snake_case` public surface — raw wire payloads keep
   `snake_case` only inside `API*` types in `packages/types`.
5. **Enums:** match Discord.js **member names and numeric values** exactly for wire enums
   (`ChannelType`, `ButtonStyle`, `ApplicationCommandOptionType`, `PermissionFlagsBits`,
   `GatewayIntentBits`, …). These live in `packages/types` (or `builders` for component
   enums) — **coordinate through Arjun before adding/renumbering an enum.**
6. **Events:** keep the camelCase string literals already in `ClientEvent` /`ClientEvents`.
   New events: add the member to `ClientEvent` (enum, `core/src/events.ts`) **and** the
   typed tuple to `ClientEvents` (`core/src/index.ts`) — both, or typing breaks. The
   Discord.js `Events` enum name maps to Lunibee's `ClientEvent`; if a `Events` alias is
   wanted, add `export { ClientEvent as Events }` (coordinate — one owner: Rohan).
7. **Managers** end in `Manager`; **builders** end in `Builder`; **raw payload types** are
   `API<Thing>` in `packages/types`. Keep these suffixes.

## 3. Signature-compatibility rules (ADAPT)

- **Add, don't replace.** When adding a Discord.js-shaped signature, keep the existing one
  working. Use overloads or an options-object union, e.g. accept both
  `send(content: string)` and `send({ content })` — Lunibee already does this in places.
- **Return types:** return Lunibee structure instances (e.g. `Message`), not raw payloads,
  where Discord.js returns a structure. Raw `API*` returns are acceptable only where
  Lunibee already documents them as raw (flagged in the matrix as intentionally-different).
- **Reply/interaction ergonomics** already match Discord.js (`reply/deferReply/editReply/
  followUp/update/showModal`, `options.getString`, type guards). Preserve these signatures
  exactly; do not "improve" argument order.
- **REST:** `REST` uses **positional body** (`post(path, body)`). This is Lunibee-canonical
  and intentionally different from `@discordjs/rest`'s `{ body }`. Do not flip it globally;
  if a `{ body }` overload is desired it is ADAPT (additive), owned by Aditya, and must not
  break existing positional callers.

## 4. Structure conventions

- All cached entities extend `BaseStructure` (`id`, `createdAt`, `toString()`). Discord.js
  consumers also expect **`createdTimestamp`** — adding it to `BaseStructure` is the
  sanctioned, low-risk compat add (Dev owns; additive getter, no rename). Do that once,
  centrally, rather than per-class.
- Image URL helpers follow Discord.js names already (`avatarURL`, `iconURL`, `bannerURL`,
  `displayAvatarURL`, `displayName`). New CDN helpers use the same `xxxURL(options)` shape.
- Boolean state as Discord.js-style getters (`isReady()`, `partial`, `pinned`) — match the
  Discord.js name (method vs property) when adding.

## 5. Error handling & async

- Throw `TypeError`/`RangeError` for bad arguments (Lunibee already does). REST failures
  throw `RESTError`; gateway failures `GatewayError`; voice `VoiceError`. Keep this — do
  **not** introduce a generic `DiscordAPIError` class; if the Discord.js name is wanted,
  ALIAS `export { RESTError as DiscordAPIError }` (Aditya owns, coordinate).
- Everything I/O is `Promise`-based; no callback APIs. Async listener errors surface on the
  `error` event — preserve that contract.

## 6. Export & surfacing checklist (every new/aliased API)

1. Canonical export lives in its **owning** package's `src` and its `index.ts`.
2. Discord.js-name alias sits next to it in the **same** package.
3. It is re-exported from `packages/lunibee/src/index.ts` (the public barrel). If a name
   collides there (e.g. builders vs types), follow the existing precedence comment:
   **builders > structures > types**; resolve new collisions via Arjun.
4. Types-only additions go through **Arjun** (`packages/types` danger zone).
5. Add a row to `compatibility-matrix.md` (bucket + status) in the same change.

## 7. What NOT to do

- ❌ Rename an existing Lunibee export to a Discord.js name (breaks Lunibee users).
- ❌ Duplicate logic into a Discord.js-named twin class.
- ❌ Add Node-`EventEmitter`-only methods to `Client` assuming they exist.
- ❌ Edit `packages/types` enums/`API*` without routing through Arjun.
- ❌ Touch another agent's owned package (see ownership table in `board.md`).
- ❌ Flip REST body from positional to `{ body }` globally.

When a case doesn't fit cleanly, **stop and message god** with the concrete API and your
proposed bucket rather than guessing.
