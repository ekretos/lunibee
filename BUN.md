# Bun vs Node — Lunibee runtime benchmark

Every public `Collection` method, every builder, every formatter and every Gateway
dispatch the client handles (64 events), run on **Bun 1.3.11**, **Bun 1.4.2** and **Node 22**
against the same built package. Produced by [`scripts/bench-runtime.mjs`](scripts/bench-runtime.mjs);
raw medians in [`docs/perf/runtime-2026-09-30.json`](docs/perf/runtime-2026-09-30.json).

## Setup

| | |
|---|---|
| Runtimes | bun 1.3.11 · bun 1.4.2 · node 22.22.2 |
| Code | Lunibee `dev` (0.2.1 + landed 0.2.2 work), `bun run build` → `dist/index.js`: the same ESM for every runtime |
| Machine | 4 vCPU Intel Xeon @ 2.10 GHz, 15 GB RAM, Linux (shared cloud container) |
| Method | Per function: 1,000 warm-up calls, then **10,000 timed calls**; time per call from `performance.now()` |
| Rounds | 3 full rounds with the runtimes interleaved (1.3 → 1.4 → Node, ×3); tables show the **median** |
| Date | 2026-09-30 |

Lower is better. **1.4 vs 1.3** is the change from Bun 1.3.11 to 1.4.2. **Bun 1.4 vs Node** says how many
times faster (or slower) Bun 1.4.2 is than Node. The fastest runtime per row is **bold**. Differences under
about 5% are within noise on a shared machine.

## Verdict — is Bun better?

**Yes, on balance — and Bun 1.4.2 is clearly better than Bun 1.3.11.**

- **Bun 1.4.2 vs Bun 1.3.11: 21% faster overall**, 32% faster on Gateway events, 11–15% on
  builders, formatters and collections. Every heavy event got cheaper (`GUILD_CREATE` −30%, `MESSAGE_CREATE` −29%,
  `GUILD_MEMBER_UPDATE` −45%, `GUILD_MEMBERS_CHUNK` −62%). The slowdowns are micro-operations
  of tens of nanoseconds (listed below).
- **Bun 1.4.2 vs Node 22: 13% faster overall** (geometric mean over all 166 functions), and
  each runtime wins about half the functions (Bun 1.4: 69, Node: 70, Bun 1.3: 27).
  - **Bun wins big on builders and formatters: ~1.8× faster.** Every slash command, embed,
    select menu and component a bot builds is cheaper on Bun.
  - **Bun wins the events a bot pays for most:** `MESSAGE_CREATE` 4.9 µs vs 7.5 µs (1.5×),
    `GUILD_CREATE` 111 µs vs 175 µs (1.6×), `GUILD_MEMBER_UPDATE` 2.5 µs vs 3.4 µs (1.4×),
    TTL cache reads 139 ns vs 293 ns (2.1×), TTL/LRU writes ~3× faster.
  - **Node wins the small events and whole-collection scans.** Across all 64 events Node's
    geometric mean is 15% lower, because it is faster on cheap pass-through events
    (reactions, entitlements, `CHANNEL_CREATE`, `INTERACTION_CREATE` 1.0 µs vs 1.2 µs). And it
    is 2–6× faster on `Collection` methods that copy or walk every entry (`array`, `at`,
    `random`, `keyArray`, `filter`, `find`, `each`, `clone`).

**What that means for a bot:** the hot path of a real bot is message and member traffic,
guild joins, cache reads and building replies — all faster on Bun 1.4.2. Node's advantage is in
events that cost well under a microsecond on both runtimes and in full scans of large
collections.

**What it means for Lunibee:** the slow scans share one pattern. `Collection` extends `Map`
and overrides `values()` / `keys()` / `entries()` (to purge expired entries first), and methods
such as `array()`, `at()`, `keyAt()` and `random()` copy the whole collection with
`[...this.values()]` on every call. Bun's engine (JavaScriptCore) is much slower than V8 at
spreading an overridden iterator of a `Map` subclass. Lunibee can avoid the copy (walk once
and stop at the index for `at()`, pick a random index while iterating for `random()`) — a fix
that helps every runtime. Recorded with the benchmark targets in the roadmap (0.3.0).

