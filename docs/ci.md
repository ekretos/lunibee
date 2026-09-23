# CI & review

Repository tooling stays outside published `packages/`: CI config lives in
`.github/workflows/`, helper scripts in `scripts/`, benchmarks in `benchmarks/`,
examples in `examples/` and tests in `tests/`.

## GitHub Actions (`.github/workflows/ci.yml`)

Runs on pushes and pull requests to `main`, `master` and `dev`, on Bun 1.3.11:

| Job | Steps |
|---|---|
| Bun typecheck | dependency graph (`check:deps`), `format:check`, per-package `tsc`, root `tsc` |
| Bun test | `ci:test`: `bun test --coverage` (per-file threshold in `bunfig.toml`) and the `packages/testing` compat suite |
| Benchmarks | `bun run bench`; output goes to the job summary; never fails the build |

Run the same checks locally with `bun run ci`.

## Review

Changes land through GitHub pull requests reviewed by maintainers; CI must be
green before merge. See `CONTRIBUTING.md`.
