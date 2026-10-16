# Security scan of `v0.3` (0.3.2, 2026-10-16)

Scope: the whole `v0.3` branch at `7be6219`, with a manual review of everything added since the
last audit (`498ab55`): coordinator failover (`leader.ts`), thread workers (`thread.ts`),
`remote.moveClusters`, `ClusterHost` URL lists, the key-loop cache merges, and the smoke test.
Severity per AGENT.md. **Verified** = fixed with a regression test that fails without the fix, or a
re-run of the tool that reported it.

## Automated checks

| Check | Result |
|---|---|
| `bun scripts/security-scan.ts --history` (secrets, risky APIs; tree and every commit on every branch) | Passed |
| `bun audit` (library lockfile, 27 packages) | No vulnerabilities |
| `bun audit` (docs site, `lunibee.js.org`) | 4 found: 3 high, 1 moderate; see S2-03 |
| Grep for `eval`, `new Function`, `shell: true`, `exec*`, `innerHTML`, `__proto__` in `packages/*/src` | Only `RegExp.exec`; nothing to fix |
| Prototype-pollution probe: Gateway payloads with own `__proto__` keys (`GUILD_MEMBER_*`, `MESSAGE_CREATE`) | No global pollution; cached `User` / `GuildMember` keep their prototypes (merges copy structure fields, never raw payload keys) |

## Findings

### S2-01: A leader lock that never answers hangs `shutdownAll()`
- **Severity:** P2
- **Location:** `packages/sharding/src/cluster.ts`, `#lead` and `#resign`
- **Problem:** `lock.acquire()` and `lock.release()` were awaited with no time limit. A shutdown
  waits for a pending start, so a lock whose client queues commands while Redis is unreachable
  kept `shutdownAll()` pending forever.
- **Fix:** both calls are limited to half of `leader.ttl`. A timeout counts as "not acquired",
  is emitted as `error`, and is retried. Renewals were already covered: a leader stands down
  after `ttl / 2` without a successful renewal, whether or not the call returns.
- **Regression test:** `tests/cluster.leader.test.ts`, "a lock that never answers…" and
  "a release that never answers…" (both fail without the fix).
- **Status:** Verified

### S2-02: The coordinator's record of lost hosts was unbounded
- **Severity:** P3 (only hosts that hold the secret can be recorded)
- **Location:** `packages/sharding/src/remote.ts`, `#droppedAt`
- **Fix:** at most 1,000 entries. The oldest go first, and they were fenced long ago.
- **Status:** Verified (code review; the map is also cleared when a host rejoins)

### S2-03: Vulnerable build-time dependencies of the docs site
- **Severity:** P3 (build-time only: the site is static, and none of these run in the library or
  in a bot)
- **Location:** `lunibee.js.org/bun.lock`
- **Problem:** `sharp` 0.35.4 (librsvg, high), `http-cache-semantics` 4.2.0 (high),
  `source-map-js` 1.2.1 (high), `postcss-selector-parser` 6.1.4 (moderate).
- **Fix:** `bun audit fix` within the declared ranges: `sharp` 0.35.5,
  `http-cache-semantics` 4.3.0, `source-map-js` 1.2.2. The docs build passes.
- **Residual (accepted):** `postcss-selector-parser` 6.x is pinned by `postcss-nested@^6` (via
  Starlight → expressive-code). The issue is quadratic parsing of selectors, and the build only
  parses this repository's own CSS. Revisit when expressive-code moves to postcss-nested 7.
- **Status:** Verified (`bun audit`: 1 moderate left)

### S2-04: The smoke test's fake Discord listened on every interface
- **Severity:** P3 (CI or a developer machine, fake data only)
- **Location:** `scripts/smoke-cluster.ts`
- **Fix:** binds `127.0.0.1`.
- **Status:** Verified (smoke test re-run)

## Reviewed, no finding

- **`RedisLeaderLock`:**
  - the key and token are passed as `KEYS`/`ARGV`, never in the script;
  - take, extend and release are each one atomic script, and the token is a random UUID;
  - a holder cannot release another holder's lock.
- **Failover fencing:**
  - the leader stands down (SIGKILL every cluster, then close the listener) by 3/4 of `ttl` after its last renewal, before the lock can lapse;
  - a new leader waits two leases before placing clusters;
  - the documented limit: a blocked event loop.
- **`moveClusters`:**
  - nothing moves until the lost host has certainly fenced;
  - only authenticated hosts receive clusters, and the worker contract carries no token.
- **`ClusterHost` URL lists:** every URL is checked like a single one (`ws://` only to this machine
  without `allowInsecure`, no credentials), with at most 16.
- **`threadFork`:** threads get the same environment a fork would, run the same script, and only
  `message` frames cross the boundary.
- **LUNIBEE-001 to 007 (2026-10-15):** re-checked; the regression tests still pass.

## Open

- Repository settings (secret scanning with push protection, private vulnerability reporting,
  required checks) cannot be checked from here.
- Redis Cluster is untested (P3, `rest-distributed-0.3.2.md`).
