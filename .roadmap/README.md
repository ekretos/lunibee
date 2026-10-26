# .roadmap

Detailed, step-by-step plans for each Lunibee minor line. [ROADMAP.md](../ROADMAP.md)
is the summary and the 1.0.0 promise; these files are the working plans behind it.

| File | Line | Theme | Status |
|---|---|---|---|
| [0.2.0.md](0.2.0.md) | 0.2.x | Friendlier API, naming, small fixes | 0.2.0 and 0.2.1 released; 0.2.2 in progress on `dev` |
| [0.3.1.md](0.3.1.md) | 0.3.x | Complete the platform: typed payloads, previous state, sharding across processes, Gateway seams | Planned |
| [0.4.0.md](0.4.0.md) | 0.4.x | Voice that plays audio | Delivered on `v0.4`; tag and publish left for the maintainer |
| [0.5.0.md](0.5.0.md) | 0.5.x | Framework layer: commands, components, CLI projects, plugins, observability | Planned |
| [0.6.0.md](0.6.0.md) | 0.6.x | Packages that install anywhere (JS + declarations, boundaries, install smoke tests), voice out of experimental, leak checks in CI | Planned |
| [0.7.0.md](0.7.0.md) | 0.7.x | Discord API coverage (user installs, monetization, soundboard…), fully typed payloads, voice receiving | Planned |
| [0.8.0.md](0.8.0.md) | 0.8.x | Scale and operations: resharding without downtime, resumable sessions across restarts, shared cache, metrics, soak tests | Planned |
| [0.9.0.md](0.9.0.md) | 0.9.x | API freeze, release candidates | Planned |
| [1.0.0.md](1.0.0.md) | 1.0.0 | Stable: exit criteria and release | Planned |

## How to use these files

- Each step is small enough for one pull request into `dev`: code, a test that
  keeps per-file coverage at the CI threshold (lines 90%, functions 50%), and a
  docs update (reference page + changelog entry).
- Tick a step (`- [x]`) in the same PR that lands it, and name the commit.
- A step that turns out to be wrong is struck through with the reason, not deleted.
- Every release ends with the release checklist in [AGENT.md](../AGENT.md); each
  file repeats it as its last section so a release cannot skip it.
- Findings discovered while working are classified P0–P3 (AGENT.md) and either
  fixed in the line or added to its "Tracked" list.

## Conventions every step follows

- Naming (from 0.2.2): builders `CreateX`, constant sets `…Enum`, style sets
  `…Type`; old names stay as `@deprecated` aliases until 0.3.1.
- Layering is enforced by `bun run check:deps`:
  types(0) < structures(1) < managers(2) < core(3) < lunibee(4).
- No breaking change to the public API in a minor unless the file says so and
  the upgrade guide covers it.
- `bun run ci` green before merge: deps, API audit, prettier, typecheck, tests.
