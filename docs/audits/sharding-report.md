# Sharding compatibility audit — `packages/sharding`

_Author: Neha (worker-neha) · Task T6-advanced · 2026-09-03_
_Scope: `packages/sharding/src/{index.ts,cluster.ts,bus.ts}`._

## Summary

Three pieces: `ShardManager` (in-process Gateway shards), `ClusterManager`
(shards distributed across forked child processes), and `ShardBus` (cross-shard
messaging over `BroadcastChannel`). Two correctness bugs were found and **fixed on
this branch**; two larger compatibility gaps are documented and routed to god
because they cross package boundaries.

## Bugs fixed on this branch (owned package, no public-API/naming change)

1. **Auto-scale silently died after the first reshard/respawn.**
   `ShardManager.checkAutoScale` / `ClusterManager.checkAutoScale` gated on
   `this.#options.shardCount !== "auto"`, but `reshard()` / `respawn()` overwrite
   `#options.shardCount` with a concrete **number**. So the first auto-scale event
   permanently disabled all future ones — the exact opposite of "auto".
   **Fix:** capture the auto intent once in an immutable `#auto` flag at construction
   and gate `checkAutoScale` on `#auto`. Behavior otherwise unchanged.
   Regression test: `tests/sharding.integration.test.ts` →
   _"auto-scale keeps running after a reshard"_.
2. **Bun-only `Bun.sleep` broke Node/Discord.js portability.** `index.ts` (spawn
   delay) and `cluster.ts` (cluster stagger) called `Bun.sleep`, which is undefined
   under Node — yet `cluster.ts` already uses `node:child_process`.
   **Fix:** a local runtime-agnostic `sleep = (ms) => new Promise(r => setTimeout(r, ms))`
   in both files. Covered by _"connect() waits spawnDelay between shards"_.

## Discord.js familiarity

| Discord.js | Lunibee | Notes |
|---|---|---|
| `ShardingManager` (spawns processes) | `ClusterManager` | Lunibee splits "process fan-out" (`ClusterManager`) from "in-process shards" (`ShardManager`). |
| `Shard` | `ShardInfo { id, gateway }` | Thin; no per-shard event proxy. |
| `manager.broadcastEval()` / `fetchClientValues()` | — (via `ShardBus.broadcast`) | No eval-broadcast RPC; `ShardBus` is fire-and-forget pub/sub. |
| `'shardCreate'` event | — | No aggregated manager-level events. |
| `client.shard.ids` / `.count` | env `SHARD_LIST`/`SHARD_COUNT`/`CLUSTER_ID` | `ClusterManager` passes identity via env; matches common djs-style worker bootstrap. |

## Open gaps — routed to god (cross-package / design decisions)

1. **`ShardBus` cannot cross forked processes.** `BroadcastChannel` is scoped to a
   single JS agent/process (both Node and Bun). But `ClusterManager` fans shards out
   with `fork()` into **separate processes**, so `ShardBus.broadcast/send` will not
   reach other clusters — cross-cluster messaging is effectively broken for the
   multi-process topology. A real cross-process bus needs `child.send()` /
   `process.on('message')` (or a socket). This is an architecture change spanning the
   parent/worker contract → **needs god sign-off** before I implement, and may want
   Vikram's input on gateway-side identity.
2. **No IDENTIFY concurrency (`max_concurrency`).** `fetchRecommendedShardCount`
   reads only `.shards` and ignores `session_start_limit.max_concurrency`. Discord
   requires shards to IDENTIFY in rate-limit buckets (`shardId % max_concurrency`).
   `ShardManager.connect` uses a flat `spawnDelay` instead. Correct bucketing needs
   coordination with `packages/ws` (Vikram) gateway lifecycle → **route via god.**

## Lower-priority notes (not changed)

- `fetchRecommendedShardCount` is duplicated in both classes and hardcodes
  `User-Agent: Lunibee/0.1.0` (pkg is `0.1.6`). Candidate for a shared helper +
  version constant once conventions define where shared REST/util lives.
- `getShardIdForGuild` divides by `this.shardCount` (live `shards.size`), which is
  `0` on a destroyed manager (guarded by `|| 1`). Fine in steady state; a stored
  total would be more robust during reshard windows.
- No aggregated `ShardManager` events (`shardReady`/`shardDisconnect`) for djs
  parity — deferred to conventions (new public API).

## Verification

- `bun test tests/sharding.*.test.ts` → green (incl. new
  `tests/sharding.integration.test.ts`).
- `bun run typecheck` → exit 0.
