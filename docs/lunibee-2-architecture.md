# Lunibee 2.0 — architecture direction

_Discord API concepts underneath, Lunibee architecture on top. Not a discord.js clone._

## The governing rule

**Change the architecture first; rename afterwards.** Renaming `REST` to `Transport`
while one class still owns routing, limiting, retries, encoding and HTTP buys new
vocabulary and nothing else. Each stage below lands as a real seam — separately
constructible, separately testable — and only then does the public name change.

## Target domains

```text
packages/
├── api/           ├── state/        ├── components/   ├── errors/
├── gateway/       ├── resources/    ├── voice/        └── utils/
├── rest/          ├── interactions/ ├── sharding/
├── runtime/       ├── commands/     ├── builders/
```

## Naming map (destination, not today's code)

| Concept | Today | Lunibee 2.0 |
|---|---|---|
| Entry point | `Client` | `Lunibee` / `LunibeeRuntime` |
| Discord entity | `Guild`, `Message` | `GuildResource`, `MessageResource` |
| Access & control | `GuildManager` | `GuildService` |
| Keyed storage | `Collection` | `Store` (`MemoryStore`, `TTLStore`, `LRUStore`, `RedisStore`) |
| HTTP stack | `REST` | `HttpTransport` behind `DiscordREST` |
| Gateway | `Gateway` | `GatewayRuntime` (Transport / Protocol / Session / Heartbeat / Reconnect / Dispatcher / Shard) |
| Events | `on(...)` | `SignalBus`, `SignalDispatcher` (public `on` stays) |
| Payload builders | `EmbedBuilder` | `EmbedDefinition` (builder names kept as aliases) |
| Horizontal scale | `ShardManager`, `ClusterManager` | `Fleet`, `FleetNode`, `ShardSupervisor`, `ShardRouter` |

Vocabulary that must stay distinct once introduced: **Store** owns data, **Cache** is an
optimization, **State** is authoritative runtime state, **Snapshot** is serialized state.

## Staged migration

| Stage | Content | Status |
|---|---|---|
| 1 | REST pipeline seams behind today's public API | **Landed** |
| 1A | REST distributed correctness: reservation, shared bucket mapping | **Landed** |
| 1B | Gateway architecture: Session **landed**; Heartbeat, Reconnect, Protocol, Transport next | **In progress** |
| 1C | `ShardSupervisor` lifted out of `ClusterManager` | Planned |
| 2 | Store architecture (`Store`, `LocalState` / `SharedState` / `PersistentState`) | Planned |
| 3 | Resource/Service architecture (`GuildResource`, `GuildService`) alongside the old | Planned |
| 4 | New public naming; old names deprecated with aliases and a migration guide | Planned |
| 5 | Lunibee 2.x — clean architecture as the default surface | Planned |

Nothing is rewritten from scratch, and no stage may break the public API before Stage 4.

## Stage 1 — landed: the REST pipeline

The pipeline you sketched is now the actual call path, not a diagram:

```text
Request → RouteKey → RequestScheduler → RateLimiter → HttpTransport → ResponseDecoder → Response
```

| Module | Owns | Explicitly does not own |
|---|---|---|
| `route.ts` | Route normalization, major parameter, bucket keys, query encoding | Any I/O |
| `scheduler.ts` | Per-bucket ordering and slot release | Rate-limit semantics |
| `limiter.ts` | Bucket/global waits, header accounting, hash adoption | Ordering, HTTP |
| `transport.ts` | One HTTP attempt, timeout, cancellation | Retries, limits, decoding |
| `decoder.ts` | Payload decoding, Discord error metadata, Retry-After | Transport, retry decisions |
| `errors.ts` | `RESTError`, abort/sleep primitives shared by the stages | — |

`REST` keeps its exact public surface and is now composition plus the retry loop:
622 lines, down from 852, with the stages individually exported and individually
testable. A new `transport` option injects the HTTP stage, so tests no longer have
to monkey-patch global `fetch` to assert rate-limit or retry behaviour.

**A bug this immediately surfaced (REST-006, fixed):** `retryAfter` read the
`Retry-After` header with `Number(headers.get(...))`. An absent header is `null`,
`Number(null)` is `0`, and `0` is finite — so a 429 carrying no `Retry-After`
retried *immediately* instead of using the documented 1s default. Isolating the
decoder made that a three-line unit test; inside the old class it needed a full
`fetch` stub and had gone unnoticed.

## Stage 1A — landed: distributed REST correctness

### REST-005 — reservation, not observation

`GET remaining` then `UPDATE remaining` cannot arbitrate between workers: three
processes read `remaining: 1` and all three send. The store contract now carries an
optional atomic operation:

```ts
reserve?(key: string): Promise<Reservation> | Reservation;
type Reservation = { granted: true } | { granted: false; retryAfterMs: number };
```

