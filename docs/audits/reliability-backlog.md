# Reliability audit — P0→P3 engineering backlog

_Scope: survival and core-correctness layers — gateway lifecycle, REST rate limiting,
sharding and clustering. Severity is assigned by production impact, not code aesthetics:
a monolithic class is debt (P2/P3); a handshake that silently never sends is P0/P1._

## Severity model

| Priority | Meaning | Action |
|---|---|---|
| **P0 — Critical** | Total outage, data loss/corruption, security failure, or catastrophic protocol failure | Fix immediately |
| **P1 — High** | Major failure on a core path, with a workaround or limited blast radius | Fix next |
| **P2 — Medium** | Real bug, reliability/performance issue, or significant debt | Schedule |
| **P3 — Low** | Minor bug, polish, ergonomics, refactor | Backlog |

## Status summary

| ID | Priority | Component | Title | Status |
|---|---|---|---|---|
| REST-001 | P0 | `packages/rest` | Aborted request permanently deadlocks its bucket queue | **Fixed** |
| WS-001 | P0 | `packages/ws` | `compress: true` decodes nothing — wrong zlib framing + racy reads | **Fixed** |
| WS-002 | P1 | `packages/ws` | IDENTIFY/RESUME starved by the application send budget | **Fixed** |
| SHARD-001 | P1 | `packages/sharding` | No default IDENTIFY pacing between shard starts | **Fixed** |
| CLUSTER-001 | P1 | `packages/sharding` | Crashed cluster child is never restarted or reported | **Fixed** |
| REST-002 | P1 | `packages/rest` | Transport failures never retried despite documented policy | **Fixed** |
| WS-003 | P2 | `packages/ws` | Fatal close leaves state `CONNECT`, not `CLOSED` | Open |
| REST-003 | P2 | `packages/rest` | One in-flight request per bucket caps throughput | Open |
| REST-004 | P2 | `packages/rest` | Routes remapped onto a shared bucket hash do not share a queue | Open |
| CI-001 | P2 | repo | Tests were not executed by CI | **Fixed** |
| WS-004 | P3 | `packages/ws` | `Gateway` is a single 800-line class | Open |

---

## P0 — Survival

### REST-001 · P0 · `packages/rest/src/index.ts`

- **Problem** — An aborted request that was still waiting for its predecessor in the
  per-bucket queue never released its own queue slot, wedging that bucket forever.
- **Evidence** — Three requests on `/channels/1/messages`; the second aborted while
  queued. The third never settled (repro timed out at 3s; every later request on the
  bucket hangs indefinitely).
- **Impact** — Total, permanent loss of one route + major-parameter pair for the
  process lifetime. Any consumer using `AbortSignal` (timeouts, request cancellation,
  shutdown) can trigger it. No recovery short of a restart.
- **Root cause** — `await this.#abortable(previous, …)` sat *above* the `try`, so an
  abort threw past the `finally` that calls `release()`, leaving the gate promise
  pending in `#localQueues` as every subsequent request's predecessor.
- **Fix** — Move the queue wait inside the `try`, so `finally` releases the gate and
  removes the map entry on every exit path.
- **Regression test** — `tests/reliability.p0.test.ts`: abort while queued, and a
  pre-aborted signal; both assert a later request still completes.
- **Risk** — Minimal: control-flow only, no behavioural change on the success path.

### WS-001 · P0 · `packages/ws/src/index.ts`

- **Problem** — With `compress: true` the gateway decoded nothing, and the decode path
  could also interleave and drop frames.
- **Evidence** — Discord's `zlib-stream` is a zlib-wrapped stream (frames start `78 9c`,
  each payload terminated by `00 00 FF FF`). `DecompressionStream("deflate-raw")`
  rejects that header — reproduced: it throws on the first frame. Separately, the old
  reader raced `reader.read()` against a 50 ms timer, so a losing read's value was
  consumed by a dangling promise and lost, and concurrent messages shared one
  reader/writer with no ordering guarantee.
- **Impact** — Every compressed bot receives zero events (total outage), or, had the
  header matched, silently reordered and dropped dispatches — cache corruption.
- **Root cause** — Raw-deflate decoder used for a zlib-wrapped stream, plus a
  timer-based drain instead of the `Z_SYNC_FLUSH` frame boundary.
- **Fix** — Persistent `node:zlib` inflate stream; buffer output until the `00 00 FF FF`
  boundary arrives, then flush with `Z_SYNC_FLUSH` and decode; serialise decodes through
  a promise chain so arrival order is preserved; force `binaryType = "arraybuffer"`,
  with a `Blob` fallback.
- **Regression test** — `tests/reliability.p0.test.ts`: three compressed dispatches
  decode in order; a payload split across two frames is not parsed until its boundary
  arrives, and raises no error meanwhile.
