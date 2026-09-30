# .roadmap

Detailed, step-by-step plans for each Lunibee minor line. [ROADMAP.md](../ROADMAP.md)
is the summary and the 1.0.0 promise; these files are the working plans behind it.

| File | Line | Theme | Status |
|---|---|---|---|
| [0.2.0.md](0.2.0.md) | 0.2.x | Friendlier API, naming, small fixes | 0.2.0 and 0.2.1 released; 0.2.2 in progress on `dev` |
| [0.3.0.md](0.3.0.md) | 0.3.x | Complete the platform: typed payloads, previous state, sharding across processes, Gateway seams | Planned |
| [0.4.0.md](0.4.0.md) | 0.4.x | Voice that plays audio | Planned |
| [0.5.0.md](0.5.0.md) | 0.5.x | Framework layer: commands, components, CLI projects, plugins, observability | Planned |

After 0.5.x comes the 0.9.0 API freeze and 1.0.0 (see ROADMAP.md).

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
  `…Type`; old names stay as `@deprecated` aliases until 2.0.
- Layering is enforced by `bun run check:deps`:
  types(0) < structures(1) < managers(2) < core(3) < lunibee(4).
- No breaking change to the public API in a minor unless the file says so and
  the upgrade guide covers it.
- `bun run ci` green before merge: deps, API audit, prettier, typecheck, tests.
