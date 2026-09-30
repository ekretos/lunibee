# Lunibee Roadmap to 1.0.0

Lunibee is at **0.2.1**. This file is the plan from here to **1.0.0**: what 1.0
promises, the releases on the way, and the conditions that make it shippable.
Day-to-day workflow (P0–P3 audits, the release checklist) lives in
[AGENT.md](AGENT.md); the next release's task list lives in
[CLAUDE.md](CLAUDE.md); the step-by-step plan for each minor line lives in
[.roadmap/](.roadmap/README.md).

## What 1.0.0 means

1.0 is a **stability promise**, not a feature count.

- **Semantic versioning from 1.0.** No breaking change to the public API in a
  1.x release. New features ship in minors; fixes in patches.
- **The public API is defined.** Everything exported from `lunibee` and the
  `@lunibee/*` packages is either public (covered by the promise) or marked
  `@internal`/`@experimental` (not covered). The API audit enforces the list.
- **Deprecate, then remove.** Anything replaced in 1.x keeps working with a
  `@deprecated` note and a runtime warning (once), and is removed no earlier
  than 2.0.
- **Everything a common bot needs works end to end**: slash, context-menu and
  prefix commands, components and modals, moderation, caching, sharding across
  processes, and voice playback.
- **Supported runtime**: Bun (the documented minimum version is tested in CI).

1.0 keeps today's names (`Client`, `Guild`, `GuildManager`, `Collection`…),
with the 0.2.2 naming convention: builders `CreateX`, constant sets `…Enum`
(`…Type` for styles). The pre-0.2.2 names are removed in 2.0, not in 1.x.
The renames in [docs/lunibee-2-architecture.md](docs/lunibee-2-architecture.md)
(`GuildResource`, `GuildService`, `Store`, `Fleet`…) are **2.0 work**: its own
staging rule forbids breaking the public API before its Stage 4. The internal
seams that document describes can keep landing during 0.x and 1.x behind the
current names.

## Where 0.2.1 stands

Done and covered by tests (see the changelog and the audit docs):

- REST: rate limits with atomic reservations, Redis store with outage
  fallback, classified errors, token redaction, opt-in concurrent buckets.
- Gateway: zlib-stream, resume/reconnect/heartbeat split into modules,
  duplicate-socket and stale-frame fixes.
- State: Gateway cache sync for guilds, members, roles, emojis, stickers,
  channels, threads, voice states and more; bounded, opt-in message cache.
- Interactions: acknowledgement guard, follow-ups, modals, collectors.
- 0.2.1: `message.member`, member actions, merge-style overwrites, file
  uploads, component/modal collectors, prefix-argument parsing, builder and
  typing fixes.
- The reliability backlog (`docs/audits/reliability-backlog.md`) and the
  discord.js compatibility gaps (`docs/compatibility/remaining-gaps.md`) are
  closed, apart from the decided divergences.

## Gaps between 0.2.1 and 1.0

| Area | Gap today | Where it is recorded |
|---|---|---|
| Interactions | No context-menu type guards or `targetUser`/`targetMessage`; `isChatInputCommand()` is true for every application command | CLAUDE.md (0.2.2) |
| Messages | No client-wide default `allowed_mentions`; `reply()` cannot return the message in one request; `Message` has no stickers, poll or forwarded snapshots | CLAUDE.md (0.2.2) |
| Types | Message and reply options are `Record<string, unknown>`; component payload types (`APIComponent`…) are not exported from `lunibee`; `showModal()` rejects `ModalBuilder.toJSON()` output | CLAUDE.md (0.2.2) |
| Exports | `CDN_BASE` / `cdnURL()` are not exported | CLAUDE.md (0.2.2) |
| Voice | No encryption or Opus layer and `setSpeaking` sends `ssrc: 0`: the package models connections but cannot carry audio | docs/audits/voice-report.md |
| Sharding | `ShardBus` uses `BroadcastChannel`, which does not reach clusters forked into other processes | docs/audits/sharding-report.md |
| Gateway | `GatewayDispatcher` and `GatewaySendLimiter` not yet extracted; `compress` cannot be set from `Client` | lunibee-2-architecture.md, reliability-backlog.md (DOC-001) |
| API surface | No `@internal` / `@experimental` / `@deprecated` markers anywhere yet, so "public API" is not defined | this file |

## Milestones

Each milestone is a normal release following AGENT.md's checklist (CI, coverage
gate, docs build, changelog, upgrade notes).

### 0.2.2 — new names and small, non-breaking fixes

- **Naming (landed on `dev`):** builders are `CreateX` (`ButtonBuilder` →
  `CreateButton`), `…Style` constants are `…Type` (`ButtonStyle` →
  `ButtonType`), `…Type` constants are `…Enum` (`ChannelType` →
  `ChannelEnum`), plus the new `ActivityEnum`. Old names stay as deprecated
  aliases until 2.0. New code, docs and examples use the new names.