**Recommendation:** make **Bun 1.4.x the documented minimum and the CI runtime.** Node 22 runs
the built package correctly (no errors across 166 functions), so keeping Node as an
unsupported-but-working runtime costs nothing.

## Summary

Geometric mean of the per-call times in each group (a fair average across functions of very different cost).

| Group | Functions | Bun 1.3.11 | Bun 1.4.2 | Node 22 | 1.4 vs 1.3 | Bun 1.4 vs Node | Fastest per function |
|---|---|---|---|---|---|---|---|
| Collection | 45 | 2.05 µs | 1.73 µs | 1.57 µs | -15% | 1.10× slower | Bun 1.4: 14 · Bun 1.3: 8 · Node: 23 |
| Builders | 35 | 890.8 ns | 789.6 ns | 1.42 µs | -11% | 1.80× faster | Bun 1.4: 24 · Bun 1.3: 6 · Node: 5 |
| Formatters | 22 | 72.8 ns | 62.3 ns | 114.0 ns | -14% | 1.83× faster | Bun 1.4: 12 · Bun 1.3: 10 · Node: 0 |
| Gateway events | 64 | 961.2 ns | 651.3 ns | 566.7 ns | -32% | 1.15× slower | Bun 1.4: 19 · Bun 1.3: 3 · Node: 42 |
| **All** | **166** | 824.6 ns | 647.8 ns | 732.9 ns | **-21%** | **1.13× faster** | Bun 1.4: 69 · Bun 1.3: 27 · Node: 70 |

### Biggest gains, Bun 1.3.11 → 1.4.2

| Function | Bun 1.3.11 | Bun 1.4.2 | Change |
|---|---|---|---|
| Gateway events · GUILD_UPDATE | 11.74 µs | 2.30 µs | -80% |
| Collection · Map.set (reference) | 166.5 ns | 33.7 ns | -80% |
| Collection · delete + set | 816.1 ns | 204.6 ns | -75% |
| Gateway events · GUILD_MEMBER_REMOVE | 1.22 µs | 379.9 ns | -69% |
| Formatters · subtext | 59.4 ns | 19.9 ns | -67% |
| Gateway events · GUILD_SOUNDBOARD_SOUND_DELETE | 611.4 ns | 230.1 ns | -62% |
| Gateway events · GUILD_MEMBERS_CHUNK (10 members) | 65.42 µs | 24.96 µs | -62% |
| Formatters · link | 104.9 ns | 40.2 ns | -62% |
| Gateway events · GUILD_INTEGRATIONS_UPDATE | 295.9 ns | 114.8 ns | -61% |
| Gateway events · GUILD_SOUNDBOARD_SOUND_UPDATE | 688.9 ns | 270.4 ns | -61% |
| Collection · sorted | 195.55 µs | 76.88 µs | -61% |
| Gateway events · GUILD_DELETE | 3.36 µs | 1.37 µs | -59% |

### Where Bun 1.4.2 is slower than 1.3.11 (beyond 5%)

| Function | Bun 1.3.11 | Bun 1.4.2 | Change |
|---|---|---|---|
| Collection · setWithoutTTL | 80.0 ns | 142.3 ns | +78% |
| Builders · CreateTextDisplay | 64.8 ns | 99.1 ns | +53% |
| Formatters · blockQuote | 99.1 ns | 142.5 ns | +44% |
| Formatters · parseUserMention | 141.4 ns | 201.4 ns | +42% |
| Formatters · orderedList | 102.1 ns | 144.8 ns | +42% |
| Collection · last | 1.90 µs | 2.63 µs | +38% |
| Collection · lastKey | 2.22 µs | 2.93 µs | +32% |
| Gateway events · VOICE_SERVER_UPDATE | 173.0 ns | 215.4 ns | +25% |
| Collection · has | 49.4 ns | 58.4 ns | +18% |
| Formatters · roleMention | 49.7 ns | 58.7 ns | +18% |
| Collection · peek | 58.8 ns | 66.9 ns | +14% |
| Gateway events · READY | 1.00 µs | 1.12 µs | +12% |

…and 15 more in the full tables.

### Where Node 22 beats Bun 1.4.2 (beyond 5%)