- `MemoryRateLimitStore.reserve` decrements in-process, which is trivially atomic.
- `RedisRateLimitStore.reserve` runs a Lua script server-side, so the read, the
  decrement and the write cannot interleave across workers. It is assigned only when
  the client exposes `eval` — capability by presence, so `RateLimiter.reserves`
  reports what the store can actually do rather than what it hopes to.
- A store without `reserve` keeps the old wait-on-observed-state path, unchanged.
- **Grant, never deadlock:** an unknown bucket or an elapsed window is always granted.
  An unknown bucket is only discovered by sending; refusing would stall the route
  across the entire fleet. A Redis failure likewise falls back to the local mirror.

Proven by three separate worker stores racing one shared server for a single unit:
exactly one grant, two refusals carrying a real wait.

### REST-004 — bucket keys resolve late, not at enqueue

A route learns its bucket hash only from a response, so a request that queued under
its route-derived key could run beside the shared bucket's other traffic once the
hash appeared. `RequestScheduler.runResolved` re-resolves the key at the moment the
slot is acquired and re-queues under the shared hash if it changed (bounded by
`MAX_REMAPS`).

**Honest limit:** a cold-start burst is still not fully preventable. If two routes
that share a hash both start with no hash known, their first requests overlap —
nothing in the process knows they are related until Discord answers. The remap fixes
every request after that first response, which is the steady state. The regression
test asserts exactly this and no more: the discovering request may overlap, the one
queued behind it may not.

## Stage 1B — landed: `GatewaySession`

`Gateway` no longer holds `#sessionId`, `#sequence` or `#resumeURL`. One object owns
session identity and the handshake decision; `Gateway` keeps its exact public API and
its name.

**Owns:** session id · sequence · resume host · session validity · IDENTIFY vs RESUME ·
invalidation · READY activation · surviving a transport replacement.

**Does not own:** the WebSocket, heartbeat timers, reconnect timers, zlib, opcode
dispatch, shard lifecycle, event emission. Those are the following seams, and keeping
them out is what stops the first extraction becoming a second god object.

### Invalid states made unrepresentable

- **Handshake is a discriminated union**, not a boolean over three nullable fields:
  `{ type: "resume", sessionId, sequence, resumeURL } | { type: "identify" }`. A caller
  cannot reach for a session id on the identify branch, so "resume with an undefined
  session" cannot be written.
- **State is `none | established`.** `canResume` is derived, never stored, so the
  session cannot claim to be resumable while missing its resume host.
- **Generations replace ownership checks.** Every connection takes a token from
  `beginConnection()`, and every mutation presents it. A superseded socket holds the
  old token, so its late dispatch cannot advance the live sequence or overwrite the
  session id. Ownership is structural rather than a chain of `if (this.#ws === ws)`
  at each call site.

### Two things the extraction exposed

1. **Sequence placement.** The first modelling attempt stored the sequence inside the
   `established` variant. READY *is* a dispatch: its own `s` is recorded a moment
   before the session exists, so that model discarded the very first sequence and
   silently broke RESUME. The suite caught it immediately. The sequence now lives
   beside the state and is cleared on invalidation.
2. **A real hole in the compressed path (WS-006, fixed).** Decompression is
   asynchronous, so a frame can finish decoding after its socket was replaced — the
   listener's synchronous `#ws === ws` check has already passed by then. Such a frame
   was still dispatched to listeners. `#message` now refuses any frame whose
   generation no longer owns the connection. This is exactly the class of bug the seam
   was extracted to prevent, and it was invisible until the session could be asked.

## Stage 1B — remaining, in priority order

1. **`GatewayHeartbeat` / `GatewayReconnect`** — timer ownership, so the zombie and
   ACK deadlines are testable without a socket.
2. **`GatewayProtocol` / `GatewayTransport`** — opcode handling separated from socket
   mechanics; `GatewayShard` then composes the four. `GatewayReconnect` should ask the
   session via `resumeInfo()` rather than reaching into Gateway fields.
3. **`ShardSupervisor`** (Stage 1C) — the restart/backoff policy currently inlined in
   `ClusterManager`, lifted out so `Fleet` can reuse it per `FleetNode`.

## Open architectural debts this direction should absorb

- **REST-003** — the scheduler still allows only one in-flight request per bucket, so
  a bucket with `limit: 5` is used at a fifth of its allowance. The reservation
  primitive from Stage 1A is the foundation for lifting this: once allowance is
  reserved rather than inferred from ordering, parallel sends within a bucket become
  safe. This is the next REST performance item.
- **WS-003 / WS-004** — fatal-close state and the `Gateway` monolith are both resolved
  by the `GatewaySession` extraction above rather than by a rename.
