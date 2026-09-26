# CI & review

Repository tooling stays outside published `packages/`: CI config lives in
`.github/workflows/`, helper scripts in `scripts/`, benchmarks in `benchmarks/`,
examples in `examples/` and tests in `tests/`.

## GitHub Actions (`.github/workflows/ci.yml`)

Runs on pushes and pull requests to `main`, `master` and `dev`, on Bun 1.3.11,
installing with `bun install --frozen-lockfile` (`bun.lock` is committed; internal
packages depend on each other via `workspace:*`):

| Job | Steps |
|---|---|
| Bun typecheck | dependency graph (`check:deps`), `format:check`, public API audit (`audit:api`), per-package `tsc`, root `tsc` |
| Bun test | `ci:test`: `bun test --coverage` (per-file threshold in `bunfig.toml`) and the `packages/testing` compat suite |
| Benchmarks | `bun run bench`; output goes to the job summary; never fails the build |

Run the same checks locally with `bun run ci`.

## Review

Changes land through GitHub pull requests reviewed by maintainers; CI must be
green before merge. See `CONTRIBUTING.md`.

## Docs site

`lunibee.js.org` (Astro Starlight) deploys from `master`. Besides the hand-written
guides and `reference/` pages, `starlight-typedoc` generates an API reference from
the TSDoc of the public `lunibee` barrel into `/api/` at build time (the generated
Markdown is gitignored). Build locally with `bun install` at the repo root, then
`bun install && bun run build` in `lunibee.js.org/`.