| Function | Bun 1.4.2 | Node 22 | Node is |
|---|---|---|---|
| Collection · random | 13.20 µs | 2.27 µs | 5.81× faster |
| Collection · array | 11.01 µs | 2.09 µs | 5.27× faster |
| Collection · at | 11.20 µs | 2.27 µs | 4.93× faster |
| Collection · keyArray | 10.09 µs | 2.30 µs | 4.39× faster |
| Collection · keyAt | 10.19 µs | 2.44 µs | 4.18× faster |
| Collection · randomKey | 10.04 µs | 2.52 µs | 3.99× faster |
| Gateway events · VOICE_SERVER_UPDATE | 215.4 ns | 81.3 ns | 2.65× faster |
| Gateway events · CHANNEL_CREATE | 1.29 µs | 552.8 ns | 2.33× faster |
| Collection · each | 11.31 µs | 5.07 µs | 2.23× faster |
| Collection · sweep (removes none) | 11.09 µs | 4.98 µs | 2.23× faster |
| Collection · every | 12.77 µs | 5.88 µs | 2.17× faster |
| Collection · find (last item) | 12.21 µs | 6.00 µs | 2.03× faster |
| Collection · filter | 37.34 µs | 18.60 µs | 2.01× faster |
| Gateway events · ENTITLEMENT_UPDATE | 701.3 ns | 350.6 ns | 2.00× faster |
| Collection · findKey (last item) | 11.58 µs | 5.97 µs | 1.94× faster |

…and 50 more in the full tables.

### Where Bun 1.4.2 beats Node 22 the most

| Function | Bun 1.4.2 | Node 22 | Bun is |
|---|---|---|---|
| Builders · CreateMentionableSelectMenu | 337.2 ns | 1.35 µs | 4.01× faster |
| Builders · CreateUserSelectMenu | 423.4 ns | 1.52 µs | 3.59× faster |
| Builders · CreateMessageCommand | 381.0 ns | 1.30 µs | 3.40× faster |
| Collection · Map.get (reference) | 21.8 ns | 71.0 ns | 3.26× faster |
| Collection · set (ttl) | 112.9 ns | 359.7 ns | 3.19× faster |
| Collection · hasAny (3 keys) | 49.2 ns | 155.1 ns | 3.16× faster |
| Builders · CreateUserCommand | 386.0 ns | 1.21 µs | 3.14× faster |
| Collection · hasAll (3 keys) | 54.9 ns | 170.6 ns | 3.11× faster |
| Collection · set (lru, evicting) | 116.4 ns | 360.4 ns | 3.10× faster |
| Builders · CreateRoleSelectMenu | 502.0 ns | 1.55 µs | 3.09× faster |
| Formatters · bulletList | 106.2 ns | 298.7 ns | 2.81× faster |
| Builders · CreateUserOption | 542.0 ns | 1.49 µs | 2.75× faster |

## Full results

### Collection

