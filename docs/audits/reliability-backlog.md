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
| WS-005 | P1 | `packages/ws` | `connect()` on a live Gateway opens a duplicate socket | **Fixed** |
| REDIS-001 | P1 | `packages/rest` | Redis outage silently disables rate limiting fleet-wide | **Fixed** |
| CACHE-001 | P2 | `packages/collection` | TTL sweeper keeps the process alive | **Fixed** |
| COLLECT-001 | P2 | `packages/core` | `Collector.next()` leaks a listener per call | **Fixed** |
| WS-006 | P1 | `packages/ws` | Late-decompressed frame from a replaced socket still dispatched | **Fixed** |
| WS-007 | P1 | `packages/ws` | Corrupt compressed data hangs the decode forever | **Fixed** |
| WS-008 | P0 | `packages/ws` | Array/string intents sent unresolved in IDENTIFY; bot never connects | **Fixed** |
| WS-003 | P2 | `packages/ws` | Fatal close leaves state `CONNECT`, not `CLOSED` | **Fixed** |
| REST-003 | P2 | `packages/rest` | One in-flight request per bucket caps throughput | **Fixed** (opt-in `concurrentBuckets`) |
| REST-004 | P1 | `packages/rest` | Routes remapped onto a shared bucket hash do not share a queue | **Fixed** |
| REST-005 | P1 | `packages/rest` | Shared store has no reservation, so workers race the same `remaining` | **Fixed** |
| BUS-001 | P2 | `packages/sharding` | Async shard-message handler rejections are swallowed | **Fixed** (`ShardBus.onError`) |
| REST-006 | P2 | `packages/rest` | 429 without a `Retry-After` header retried with zero delay | **Fixed** |
| CI-001 | P2 | repo | Tests were not executed by CI | **Fixed** |
| WS-004 | P3 | `packages/ws` | `Gateway` is a single 800-line class | **Fixed** (transport, heartbeat, session, reconnect, protocol, decoder, send budget and state modules) |

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

## Second pass — findings against the hardened `dev`

Re-audited REST concurrency, gateway lifecycle, sharding, structures/cache, Bun
compatibility and test adversariality against current `dev`.

**P0: clean.** Nothing in the current state can take a bot down outright; the two
P0s from the first pass (REST-001, WS-001) remain the only ones found, and both
are fixed with regression tests.

### WS-005 · P1 · `packages/ws/src/index.ts`

- **Problem** — `connect()` on an already-connected Gateway opened a second
  WebSocket and abandoned the first, which stayed open and kept dispatching.
- **Evidence** — Probe: two sockets created, the first still `OPEN`, and a
  dispatch emitted on the abandoned socket was still delivered to listeners.
- **Impact** — Two sequence streams interleave into one `#sequence` field, so a
  later RESUME asks Discord to replay from a sequence that never belonged to the
  live session; events are delivered twice; a second IDENTIFY on the same session
  invites close `4005`. Reachable from `login()` called twice, a supervisor
  reconnecting a live shard, or `ShardManager.connect()` called twice — which
  duplicates *every* shard's socket at once.
- **Root cause** — `connect()` only guarded on an in-flight `#connectPromise`,
  not on an existing live socket; `#open` never tore down its predecessor; and
  the message handler did not check that the socket was still the current one.
- **Fix** — `connect()` is idempotent for a connecting/open socket and cancels a
  pending reconnect timer; `#open` closes any predecessor; `open`/`message`
  listeners ignore events from a superseded socket.
- **Regression test** — `tests/reliability.pass2.test.ts`: no second socket, a
  dropped socket's dispatches are ignored, and a manual connect does not race the
  scheduled reconnect into a third socket.
- **Risk** — Low. Behaviour only changes on paths that previously produced a
  duplicate socket.

### REDIS-001 · P1 · `packages/rest/src/redis.ts`

- **Problem** — Every read path answered a Redis failure with `undefined` / `0`,
  which the REST limiter reads as "no limit known — send now". The warning even
  claimed it was "falling back to local limiting"; there was no local state.
- **Impact** — A Redis blip drops the whole fleet to unlimited sending
  simultaneously — mass 429s and the Cloudflare ban that sustained 429 abuse
  earns. Worse than running without a shared store at all.
- **Root cause** — The store was a pure pass-through with no in-process mirror.
- **Fix** — Mirror every write into a `MemoryRateLimitStore` and serve reads from
  it whenever Redis throws, so the documented fallback is real.
- **Regression test** — Outage simulation asserts mirrored bucket/hash/global
  reads, plus an end-to-end check that REST still waits out a known bucket with
  Redis down.
- **Risk** — Low; bounded extra memory, pruned on write. The mirror only reflects
  this process's traffic — correct for a fallback, not a replacement for Redis.

### CACHE-001 · P2 · `packages/collection/src/cache.ts`

A TTL `Cache` created a referenced `setInterval`, so a process could not exit
until `dispose()` was called. The sweeper is now `unref`'d (verified by asserting
`hasRef() === false` on the handle).

### COLLECT-001 · P2 · `packages/core/src/collector.ts`

`Collector.next()` registered `once("collect")` and `once("end")` and removed
neither when the other settled, so polling a long-lived collector in a loop grew
one dangling listener per call until the max-listener warning fired. Each handler
now removes its counterpart.

### Areas checked, no finding worth a ticket

- **Gateway heartbeat/session** — ACK timer, zombie deadline, `op 9` resumable
  handling, `op 7` reconnect and backoff jitter all behave correctly under the
  existing tests; timers are cleared on every close path.
