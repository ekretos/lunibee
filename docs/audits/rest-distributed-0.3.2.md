# REST distributed coordination audit (0.3.2)

Scope: `packages/rest` as a multi-process, multi-bot Discord REST client sharing state through
Redis. Base: `v0.3` at `ae6bd65`. Confirmed findings were reproduced (a scratch script against
Redis 7.0.15, or `benchmarks/rest-distributed.ts`) before they were fixed; each has a regression
test. Status: **Verified** = fixed, with a test that fails without the fix or a measured
before/after.

## Baseline (before)

`benchmarks/rest-distributed.ts` (4 buckets × 25 requests per process, limit 5 per 200 ms, 5 ms
latency, Bun 1.4.2, Redis 7.0.15 on localhost, 4 vCPU):

| Scenario | Time | 429s | Redis ops/request |
|---|---|---|---|
| 1 process, Redis | 878 ms | 0 | 9.28 |
| 4 processes, Redis, one bot | 18,514 ms | 180 | 15.21 |
| 4 processes, Redis, two bots | 4,179 ms | 7 | 10.20 |

After: 0 / 0 / 0 429s, 4.28 / 5.4 / 4.6 ops per request, 3.99 s and 1.93 s for the fleets (floors
4 s and 2 s). Full table on the docs page `/core-concepts/distributed-rest#benchmarks`.

## Findings

### R-01 — A refused reservation fell through to an unreserved send
- **Severity:** P0
- **Location:** `limiter.ts` `RateLimiter.acquire`
- **Problem:** after eight refusals the loop ended and `acquire()` returned; the request was sent.
- **Impact:** under contention (a fleet on a hot bucket) requests went out with no reservation.
- **Evidence:** scratch repro: a store refusing eight times → `acquire` resolved.
- **Fix:** loop until granted; refusals without a wait end in a `"coordination"` error after 16;
  total wait bounded by `2 × maxBackoff` (`"rateLimited"`); malformed replies are errors.
- **Regression test:** `rest.coordination.test.ts` "a store that keeps refusing".
- **Status:** Verified

### R-02 — Redis failures silently downgraded to local enforcement
- **Severity:** P1
- **Location:** `redis.ts` every operation (`#onError` → mirror)
- **Problem:** any failure, including of `reserve`, fell back to the local mirror with a
  `console.warn` per call and no state to inspect.
- **Fix:** `failurePolicy` (`degraded-local` default, `fail-closed`), `commandTimeout`, `mode` /
  `diagnostics()`, one log line and one `mode` event per transition, `verify()`, `requireAtomic`.
  Post-response writes never fail a request.
- **Regression test:** `rest.coordination.test.ts` "Redis failures"; `tests/integration` outage
  through a TCP proxy, with reconnect.
- **Status:** Verified

### R-03 — No bot identity in keys
- **Severity:** P0 (cross-tenant limit corruption)
- **Location:** `redis.ts` keys, `limiter.ts` bucket keys, global key
- **Problem:** two bots on one Redis shared every bucket counter and one global limit.
- **Fix:** bucket keys and global scope prefixed by a 16-hex SHA-256 fingerprint
  (`identity.ts`); webhook-token and interaction routes classified as shared; keys versioned
  (`<prefix>v1:`). Raw tokens never stored.
- **Regression test:** "two bots sharing one Redis never share a bucket counter"; integration
  "4 processes, two bots".
- **Status:** Verified

### R-04 — Missing `X-RateLimit-Remaining` read as 0
- **Severity:** P1
- **Location:** `limiter.ts` `applyResponse` (`Number(null)`)
- **Fix:** `headers.ts` parses every header on its own (absent, empty, negative, non-numeric →
  `undefined`); bucket hashes validated.
- **Regression test:** "headers are parsed defensively".
- **Status:** Verified

### R-05 — Global reset could be shortened by a concurrent worker
- **Severity:** P1
- **Location:** `limiter.ts` `noteGlobalReset` (get, max, set)
- **Evidence:** scratch repro: concurrent 60 s and 2 s extends left 2 s.
- **Fix:** `extendGlobalReset` (Lua max on Redis `TIME`); global checked inside the reserve
  script.
- **Regression test:** "concurrent extends … keep the longest" (unit and integration).
- **Status:** Verified

### R-06 — Response merge was a non-atomic read-modify-write, and conditional
- **Severity:** P1
- **Location:** `limiter.ts` `applyResponse` / `store.updateBucket`
- **Problem:** workers raced on the merge; the min/max protection applied only with
  `concurrentBuckets`, and nothing told windows apart.
- **Fix:** `reconcile` (Lua): min within a window, older window (by `X-RateLimit-Reset`) ignored,
  estimates replaced by server resets, 429 recorded on the bucket.
- **Regression test:** "out-of-order responses"; integration "Lua scripts behave like the JS core".
- **Status:** Verified

### R-07 — Unknown and reset buckets let every worker send at once
- **Severity:** P1
- **Location:** `store.ts` / `redis.ts` reserve (granted unknown or elapsed buckets outright)
- **Fix:** a probe placeholder (one request per fleet; others poll every 50 ms; expires after the
  attempt timeout + 1 s; cleared on failure or remap); an elapsed window with a known limit
  reopens at that limit.
- **Regression test:** "an unknown bucket is probed by one request across instances", "burst after
  reset"; integration "exactly one probe across connections".