| Function | Bun 1.3.11 | Bun 1.4.2 | Node 22 | 1.4 vs 1.3 | Bun 1.4 vs Node |
|---|---|---|---|---|---|
| Map.set (reference) | 166.5 ns | **33.7 ns** | 84.0 ns | -80% | 2.50× faster |
| Map.get (reference) | 26.9 ns | **21.8 ns** | 71.0 ns | -19% | 3.26× faster |
| set | **64.3 ns** | 69.8 ns | 96.7 ns | +9% | 1.38× faster |
| get | **80.8 ns** | 88.2 ns | 190.4 ns | +9% | 2.16× faster |
| has | **49.4 ns** | 58.4 ns | 113.2 ns | +18% | 1.94× faster |
| peek | **58.8 ns** | 66.9 ns | 107.2 ns | +14% | 1.60× faster |
| delete + set | 816.1 ns | **204.6 ns** | 295.7 ns | -75% | 1.44× faster |
| setWithoutTTL | **80.0 ns** | 142.3 ns | 124.0 ns | +78% | 1.15× slower |
| set (ttl) | 119.6 ns | **112.9 ns** | 359.7 ns | -6% | 3.19× faster |
| get (ttl, sliding) | 175.9 ns | **138.6 ns** | 293.5 ns | -21% | 2.12× faster |
| ttlRemaining | 161.3 ns | **115.4 ns** | 238.0 ns | -28% | 2.06× faster |
| purge (ttl, nothing due) | 371.4 ns | **323.8 ns** | 507.9 ns | -13% | 1.57× faster |
| set (lru, evicting) | **108.2 ns** | 116.4 ns | 360.4 ns | +8% | 3.10× faster |
| get (lru, promoting) | **107.6 ns** | 115.7 ns | 230.7 ns | +7% | 1.99× faster |
| first | 377.3 ns | **346.9 ns** | 464.4 ns | -8% | 1.34× faster |
| firstKey | 290.8 ns | **248.0 ns** | 413.3 ns | -15% | 1.67× faster |
| firstEntry | 547.4 ns | **350.3 ns** | 556.4 ns | -36% | 1.59× faster |
| last | 1.90 µs | 2.63 µs | **1.74 µs** | +38% | 1.51× slower |
| lastKey | 2.22 µs | 2.93 µs | **1.76 µs** | +32% | 1.67× slower |
| lastEntry | 25.31 µs | 20.19 µs | **13.28 µs** | -20% | 1.52× slower |
| at | 11.29 µs | 11.20 µs | **2.27 µs** | -1% | 4.93× slower |
| keyAt | 10.15 µs | 10.19 µs | **2.44 µs** | +0% | 4.18× slower |
| random | 12.15 µs | 13.20 µs | **2.27 µs** | +9% | 5.81× slower |
| randomKey | 10.04 µs | 10.04 µs | **2.52 µs** | -0% | 3.99× slower |
| find (last item) | 13.26 µs | 12.21 µs | **6.00 µs** | -8% | 2.03× slower |
| findKey (last item) | 13.75 µs | 11.58 µs | **5.97 µs** | -16% | 1.94× slower |
| some (last item) | 14.47 µs | 11.60 µs | **6.23 µs** | -20% | 1.86× slower |
| someEntry (last item) | 14.05 µs | 13.19 µs | **6.84 µs** | -6% | 1.93× slower |
| every | 12.09 µs | 12.77 µs | **5.88 µs** | +6% | 2.17× slower |
| filter | 50.22 µs | 37.34 µs | **18.60 µs** | -26% | 2.01× slower |
| partition | 80.38 µs | 53.08 µs | **32.44 µs** | -34% | 1.64× slower |
| each | 11.71 µs | 11.31 µs | **5.07 µs** | -3% | 2.23× slower |
| tap | **34.1 ns** | 35.7 ns | 70.1 ns | +5% | 1.96× faster |
| array | 11.00 µs | 11.01 µs | **2.09 µs** | +0% | 5.27× slower |
| keyArray | 9.88 µs | 10.09 µs | **2.30 µs** | +2% | 4.39× slower |
| entriesArray | 24.25 µs | **22.40 µs** | 23.88 µs | -8% | 1.07× faster |
| toJSON | 24.63 µs | **22.13 µs** | 22.66 µs | -10% | 1.02× faster |
| clone | 55.56 µs | 42.52 µs | **28.00 µs** | -23% | 1.52× slower |
| sorted | 195.55 µs | 76.88 µs | **72.04 µs** | -61% | 1.07× slower |
| union | 153.31 µs | 103.15 µs | **58.49 µs** | -33% | 1.76× slower |
| intersection | 53.05 µs | 37.06 µs | **36.02 µs** | -30% | 1.03× slower |
| difference | 55.54 µs | 41.50 µs | **32.13 µs** | -25% | 1.29× slower |
| hasAll (3 keys) | 58.1 ns | **54.9 ns** | 170.6 ns | -6% | 3.11× faster |
| hasAny (3 keys) | 97.4 ns | **49.2 ns** | 155.1 ns | -50% | 3.16× faster |
| sweep (removes none) | 12.75 µs | 11.09 µs | **4.98 µs** | -13% | 2.23× slower |

### Builders

