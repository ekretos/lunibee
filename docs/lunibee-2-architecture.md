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
| 1 | Internal seams behind today's public API: pipeline stages, session, store, supervision | **In progress** |
| 2 | Implementations move behind the seams; old classes become thin facades | Next |
| 3 | New public naming (`GuildResource`, `GuildService`, `Store`) alongside the old | Planned |
| 4 | Old names deprecated with aliases and a migration guide | Planned |
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

## Stage 1 — remaining work, in priority order

1. **`GatewaySession`** — extract session identity (session id, sequence, resume URL,
   IDENTIFY vs RESUME decision) out of `Gateway`. This is the highest-value gateway
   seam: WS-005 (duplicate sockets) and WS-001 (zlib framing) were both lifecycle
   confusions that a session object makes structurally impossible.
2. **`GatewayHeartbeat` / `GatewayReconnect`** — timer ownership, so the zombie and
   ACK deadlines are testable without a socket.
3. **`GatewayProtocol` / `GatewayTransport`** — opcode handling separated from socket
   mechanics; `GatewayShard` then composes the four.
4. **`Store` abstraction** — one interface over `Collection`, `Cache` and the Redis
   rate-limit store, so `LocalState` / `SharedState` / `PersistentState` become
   configuration rather than three unrelated implementations.
5. **`ShardSupervisor`** — the restart/backoff policy currently inlined in
   `ClusterManager`, lifted out so `Fleet` can reuse it per `FleetNode`.

## Open architectural debts this direction should absorb

- **REST-003 / REST-005** — the scheduler allows one in-flight request per bucket and
  the shared store cannot reserve capacity. Both belong to the limiter/scheduler seam
  now that it exists: a token bucket keyed on `remaining`, plus a reservation in the
  distributed store.
- **REST-004** — routes that Discord maps onto one bucket hash still queue separately,
  because the scheduler key is fixed at enqueue time. Addressable now that key
  resolution is a single function.
- **WS-003 / WS-004** — fatal-close state and the `Gateway` monolith are both resolved
  by the `GatewaySession` extraction above rather than by a rename.