- **Status:** Verified

### R-08 — Reservation windows used each worker's clock
- **Severity:** P2
- **Location:** `redis.ts` RESERVE_SCRIPT (`ARGV[1] = Date.now()`)
- **Fix:** every script reads `TIME`.
- **Regression test:** unit "a server clock ahead of the client's"; integration "a skewed client
  clock does not move the windows".
- **Status:** Verified

### R-09 — A 429 held its bucket for the whole-second header, and retried on a separate timer
- **Severity:** P2
- **Location:** `limiter.ts` `applyResponse` (header `Retry-After`), `index.ts` retry sleep
- **Fix:** the wait (body `retry_after` → `Retry-After` → `Reset-After` → 1 s) is recorded in the
  store; the retry sleeps only what the policy adds and then waits on the limiter.
- **Regression test:** "429 delays".
- **Status:** Verified

### R-10 — Hash that differs per major parameter (or changes) split a bucket
- **Severity:** P2
- **Location:** `limiter.ts` route-to-hash resolution
- **Evidence:** `benchmarks/rest-buckets.ts` (per-channel hashes) produced 7 429s during this
  work; the test fails with the old resolution (3 overshoots).
- **Fix:** a major parameter's own responses win over the route-level hash.
- **Regression test:** "a route whose hash differs per channel is not split across keys".
- **Status:** Verified

### R-11 — Unbounded queues, no shutdown
- **Severity:** P2
- **Fix:** `maxQueued`, `maxQueuedPerBucket` (`"overloaded"`); `close()` cancels waits, lets sent
  attempts finish.
- **Regression test:** "queues and shutdown".
- **Status:** Verified

### R-12 — Redis op count per request
- **Severity:** P3
- **Problem:** every request read the route hash and every response wrote it (9–15 ops/request).
- **Fix:** in-process route cache; reserve + global in one script. 4.3–5.4 ops/request measured.
- **Status:** Verified

### R-13 — Reaction emoji in route keys
- **Severity:** P3
- **Problem:** one Redis key (7-day TTL) per emoji per route.
- **Fix:** `/reactions/:emoji` in `normalizeRoutePath`.
- **Status:** Verified

### R-14 — A rejected token kept being used
- **Severity:** P2
- **Problem:** after a 401 every later request still went out, each counting towards Discord's
  invalid-request ban.
- **Fix:** `stopOnInvalidToken` (default on): bot-route requests with a 401'd token fail without
  sending until `setToken()`; `diagnostics().invalidRequests` counts 401/403/429 over 10 minutes.
- **Regression test:** `rest.coordination.test.ts` "invalid token guard".
- **Status:** Verified

### R-15 — The global limit was only learned from global 429s
- **Severity:** P1
- **Problem:** a bot spread across many buckets could exceed 50 requests/s; the fleet found out
  from Discord's global 429s.
- **Fix:** `globalLimit` (default 50) counted per bot in the reserve script (Redis) or the memory
  store, with an in-process fallback for stores that cannot count it.
- **Regression test:** "proactive global limit" (unit); integration "the proactive global limit
  holds across processes" (3 processes, fake server at 20/s: control run trips global 429s, limited
  run has 0).
- **Status:** Verified

### R-16 — Out-of-range rate-limit headers were trusted
- **Severity:** P3 (needs a hostile or broken responder, e.g. a proxy)
- **Problem:** an `X-RateLimit-Reset` far in the future became the window id, so every real
  response looked stale and its lower `remaining` was ignored until the state expired; an absurd
  `X-RateLimit-Limit` made the next window effectively unlimited.
- **Fix:** window ids further than `maxBackoff` from now are dropped; limit and remaining above
  100,000 are ignored.
- **Regression test:** `rest.coordination.test.ts` "hostile rate-limit headers".
- **Status:** Verified

Security pass over the new code (0.3.2): `bun run audit:security` clean (secret scan, `bun audit`:
no vulnerabilities); keys and script arguments are passed as `KEYS`/`ARGV`, never interpolated into
Lua; tokens appear only as a 16-hex SHA-256 fingerprint; telemetry routes are redacted; Redis
passwords in the client URL do not reach `diagnostics()` (checked with `Bun.RedisClient`); every
new map is bounded; new regexes are linear.

## Accepted risks / open

- A request that times out or loses its connection keeps its unit spent (it may have reached
  Discord); only certainly-unsent requests are refunded. Conservative by design.
- A probe whose response is lost lets a second probe go: at most two in flight on a new bucket.
- A Discord bucket-hash change can overshoot by the requests reserved under the old key.
- Discord's invalid-request limit (10,000 401/403/429 per 10 min): counted
  (`diagnostics().invalidRequests`); 401s stop the token (`stopOnInvalidToken`). 403/429 do not
  stop requests. Fixed (R-14).
- The proactive global limit (R-15) is a fixed 1 s window: up to 2× the limit can pass around a
  window boundary. Accepted.
- `EVAL` sent the script text each time: fixed, `EVALSHA` with an `EVAL` fallback on `NOSCRIPT`
  (unit test with a script flush; the integration suite runs it against real Redis).
- No cap on the time a request waits before sending: fixed, `maxQueueWait` (kind `"overloaded"`).
- Redis Cluster needs a hash-tagged `prefix`; not tested against a cluster. Open (P3).