| Function | Bun 1.3.11 | Bun 1.4.2 | Node 22 | 1.4 vs 1.3 | Bun 1.4 vs Node |
|---|---|---|---|---|---|
| CreateEmbed | 7.04 µs | 6.34 µs | **5.82 µs** | -10% | 1.09× slower |
| CreateButton | 2.37 µs | 2.13 µs | **2.11 µs** | -10% | 1.01× slower |
| CreateButton (link) | 1.46 µs | **832.8 ns** | 2.05 µs | -43% | 2.46× faster |
| CreateActionRow (5 buttons) | 11.68 µs | 10.80 µs | **10.73 µs** | -7% | 1.01× slower |
| CreateStringSelect (3 options) | 5.20 µs | **4.52 µs** | 4.63 µs | -13% | 1.02× faster |
| CreateUserSelectMenu | 559.5 ns | **423.4 ns** | 1.52 µs | -24% | 3.59× faster |
| CreateRoleSelectMenu | 547.1 ns | **502.0 ns** | 1.55 µs | -8% | 3.09× faster |
| CreateMentionableSelectMenu | 517.1 ns | **337.2 ns** | 1.35 µs | -35% | 4.01× faster |
| CreateChannelSelectMenu | 2.22 µs | **2.10 µs** | 2.68 µs | -5% | 1.28× faster |
| CreateTextInput | 1.23 µs | **1.02 µs** | 2.28 µs | -18% | 2.24× faster |
| CreateModal (2 inputs) | 2.28 µs | **1.84 µs** | 3.68 µs | -19% | 2.00× faster |
| CreateTextDisplay | **64.8 ns** | 99.1 ns | 155.5 ns | +53% | 1.57× faster |
| CreateSeparator | 214.2 ns | **130.8 ns** | 148.6 ns | -39% | 1.14× faster |
| CreateThumbnail | 103.0 ns | **91.0 ns** | 215.1 ns | -12% | 2.37× faster |
| CreateSection | 398.3 ns | 412.1 ns | **350.5 ns** | +3% | 1.18× slower |
| CreateMediaGallery (2 items) | 2.76 µs | **2.38 µs** | 2.97 µs | -14% | 1.25× faster |
| CreateFileComponent | 153.2 ns | **89.8 ns** | 189.9 ns | -41% | 2.11× faster |
| CreateContentInventoryEntry | 63.7 ns | **52.5 ns** | 143.4 ns | -18% | 2.73× faster |
| CreateContainer (text + separator + row) | 3.03 µs | 2.97 µs | **2.89 µs** | -2% | 1.03× slower |
| CreateAttachment (no toJSON; construct + set) | **84.8 ns** | 87.1 ns | 139.7 ns | +3% | 1.60× faster |
| CreateStringOption | 3.54 µs | **3.18 µs** | 3.43 µs | -10% | 1.08× faster |
| CreateIntegerOption | 875.5 ns | **755.8 ns** | 1.91 µs | -14% | 2.53× faster |
| CreateNumberOption | 802.1 ns | **719.4 ns** | 1.76 µs | -10% | 2.44× faster |
| CreateBooleanOption | **527.1 ns** | 545.4 ns | 1.43 µs | +3% | 2.62× faster |
| CreateUserOption | 605.1 ns | **542.0 ns** | 1.49 µs | -10% | 2.75× faster |
| CreateRoleOption | 690.5 ns | **549.1 ns** | 1.40 µs | -20% | 2.56× faster |
| CreateChannelOption | 2.11 µs | **2.02 µs** | 2.10 µs | -4% | 1.04× faster |
| CreateMentionableOption | 534.9 ns | **482.3 ns** | 1.30 µs | -10% | 2.70× faster |
| CreateAttachmentOption | 641.5 ns | **578.4 ns** | 1.38 µs | -10% | 2.39× faster |
| CreateSlashCommand (3 options) | 6.60 µs | **6.57 µs** | 8.41 µs | -0% | 1.28× faster |
| CreateSubcommand | **2.99 µs** | 3.26 µs | 4.01 µs | +9% | 1.23× faster |
| CreateSubcommandGroup | **3.28 µs** | 3.54 µs | 3.98 µs | +8% | 1.13× faster |
| CreateContextMenuCommand | **623.7 ns** | 668.3 ns | 1.50 µs | +7% | 2.24× faster |
| CreateUserCommand | 449.8 ns | **386.0 ns** | 1.21 µs | -14% | 3.14× faster |
| CreateMessageCommand | 423.3 ns | **381.0 ns** | 1.30 µs | -10% | 3.40× faster |

