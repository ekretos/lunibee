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
| 1B | Gateway architecture: Session, Heartbeat, Reconnect, Transport+Decoder, Protocol **landed**; Dispatcher next | **In progress** |
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

## Stage 1B.2 — landed: `GatewayHeartbeat`

Every liveness timer now lives in one object. `Gateway` lost nine fields
(`#heartbeatTimer`, `#initialHeartbeat`, `#heartbeatAckTimer`, `#heartbeatACK`,
`#heartbeatInterval`, `#heartbeatSentAt`, `#lastMessageAt`, `#zombieTimer`,
`#zombieReported`) and gained one collaborator.

**Owns:** the heartbeat interval and its jittered first beat · the acknowledgement
deadline · the staleness (zombie) watch · measured latency · whether the connection
looks alive.

**Does not own:** the socket, the session, reconnect policy, opcode interpretation,
event emission. It reports through `onTimeout` and `onError`; the Gateway decides
what to close, because only the Gateway owns the socket.

```ts
new GatewayHeartbeat({
    ackTimeout, zombieTimeout,
    send: (sequence) => transport.send(heartbeatPayload(sequence)),
    sequence: () => session.sequence,
    isConnected: () => socketIsOpen(),
    onTimeout: (timeout) => gateway.closeFor(timeout),
    onError: (error) => gateway.emitError(error),
});
```

The staleness deadline stays derived — `max(zombieTimeout, interval + ackTimeout)` —
so a Gateway with a 45s interval is never mistaken for a dead one.

**What this buys:** 16 liveness tests that construct no socket, no Gateway and no
session. The ACK deadline, the send-failure path, single-shot zombie reporting,
silence reset, and the "disconnected socket is never a zombie" rule are now direct
assertions rather than choreography through a fake WebSocket.

## Stage 1B.3 — landed: `GatewayReconnect`

`Gateway` lost `#attempt`, `#reconnectTimer`, `#connectPromise`, `#resolveConnect`,
`#rejectConnect` and `#closeAction`. Close classification also moved out of the class
and into a pure function, so the policy can be asserted without constructing anything.

**Owns:** close classification · whether another attempt is allowed · backoff and
jitter · arming and cancelling the timer · the coordination that keeps at most one
logical connection attempt in flight.

**Does not own:** the socket, session internals (it is *told* `canResume`), the
heartbeat, opcode handling, event emission. `GatewayCloseCodes` moved to its own
module so the policy can import it without a cycle back through `index.ts`.

### The classification table

| Codes | Action | Why |
|---|---|---|
| `4004`, `4010`, `4011`, `4012`, `4013`, `4014` | `stop` | Bad token, shard config, API version or intents — retrying cannot succeed. |
| `4007`, `4009` | `identify` | The session is destroyed; reconnect but start fresh. |
| everything else | `resume` / `identify` | Reconnectable. Which one is decided by whether a session survives, not by the code. |

**`1000` deliberately stays reconnectable.** A table mapping it to "close" would look
tidy and would break `op 9`: after a non-resumable invalid-session the Gateway closes
with `1000` precisely so the next connection re-IDENTIFYs. The regression test pins
this.

### WS-003, fixed

A fatal close now settles the Gateway as `CLOSED` rather than leaving it in `CONNECT`
looking like an attempt was imminent, and a later `connect()` throws. This is a
deliberate behaviour change: an existing test asserted `CONNECT` after `4014`, which
was the bug written down as an expectation. Since `CLOSED` is terminal, recovering
from a fatal close means constructing a new `Gateway` — correct, because the
condition behind `4004`/`4013`/`4014` cannot fix itself in-process.

### The single-attempt invariant

`attempt(start)` invokes `start` exactly once and hands every concurrent caller the
same promise, so three `connect()` calls produce one socket and one shared result.
`schedule()` refuses with `"pending"` while a timer is armed, so a burst of close
events produces one reconnect rather than competing sockets.

## Stage 1B.4 — landed: `WebSocketTransport` + `GatewayDecoder`

`Gateway` no longer holds a `WebSocket`. Socket construction, listener wiring,
sending, closing, replacement and decoding all moved out, and the zlib inflater
(`#inflate`, `#inflateChunks`, `#decompressQueue`) went with them.

**Transport owns:** the socket, its listeners, `send`/`close`/`destroy`, replacement,
and connection-level errors. It never inspects an opcode: frames go out as text and
come back as text.