- **Risk** — Low. `node:zlib` is supported under Bun (verified). Uncompressed
  connections are untouched.

## P1 — Core correctness

### WS-002 · P1 · `packages/ws/src/index.ts`

- **Problem** — IDENTIFY and RESUME were sent through the public `send()`, subject to
  the 115-per-60s application send budget.
- **Impact** — A shard that spent its budget (presence spam, `requestGuildMembers`)
  before HELLO silently fails to hand shake: connected, never READY, recovered only by
  the zombie timeout tens of seconds later, then repeating.
- **Root cause** — Only heartbeats were marked privileged; the handshake was treated as
  ordinary application traffic.
- **Fix** — Send IDENTIFY/RESUME via the privileged dispatch path, as heartbeats already
  were. They remain recorded in the budget, so the real Discord limit is still respected.
- **Regression test** — Budget burned with 200 presence updates, then HELLO: IDENTIFY is
  still written to the socket.
- **Risk** — Minimal; the reserved headroom exists for exactly this.

### SHARD-001 · P1 · `packages/sharding/src/index.ts`

- **Problem** — `spawnDelay` defaulted to none, so shards were started back-to-back.
- **Impact** — Discord permits one IDENTIFY per 5s per rate-limit key; a multi-shard bot
  using defaults trips it and gets close `4008` / invalid-session churn on every start.
- **Fix** — Default `spawnDelay` to `ShardManager.IDENTIFY_INTERVAL` (5000 ms), exposed
  as a public constant; `0` opts out; negative/non-finite values throw `RangeError`.
- **Regression test** — Pacing test asserts a 5000 ms wait between shard starts.
- **Risk** — Startup of an N-shard bot now takes `(N-1)×5s` by default. That is the
  protocol-correct behaviour; opt out with `spawnDelay: 0`.

### CLUSTER-001 · P1 · `packages/sharding/src/cluster.ts`

- **Problem** — Cluster children were forked and never supervised.
- **Impact** — A child that crashes (uncaught rejection, OOM kill) takes its shards
  offline permanently and silently; the map still lists the dead process.
- **Fix** — Supervise `exit`: notify `onClusterExit`, and unless the exit came from a
  deliberate `shutdownAll`/`killAll`, re-fork the same shard assignment after
  `restartDelay` (default 5000 ms). `restartOnExit: false` opts out. Restart timers are
  `unref`'d and cancelled on shutdown.
- **Regression test** — Not covered by automated tests: `fork()` is unavailable under
  Bun, which is the suite's runtime (`spawn()` throws there by design). Covered by the
  existing Bun-guard test plus manual Node verification. **Follow-up:** a Node-runtime
  integration job would close this gap.
- **Risk** — Medium: a child that crashes on startup will be re-forked on a 5s loop.
  Bounded-restart backoff is the natural follow-up.

### REST-002 · P1 · `packages/rest/src/index.ts`

- **Problem** — `createRetryPolicy` documented retrying "idempotent transient failures",
  but transport errors arrive as status `0`, which matched neither the `429` nor the
  `5xx` branch — so DNS failures, resets and TLS errors were never retried.
- **Fix** — Status `0` retries for `GET`/`HEAD`/`PUT`/`DELETE` only; unsafe methods are
  still never replayed (a `POST` may have been delivered).
- **Regression test** — Policy matrix over status `0`, `429`, `500` per method.
- **Risk** — Low; bounded by `maxRetries` and restricted to idempotent methods.

## P2 — Reliability & performance (open)

- **WS-003** — A fatal close (`4004`, `4013`, `4014`, …) stops reconnects but leaves
  `state = CONNECT`, which reads as "about to connect" to supervisors. It should settle
  as `CLOSED`, and the reason should be observable.
- **REST-003** — `#localQueues` allows one in-flight request per bucket key, so a bucket
  with `limit: 5` still serialises. Correct, but it caps throughput well below what
  Discord allows; a token-bucket keyed on `remaining` would use the real allowance.
- **REST-004** — When a response reveals the server bucket hash, the request's bucket key
  is remapped but the local queue key stays route-based, so two routes sharing one
  server bucket do not serialise against each other and can 429.
- **MEM-001** — `MemoryRateLimitStore` prunes only on write; a process that goes idle
  keeps every bucket until the next request.

## P3 — Engineering quality (open)

- **WS-004** — `Gateway` is one ~800-line class covering socket, heartbeat, session,
  backoff and compression. Architectural debt, not a defect: split only behind the
  regression tests above.
- **DOC-001** — `compress` is a `Gateway` option not plumbed through `Client`; document
  it or expose it.