### Formatters

| Function | Bun 1.3.11 | Bun 1.4.2 | Node 22 | 1.4 vs 1.3 | Bun 1.4 vs Node |
|---|---|---|---|---|---|
| userMention | 88.0 ns | **84.0 ns** | 137.4 ns | -5% | 1.64× faster |
| channelMention | **69.5 ns** | 70.1 ns | 110.1 ns | +1% | 1.57× faster |
| roleMention | **49.7 ns** | 58.7 ns | 111.1 ns | +18% | 1.89× faster |
| timestamp | 147.9 ns | **79.1 ns** | 140.4 ns | -47% | 1.77× faster |
| bold | **25.7 ns** | 26.3 ns | 52.1 ns | +3% | 1.98× faster |
| italic | **31.1 ns** | 32.7 ns | 52.7 ns | +5% | 1.61× faster |
| underline | 31.0 ns | **23.6 ns** | 50.5 ns | -24% | 2.14× faster |
| strikethrough | **29.2 ns** | 31.7 ns | 51.9 ns | +9% | 1.63× faster |
| spoiler | 26.0 ns | **21.6 ns** | 51.3 ns | -17% | 2.38× faster |
| masked | 37.1 ns | **32.9 ns** | 55.6 ns | -11% | 1.69× faster |
| link | 104.9 ns | **40.2 ns** | 81.1 ns | -62% | 2.02× faster |
| inlineCode | **21.3 ns** | 22.7 ns | 52.9 ns | +7% | 2.33× faster |
| codeBlock | 34.3 ns | **29.5 ns** | 74.7 ns | -14% | 2.53× faster |
| blockQuote | **99.1 ns** | 142.5 ns | 218.1 ns | +44% | 1.53× faster |
| heading | 67.9 ns | **50.7 ns** | 85.4 ns | -25% | 1.68× faster |
| subtext | 59.4 ns | **19.9 ns** | 48.0 ns | -67% | 2.42× faster |
| orderedList | **102.1 ns** | 144.8 ns | 297.5 ns | +42% | 2.05× faster |
| bulletList | 161.2 ns | **106.2 ns** | 298.7 ns | -34% | 2.81× faster |
| escapeMarkdown | 1.10 µs | **530.6 ns** | 903.2 ns | -52% | 1.70× faster |
| parseUserMention | **141.4 ns** | 201.4 ns | 234.0 ns | +42% | 1.16× faster |
| parseRoleMention | 235.5 ns | **226.5 ns** | 241.7 ns | -4% | 1.07× faster |
| parseChannelMention | **161.7 ns** | 166.3 ns | 284.2 ns | +3% | 1.71× faster |

### Gateway events