**Decoder owns:** bytes to complete frames, and nothing else. Malformed *JSON* is not
a decoding failure — that belongs to the protocol seam — but malformed *compressed
bytes* are.

### Generations, again — this time for sockets

Each `connect()` takes a generation and every event is checked against it, so a
replaced socket cannot open, frame, error or close the transport. A socket's
generation is also retired **when it closes**, which is what makes a late frame from
a dead socket stale by construction rather than by a check at each call site.

### Two bugs this seam exposed

1. **A hang in the shipped `compress` path (WS-007, fixed).** zlib does not invoke a
   `write` or `flush` callback once its stream has errored — it emits `error` and
   abandons the callback. The decode promise therefore waited forever on corrupt
   compressed input, wedging the connection with no error and no close. The decoder
   now settles the waiting operation from the `error` handler. Present since the
   WS-001 fix; found by unit-testing the decoder on garbage bytes.
2. **Two timing regressions caught before release.** Moving decoding behind an
   interface made every frame asynchronous, including uncompressed ones, and turned
   transport errors into plain `Error`s. Dispatch timing and error types are both
   observable, so a decoder that can answer synchronously now must, and the Gateway
   re-wraps transport errors as `GatewayError`.

## Stage 1B.5 — landed: `GatewayProtocol`

Opcode interpretation is now a pure translation: frame in, action out. The protocol
performs nothing — no socket, no timers, no session mutation, no emission — which is
why every case is testable with a string and no connection.

```text
frame → classifyFrame() → { sequence, action } → Gateway applies it
```

| Action | Meaning |
|---|---|
| `hello` | `op 10`, with a validated `heartbeatInterval` |
| `dispatch` | `op 0`, with event name and data |
| `heartbeat` / `heartbeat-ack` | `op 1` / `op 11` |
| `reconnect` | `op 7` |
| `invalid-session` | `op 9`, with `resumable` |
| `unknown` | an opcode this version does not act on |
| `invalid` | a malformed frame, with its violation |

**`op 9` is classified, never applied.** The protocol reports `{ resumable }` and the
Gateway decides whether to invalidate the session. Anything other than `d: true` is
read as non-resumable: a wrongly attempted RESUME costs a round trip, a wrongly
skipped IDENTIFY strands the shard.

**Unknown vs invalid is a deliberate split.** Discord adds opcodes, so an unfamiliar
one is ignored — a client that errors on every addition breaks itself. A *malformed*
frame is never swallowed: it produces an `invalid` action carrying its violation, and
the Gateway reports and closes with `1002`.

Outbound payload construction (IDENTIFY, RESUME, HEARTBEAT) moved here too, since
payload shape is protocol. Sending stays with the Gateway.

### The bug this exposed (WS-008, P0 for affected configurations)

`Gateway` validated the *resolved* intent bitfield but stored and identified with the
**resolvable the caller passed**. A bot using the array form — the form the
documentation recommends — sent `"intents": ["Guilds","GuildMessages"]` in IDENTIFY.
Discord answers a non-numeric intents field with close `4013`, which since WS-003 is
fatal, so such a bot never connected at all. `Client` passes intents straight through,
so this reached every consumer of the documented syntax. The Gateway now stores the
resolved bitfield.

Found because `IdentifyOptions.intents` is typed `number`: the compiler rejected the
resolvable at the seam that had been silently forwarding it.

## Stage 1B — remaining, in priority order
2. **`GatewayDispatcher`** — the listener map and emission, leaving `Gateway` as
   orchestration rather than event infrastructure.
3. **`GatewaySendLimiter`** (P2) — `#sendTimestamps` and the 115/60s budget as its
   own primitive. Deliberately after the correctness-critical seams.
4. **`ShardSupervisor`** (Stage 1C) — the restart/backoff policy currently inlined in
   `ClusterManager`, lifted out so `Fleet` can reuse it per `FleetNode`.

## Open architectural debts this direction should absorb

- **REST-003** — the scheduler still allows only one in-flight request per bucket, so
  a bucket with `limit: 5` is used at a fifth of its allowance. The reservation
  primitive from Stage 1A is the foundation for lifting this: once allowance is
  reserved rather than inferred from ordering, parallel sends within a bucket become
  safe. This is the next REST performance item.
- **WS-003 / WS-004** — fatal-close state and the `Gateway` monolith are both resolved
  by the `GatewaySession` extraction above rather than by a rename.