- **Sharding cross-process state** — `ShardBus` self-filtering and targeting are
  correct; `BroadcastChannel` failures surface synchronously to the caller.
- **Structures/Collection** — LRU promotion, bounded eviction and sweep semantics
  are consistent; no stale-reference or serialization defect found.
- **Bun compatibility** — remaining Node dependencies are `node:zlib` (verified
  under Bun), `node:events`, and `child_process.fork`, which is explicitly
  guarded and documented as Node-only.

### WS-006 · P1 · `packages/ws/src/index.ts` (fixed)

- **Problem** — With `compress: true`, decompression is asynchronous. A frame that
  arrived on a socket the Gateway later replaced finished decoding afterwards and was
  still processed: the message listener's `#ws === ws` check had passed before the
  frame was queued, and nothing re-checked at completion.
- **Impact** — Events from an abandoned connection reach listeners, and a stale
  sequence enters the live session, corrupting a later RESUME. Same class as WS-005,
  on the path WS-005's socket check cannot cover.
- **Fix** — `GatewaySession` generation tokens: each connection takes a token,
  `#message` discards any frame whose token no longer owns the session.
- **Regression test** — `tests/gateway.session.test.ts`: a compressed frame delivered
  immediately before the socket is replaced is neither emitted nor allowed into the
  sequence; the following RESUME carries the pre-replacement sequence.
- **Found by** — the Stage 1B session extraction; invisible while ownership was an
  ad-hoc check at each call site.

### WS-007 · P1 · `packages/ws/src/decoder.ts` (fixed)

- **Problem** — On a corrupt zlib stream, `inflate.write`'s callback is never
  invoked: zlib emits `error` and abandons it. The decode awaited that callback, so
  the promise never settled.
- **Impact** — A compressed connection receiving corrupt bytes stopped processing
  frames permanently, with no error raised and no close: the heartbeat's staleness
  watch was the only thing that would eventually notice. Present since the WS-001
  fix.
- **Fix** — The decoder's `error` handler settles whatever operation is waiting.
- **Regression test** — `tests/gateway.transport.test.ts` pushes garbage bytes and
  asserts the promise rejects; a second test proves `reset()` clears the failure so a
  reconnect starts clean.
- **Found by** — unit-testing the decoder in isolation during the Stage 1B.4
  extraction. It hung the test run, which is how it surfaced.

### WS-008 · P0 · `packages/ws/src/index.ts` (fixed)

- **Problem** — `Gateway` resolved the intent resolvable only to *validate* it, then
  stored and identified with the caller's original value.
- **Evidence** — Against the code as shipped at `96d74de`, constructing a Gateway with
  `intents: ["Guilds", "GuildMessages"]` produced an IDENTIFY carrying
  `"intents": ["Guilds","GuildMessages"]` — an array, not a bitfield.
- **Impact** — Discord answers a non-numeric intents field with close `4013`
  (disallowed/invalid intents), which since WS-003 is fatal: the Gateway settles as
  CLOSED and never retries. Any bot using the array or string intent form never
  connected. `Client` forwards intents unchanged, and the documentation recommends the
  array form, so this reached the documented path.
- **Fix** — Store the resolved bitfield in the Gateway's options.
- **Regression test** — `tests/gateway.protocol.test.ts` drives a Gateway constructed
  with the array form to HELLO and asserts the IDENTIFY intents field is the number
  `513`.
- **Found by** — the Stage 1B.5 protocol extraction: `IdentifyOptions.intents` is
  typed `number`, so the compiler rejected the resolvable at the seam that had been
  forwarding it silently.

## P2 — Reliability & performance (open)

- ~~**WS-003**~~ — fixed in Stage 1B.3: a fatal close settles as `CLOSED` and a later
  `connect()` throws. The close `action` (`stop`) is observable on the `close` event.
- **REST-003** — `#localQueues` allows one in-flight request per bucket key, so a bucket
  with `limit: 5` still serialises. Correct, but it caps throughput well below what
  Discord allows; a token-bucket keyed on `remaining` would use the real allowance.
- **REST-004** — When a response reveals the server bucket hash, the request's bucket key
  is remapped but the local queue key stays route-based, so two routes sharing one
  server bucket do not serialise against each other and can 429.
- **MEM-001** — `MemoryRateLimitStore` prunes only on write; a process that goes idle
  keeps every bucket until the next request.
- ~~**REST-005**~~ — fixed in Stage 1A: `RateLimitStore.reserve` atomically consumes
  one unit (Lua server-side for Redis), so allowance is handed to exactly one worker.
- **BUS-001** — `ShardBus` swallows async handler rejections with no error
  channel, so a failing cross-shard handler is invisible.

### REST-006 · P2 · `packages/rest/src/decoder.ts` (fixed)

`retryAfter` read the header as `Number(headers.get("Retry-After"))`. An absent
header is `null`, `Number(null)` is `0`, and `0` passes `Number.isFinite`, so a 429
carrying no `Retry-After` and no body `retry_after` retried with **zero** delay
instead of the documented 1s. Surfaced by unit-testing the decoder in isolation
during the Stage 1 REST decomposition (see `docs/lunibee-2-architecture.md`).

## P3 — Engineering quality (open)

- **WS-004** — `Gateway` is one ~800-line class covering socket, heartbeat, session,
  backoff and compression. Architectural debt, not a defect: split only behind the
  regression tests above.
- **DOC-001** — `compress` is a `Gateway` option not plumbed through `Client`; document
  it or expose it.
