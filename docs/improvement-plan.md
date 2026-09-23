# Improvement Plan

_Baseline (dev, 2026-09-23): deps graph valid, typecheck clean, 312/312 tests pass,
90.2% line coverage. All work lands on `dev`._

## Phase 1 — CI & release hygiene (quick wins) — done except 1.2, 1.4

| # | Item | Why |
|---|---|---|
| 1.1 | Run CI on `dev` pushes/PRs (`ci.yml` only triggers on `master`/`main`) | dev changes are currently unvalidated |
| 1.2 | Frozen-lockfile installs — **blocked**: with the isolated linker Bun 1.3.11 adds nested `@lunibee/*` entries to `bun.lock` on every install, so `--frozen-lockfile` always fails | reproducible installs |
| 1.3 | Pin `bun-version` instead of `latest` | avoid surprise breakage |
| 1.4 | Enforce coverage threshold — **deferred to Phase 3**: Bun applies `coverageThreshold` per file, and several files are below 90% | prevent regression |
| 1.5 | Add a lint/format check (`prettier --check`) job | `format` script exists, nothing enforces it |

## Phase 2 — Open reliability backlog (`docs/audits/reliability-backlog.md`)

| ID | Pri | Item |
|---|---|---|
| BUS-001 | P2 | Surface async shard-message handler rejections (emit `error`, don't swallow) |
| REST-003 | P2 | Allow concurrent in-flight requests per bucket up to `remaining` |
| WS-004 | P3 | Split 700-line `Gateway` into transport / heartbeat / session / decoder modules |

Each fix ships with a regression test in `tests/reliability.*.test.ts`.

## Phase 3 — Test coverage gaps

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

## Phase 4 — Compatibility gaps (`docs/compatibility/remaining-gaps.md`)

Re-verify the list (several items appear done: `DiscordAPIError`, `guildAvailable`,
`createdTimestamp`), mark completed items, then implement remaining low-risk additive
aliases first: interaction guards (`isButton`, `isStringSelectMenu`), select-menu builder
aliases, `ContextMenuCommandBuilder`, voice factory wrappers. Breaking items (wrapped
event payloads, channel subclasses) need a design proposal first.

## Phase 5 — Maintainability & docs

- Break up largest modules: `types/src/index.ts` (1176), `core/src/index.ts` (929),
  `structures/src/interactions.ts` (719).
- Generate API reference from TSDoc to keep `lunibee.js.org/reference` in sync.
- Consolidate scattered `ci.md`/`review.md` notes (root, `examples/`, `tests/`,
  `benchmarks/`, `scripts/`) into `docs/`.
- Add benchmark regression tracking to CI (`bench:compare`), non-blocking.

## Order of execution

1 → 2 (BUS-001, REST-003) → 3 → 4 → 2 (WS-004) → 5. Each step: small PR-sized change
on `dev`, `bun run ci` green before push.