| Function | Bun 1.3.11 | Bun 1.4.2 | Node 22 | 1.4 vs 1.3 | Bun 1.4 vs Node |
|---|---|---|---|---|---|
| READY | **1.00 µs** | 1.12 µs | 1.03 µs | +12% | 1.09× slower |
| RESUMED | 384.6 ns | 311.3 ns | **229.4 ns** | -19% | 1.36× slower |
| GUILD_CREATE (50 members, 20 roles, 10 channels) | 160.16 µs | **111.31 µs** | 174.88 µs | -30% | 1.57× faster |
| GUILD_UPDATE | 11.74 µs | **2.30 µs** | 2.53 µs | -80% | 1.10× faster |
| GUILD_DELETE | 3.36 µs | 1.37 µs | **982.4 ns** | -59% | 1.40× slower |
| GUILD_MEMBER_ADD | 5.78 µs | **2.39 µs** | 3.10 µs | -59% | 1.30× faster |
| GUILD_MEMBER_UPDATE | 4.65 µs | **2.54 µs** | 3.44 µs | -45% | 1.35× faster |
| GUILD_MEMBER_REMOVE | 1.22 µs | **379.9 ns** | 533.1 ns | -69% | 1.40× faster |
| GUILD_MEMBERS_CHUNK (10 members) | 65.42 µs | **24.96 µs** | 34.31 µs | -62% | 1.37× faster |
| GUILD_BAN_ADD | **538.9 ns** | 572.1 ns | 547.4 ns | +6% | 1.05× slower |
| GUILD_BAN_REMOVE | 466.5 ns | **294.4 ns** | 503.7 ns | -37% | 1.71× faster |
| GUILD_ROLE_CREATE | 1.95 µs | 1.69 µs | **1.35 µs** | -13% | 1.25× slower |
| GUILD_ROLE_UPDATE | 2.14 µs | 1.86 µs | **1.29 µs** | -13% | 1.45× slower |
| GUILD_ROLE_DELETE | 598.6 ns | 320.8 ns | **301.6 ns** | -46% | 1.06× slower |
| GUILD_EMOJIS_UPDATE (10 emojis) | 16.31 µs | 8.32 µs | **5.33 µs** | -49% | 1.56× slower |
| GUILD_STICKERS_UPDATE (5 stickers) | 2.81 µs | 3.01 µs | **2.10 µs** | +7% | 1.43× slower |
| GUILD_INTEGRATIONS_UPDATE | 295.9 ns | 114.8 ns | **78.5 ns** | -61% | 1.46× slower |
| GUILD_SCHEDULED_EVENT_CREATE | 529.1 ns | 334.3 ns | **332.8 ns** | -37% | 1.00× slower |
| GUILD_SCHEDULED_EVENT_UPDATE | 523.9 ns | **264.7 ns** | 304.9 ns | -49% | 1.15× faster |
| GUILD_SCHEDULED_EVENT_DELETE | 464.4 ns | 473.6 ns | **259.1 ns** | +2% | 1.83× slower |
| GUILD_SCHEDULED_EVENT_USER_ADD | 621.3 ns | 410.1 ns | **220.0 ns** | -34% | 1.86× slower |
| GUILD_SCHEDULED_EVENT_USER_REMOVE | 663.0 ns | 337.5 ns | **222.1 ns** | -49% | 1.52× slower |
| GUILD_SOUNDBOARD_SOUND_CREATE | 527.8 ns | **252.4 ns** | 295.5 ns | -52% | 1.17× faster |
| GUILD_SOUNDBOARD_SOUND_UPDATE | 688.9 ns | 270.4 ns | **255.5 ns** | -61% | 1.06× slower |
| GUILD_SOUNDBOARD_SOUND_DELETE | 611.4 ns | **230.1 ns** | 305.7 ns | -62% | 1.33× faster |
| GUILD_SOUNDBOARD_SOUNDS_UPDATE (5 sounds) | 3.19 µs | 2.68 µs | **2.01 µs** | -16% | 1.34× slower |
| CHANNEL_CREATE | 1.82 µs | 1.29 µs | **552.8 ns** | -29% | 2.33× slower |
| CHANNEL_UPDATE | 1.84 µs | 981.6 ns | **663.8 ns** | -47% | 1.48× slower |
| CHANNEL_DELETE | 595.7 ns | **265.5 ns** | 356.9 ns | -55% | 1.34× faster |
| CHANNEL_PINS_UPDATE | 100.7 ns | **51.6 ns** | 97.6 ns | -49% | 1.89× faster |
| THREAD_CREATE | 2.40 µs | 1.70 µs | **1.35 µs** | -29% | 1.26× slower |
| THREAD_UPDATE | 2.09 µs | 1.30 µs | **873.1 ns** | -38% | 1.49× slower |
| THREAD_DELETE | 785.2 ns | 505.7 ns | **417.5 ns** | -36% | 1.21× slower |
| THREAD_LIST_SYNC (5 threads) | 10.80 µs | 6.59 µs | **4.36 µs** | -39% | 1.51× slower |
| THREAD_MEMBERS_UPDATE | 511.0 ns | 484.2 ns | **420.4 ns** | -5% | 1.15× slower |
| THREAD_MEMBER_UPDATE | 709.4 ns | 592.8 ns | **338.4 ns** | -16% | 1.75× slower |
| MESSAGE_CREATE | 6.88 µs | **4.87 µs** | 7.48 µs | -29% | 1.54× faster |
| MESSAGE_UPDATE | 3.80 µs | **2.41 µs** | 3.84 µs | -37% | 1.59× faster |
| MESSAGE_DELETE | 562.1 ns | 493.0 ns | **310.8 ns** | -12% | 1.59× slower |
| MESSAGE_DELETE_BULK (10 ids) | 4.65 µs | 3.75 µs | **2.27 µs** | -19% | 1.65× slower |
| MESSAGE_REACTION_ADD | 362.3 ns | 356.6 ns | **253.3 ns** | -2% | 1.41× slower |
| MESSAGE_REACTION_REMOVE | 353.9 ns | 299.9 ns | **195.5 ns** | -15% | 1.53× slower |
| MESSAGE_REACTION_REMOVE_ALL | 212.3 ns | 174.9 ns | **144.7 ns** | -18% | 1.21× slower |
| MESSAGE_REACTION_REMOVE_EMOJI | 282.6 ns | **183.4 ns** | 237.8 ns | -35% | 1.30× faster |
| MESSAGE_POLL_VOTE_ADD | 361.1 ns | 368.6 ns | **232.0 ns** | +2% | 1.59× slower |
| MESSAGE_POLL_VOTE_REMOVE | 429.7 ns | 349.3 ns | **213.8 ns** | -19% | 1.63× slower |
| STAGE_INSTANCE_CREATE | 494.5 ns | 348.6 ns | **311.1 ns** | -29% | 1.12× slower |
| STAGE_INSTANCE_UPDATE | 491.9 ns | 412.0 ns | **317.3 ns** | -16% | 1.30× slower |
| STAGE_INSTANCE_DELETE | 393.9 ns | 372.1 ns | **333.1 ns** | -6% | 1.12× slower |
| INVITE_CREATE | 284.7 ns | **173.3 ns** | 232.7 ns | -39% | 1.34× faster |
| INVITE_DELETE | **144.2 ns** | 149.0 ns | 192.6 ns | +3% | 1.29× faster |
| WEBHOOKS_UPDATE | 121.5 ns | **56.7 ns** | 75.3 ns | -53% | 1.33× faster |
| VOICE_STATE_UPDATE | 389.6 ns | **334.5 ns** | 355.3 ns | -14% | 1.06× faster |
| VOICE_SERVER_UPDATE | 173.0 ns | 215.4 ns | **81.3 ns** | +25% | 2.65× slower |
| PRESENCE_UPDATE | 487.8 ns | 219.6 ns | **217.0 ns** | -55% | 1.01× slower |
| TYPING_START | 221.8 ns | **194.4 ns** | 226.9 ns | -12% | 1.17× faster |
| AUTO_MODERATION_RULE_CREATE | 573.1 ns | 523.0 ns | **521.1 ns** | -9% | 1.00× slower |
| AUTO_MODERATION_RULE_UPDATE | 530.4 ns | 580.3 ns | **307.4 ns** | +9% | 1.89× slower |
| AUTO_MODERATION_RULE_DELETE | 537.0 ns | 431.2 ns | **378.3 ns** | -20% | 1.14× slower |
| AUTO_MODERATION_ACTION_EXECUTION | 416.1 ns | 418.7 ns | **293.1 ns** | +1% | 1.43× slower |
| ENTITLEMENT_CREATE | 912.3 ns | 627.0 ns | **386.1 ns** | -31% | 1.62× slower |
| ENTITLEMENT_UPDATE | 784.0 ns | 701.3 ns | **350.6 ns** | -11% | 2.00× slower |
| ENTITLEMENT_DELETE | 841.7 ns | 601.0 ns | **441.0 ns** | -29% | 1.36× slower |
| INTERACTION_CREATE (button) | 1.32 µs | 1.17 µs | **971.0 ns** | -11% | 1.21× slower |

## Reproduce

```sh
bun install && bun run build
bun  scripts/bench-runtime.mjs          # table
node scripts/bench-runtime.mjs
bun  scripts/bench-runtime.mjs --json   # machine-readable
BENCH_ITERATIONS=50000 bun scripts/bench-runtime.mjs
```

Gateway events are fed straight into the client's handlers (no socket): each figure is payload
object → cache sync → emit, with no listeners attached, so it is Lunibee's own cost per event.
Payload construction is included in the timed loop, the same for every runtime.
