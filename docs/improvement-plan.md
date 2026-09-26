# Improvement Plan

_Baseline (dev, 2026-09-23): deps graph valid, typecheck clean, 312/312 tests pass,
90.2% line coverage. All work lands on `dev`._

## Phase 1 — CI & release hygiene (quick wins) — done

| # | Item | Why |
|---|---|---|
| 1.1 | Run CI on `dev` pushes/PRs (`ci.yml` only triggers on `master`/`main`) | dev changes are currently unvalidated |
| 1.2 | Frozen-lockfile installs — **done**: the churn came from internal `file:../x` dependencies; switching them to `workspace:*` makes `bun.lock` stable, so it is committed and CI uses `--frozen-lockfile` | reproducible installs |
| 1.3 | Pin `bun-version` instead of `latest` | avoid surprise breakage |
| 1.4 | Enforce coverage threshold — **done in Phase 3**: per-file `{ lines = 0.9, functions = 0.5 }` in `bunfig.toml` (Bun counts transpiler-generated functions, so a function threshold above 0.5 fails files with 100% line coverage) | prevent regression |
| 1.5 | Add a lint/format check (`prettier --check`) job | `format` script exists, nothing enforces it |

## Phase 2 — Open reliability backlog (`docs/audits/reliability-backlog.md`) — done

| ID | Pri | Item |
|---|---|---|
| BUS-001 | P2 | Surface async shard-message handler rejections (emit `error`, don't swallow) |
| REST-003 | P2 | Allow concurrent in-flight requests per bucket up to `remaining` |
| WS-004 | P3 | Split 700-line `Gateway` into transport / heartbeat / session / decoder modules |

Each fix ships with a regression test in `tests/reliability.*.test.ts`.

## Phase 3 — Test coverage gaps — done (lines 94.4% → 99.5%, functions 90.2% → 96.3%)

Lowest-covered files (lines %):

| File | Cov | Focus |
|---|---|---|
| `sharding/src/cluster.ts` | 25 | child spawn, crash restart, IPC paths |
| `formatters/src/index.ts` | 30 | table-driven tests for every formatter |
| `structures/src/resources.ts` | 39 | resource methods (edit/delete/fetch) via mocked REST |
| `structures/src/index.ts` | 50 | base getters, `toJSON`, snowflake helpers |
| `rest/src/decoder.ts`, `transport.ts` | 50–67 | non-JSON bodies, transport errors |
| `collection/src/index.ts` | 69 | untested Collection utilities |
| `core/src/index.ts` | 80 | event dispatch branches (lines 753–835) |

Also resolve the 5 `test.failing`/`skip`/`todo` markers (e.g. `createdTimestamp`
compat test in `packages/testing` — getter now exists, so flip to `test`).

Outcome: new `tests/coverage.phase3.test.ts` and `tests/sharding.cluster.test.ts`
(mocked `fork`); the 5 `test.failing` compat tests now pass and were flipped, and
`packages/testing` compat tests run in `ci:test`. Bugs found and fixed:
`Emoji` with `id: null` (unicode) threw; `generateInvite` sent `scopes=` instead of
Discord's `scope=`; `fetchInvite`/`fetchGuildTemplate` did not encode the code.

## Phase 4 — Compatibility gaps (`docs/compatibility/remaining-gaps.md`) — done

Re-verify the list (several items appear done: `DiscordAPIError`, `guildAvailable`,
`createdTimestamp`), mark completed items, then implement remaining low-risk additive
aliases first: interaction guards (`isButton`, `isStringSelectMenu`), select-menu builder
aliases, `ContextMenuCommandBuilder`, voice factory wrappers. Breaking items (wrapped
event payloads, channel subclasses) need a design proposal first.

## Phase 5 — Maintainability & docs — done

- Break up largest modules: `types/src/index.ts` (1176), `core/src/index.ts` (929),
  `structures/src/interactions.ts` (719).
- Generate API reference from TSDoc to keep `lunibee.js.org/reference` in sync.
- Consolidate scattered `ci.md`/`review.md` notes (root, `examples/`, `tests/`,
  `benchmarks/`, `scripts/`) into `docs/`.
- Add benchmark regression tracking to CI (`bench:compare`), non-blocking.

## Order of execution

1 → 2 (BUS-001, REST-003) → 3 → 4 → 2 (WS-004) → 5. Each step: small PR-sized change
on `dev`, `bun run ci` green before push.

Phase 4 outcome: all additive aliases/helpers above landed (see the Status block in
`remaining-gaps.md`), tested from the top-level `lunibee` barrel in
`tests/compat.phase4.test.ts`; the rest was finished in the completion pass below.

Phase 5 outcome: split `types/src/index.ts` (→ `gateway.ts`, `gateway-events.ts`),
`structures/src/interactions.ts` (→ `options.ts`), and moved the `ClientEvents` map
next to `ClientEvent` in `core/src/events.ts` (one place per event). Merged nine
one-line CI/review notes into `docs/ci.md` (removing claims of a non-existent
OpenAI review workflow). `bench` now runs `benchmarks/parity.ts` (the old scripts
pointed at missing files) and a non-blocking CI job publishes results to the job
summary. API reference generation was done in the completion pass below.

## Completion pass

- WS-004: `Gateway` send budget and state/error types extracted (`send-budget.ts`,
  `state.ts`), completing the transport/heartbeat/session/reconnect/protocol split.
- `IntentsBitField`; `ShardBus.respond`/`request`/`broadcastRequest`; the four missing
  guild resource managers; channel subclasses with `createChannel()`; fixed
  `GuildMemberManager.ban` dropping its audit-log reason.
- Generated API reference: `starlight-typedoc` (already a docs dependency) now builds
  `/api/` from TSDoc alongside the hand-written pages.
- `audit:api` wired into `bun run ci` and CI (its temp tsconfig resolved no inputs before).
- Wrapped event payloads and `broadcastEval` are recorded as deliberate divergences in
  `known-incompatibilities.md`. No plan items remain open.