- The seven items in [CLAUDE.md](CLAUDE.md): context-menu commands, default
  `allowed_mentions`, CDN exports, `reply({ withResponse })`, `showModal()`
  accepting `toJSON()` output, exported component payload types, and message
  stickers/poll/snapshots.

### 0.3.0 — complete the platform

- **Typed payloads.** Replace `Record<string, unknown>` message, edit, reply
  and follow-up options with typed interfaces (content, embeds, components,
  files, `allowed_mentions`, flags, poll, message reference), keeping unknown
  keys allowed so new Discord fields still pass through.
- **Cross-process `ShardBus`.** A transport over the cluster IPC channel
  (`child.send` / `process.on("message")`) so broadcast, request and respond
  work between forked clusters; `BroadcastChannel` stays for single-process
  setups.
- **Gateway `compress` from `Client`** (DOC-001), and the `GatewayDispatcher`
  and `GatewaySendLimiter` extractions (Stage 1B remainder), behind the
  current API.
- **Missing resource coverage** found by an audit against Discord's current API
  (forum tags and posts, threads' members, polls in `send`, entitlements in
  interactions); each gap is either implemented or listed as not planned.

### 0.4.0 — voice that plays audio

- Voice gateway handshake (IDENTIFY/READY/SELECT_PROTOCOL/SESSION_DESCRIPTION)
  with the negotiated SSRC used everywhere, instead of `ssrc: 0`.
- Transport encryption with Discord's current AEAD modes; Opus encoding and
  decoding (native or WASM dependency chosen by benchmark, optional so bots
  without voice do not pay for it).
- Client-side `joinVoiceChannel` coordinating Voice State / Voice Server
  Update through `core` and `ws`.
- An event-driven `AudioPlayer` (no 25 ms polling while paused).
- End-to-end test against a recorded voice session.

Voice may be marked `@experimental` at 1.0 if this milestone slips; the rest of
1.0 does not wait for it.

### 0.5.0 — the framework layer

Optional first-party packages on top of the core, so bots stop hand-rolling
them: `@lunibee/commands` (one definition for slash, context-menu and prefix,
guards, diffed sync), `@lunibee/components` (persistent custom-id routing),
`@lunibee/handlers` (events from files), CLI project templates, plugins,
metrics hooks and per-cache policies. Detailed in
[.roadmap/0.5.0.md](.roadmap/0.5.0.md).

### 0.9.0 — API freeze (release candidate line)

- Mark the surface: every export is public, `@internal` or `@experimental`;
  the API audit fails on unmarked exports and on removals.
- Resolve every name that 1.x would regret (duplicates such as
  `send`/`sendMessage`, `edit`/`update`) by picking one and deprecating the
  other with a warning.
- Upgrade guide from 0.2.x to 1.0 with every breaking change and its fix.
- Docs: every public class and function has a reference page and a runnable
  example; the generated API docs build without warnings.
- Examples: a complete sample bot (slash + prefix commands, components,
  moderation, sharding) in `examples/`, run in CI.
- Performance: publish the benchmark results (`bun run bench`) for Gateway
  event throughput, REST scheduling and cache memory per guild, and fix
  regressions against 0.2.x.
- Security review: token handling, redaction in errors and logs, input limits
  in builders, and dependency audit.
- `0.9.x` releases only fix bugs found by early adopters (ZedBot included).

### 1.0.0 — stable

Ship when every item below is true.

## 1.0.0 exit criteria

- [ ] 0.2.2, 0.3.0, 0.5.0 and 0.9.0 released; voice either shipped (0.4.0) or marked `@experimental`
- [ ] No open P0 or P1 findings in the audits; P2/P3 findings fixed or tracked
- [ ] Every public export is marked and covered by the API audit
- [ ] No `Record<string, unknown>` in public message/interaction option types
- [ ] Coverage gate at or above today's thresholds (lines 90%, functions 50% per file)
- [ ] Docs build, generated API docs and every example run in CI
- [ ] Upgrade guide 0.2.x → 1.0 published
- [ ] At least one production bot running the release candidate for two weeks without a Lunibee-caused incident
- [ ] Semver and deprecation policy published in the README and docs
- [ ] New constant sets follow the naming convention (`CreateX`, `…Enum`, `…Type` for styles)
- [ ] `CHANGELOG`, package READMEs and `AGENT.md` release target set to 1.0.0

## Not in 1.0

- The 2.0 renames and domain split (`GuildResource`, `GuildService`, `Store`,
  `Fleet`, `SignalBus`…) and the Store architecture (Stages 2–5 of the 2.0
  document).
- Node.js as a supported runtime (it may work; it is not tested).
- Features Discord has not made generally available.
