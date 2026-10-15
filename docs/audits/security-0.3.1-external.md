# External security assessment of 0.3.1 (2026-10-15)

Scope: the seven findings of the external report on Lunibee 0.3.1 (LUNIBEE-001 to 007), fixed on
`v0.3` for 0.3.2. Each was reproduced with a scratch script before the fix; each regression test
fails on the old code. Status: **Verified** = fixed, with a passing regression test.

| ID | Report severity | Severity (AGENT.md) | Status |
|---|---|---|---|
| LUNIBEE-001 | Medium | P2 | Verified |
| LUNIBEE-002 | Medium | P2 | Verified |
| LUNIBEE-003 | Medium | P2 | Verified |
| LUNIBEE-004 | Medium | P2 | Verified (residual risk below) |
| LUNIBEE-005 | Low | P3 | Verified |
| LUNIBEE-006 | Low | P3 | Verified |
| LUNIBEE-007 | Low | P3 | Verified |

Tests: `tests/security.lunibee-2026-10.test.ts` (001, 002, 003, 005, 006, 007) and
`tests/cluster.remote.test.ts` (004).

### LUNIBEE-001 — REST path guard bypassed with tab, LF, CR or `#`
- **Location:** `packages/rest/src/index.ts` `assertSafePath`
- **Root cause:** the guard compared raw segments with `.`/`..`; the WHATWG URL parser strips tab,
  LF and CR first, so `.\t.` became `..` and moved the token to another endpoint. `#` cut the path.
- **Fix:** paths containing U+0000–U+0020, U+007F or `#` are refused; decoded segments are checked
  with those characters stripped, so `%09` forms are refused too.
- **Status:** Verified

### LUNIBEE-002 — Prefix channel options accepted other servers' channels and ignored `kinds`
- **Location:** `packages/core/src/commands.ts` `#runPrefix`
- **Root cause:** prefix parsing checked only the snowflake shape; Discord does the scope and kind
  checks for slash options, nothing did for prefix ones.
- **Fix:** `#outOfScope`: a channel (cache, else fetch) must be in the message's guild (in a DM, be
  the DM) and of the option's `kinds`; roles and role mentionables must exist in the guild.
- **Status:** Verified

### LUNIBEE-003 — Placeholder `message.channel` made `editPermissionOverwrite` drop real overwrites
- **Location:** `packages/structures/src/index.ts` `Message`, `packages/managers/src/index.ts`
  `permissionOverwrites`
- **Root cause:** an uncached channel became a stub with empty `permission_overwrites`, which the
  manager trusted as the current list and PUT back.
- **Fix:** the stub is `partial`; the manager fetches for a partial channel; `message.channel` uses
  the cached channel when present; `permissionsFor()` returns `null` for a partial channel (or a
  thread with a partial parent).
- **Status:** Verified

### LUNIBEE-004 — Unauthenticated clients exhausted the coordinator's pre-login slots
- **Location:** `packages/sharding/src/remote.ts` `RemoteListener`
- **Root cause:** a full `maxUnauthenticated` refused new connections, so 16 idle sockets
  re-opened every 10 s kept every host out.
- **Fix:** evict the longest-waiting connection instead of refusing; `maxUnauthenticatedPerAddress`
  (4), `connectionsPerSecond` (10, HTTP 429 before upgrade), `clientAddress` hook, `helloTimeout`
  3 s. `ClusterHost.connect()` retries a first attempt closed with `4429`/`4408` (`connectAttempts`).
- **Regression test:** flood of 6 addresses × 12 sockets; the real host still joins.
- **Residual risk (accepted):** an attacker behind the same address as a host (shared NAT, a proxy
  without `clientAddress`) can still delay it. Mitigation: firewall or a connection-limiting proxy.
- **Status:** Verified

### LUNIBEE-005 — Prefix choices matched case-insensitively but passed through raw
- **Location:** `packages/utils/src/args.ts` `readOne`
- **Fix:** the declared choice value is returned (exact match first).
- **Status:** Verified

### LUNIBEE-006 — `codeBlock()` closed by four or more backticks
- **Location:** `packages/formatters/src/index.ts` `codeBlock`
- **Root cause:** only runs of exactly three backticks were escaped.
- **Fix:** a zero-width space after every backtick followed by another.
- **Status:** Verified

### LUNIBEE-007 — Forum posts ignored the default `allowedMentions`
- **Location:** `packages/managers/src/thread.ts` `createForumPost`
- **Fix:** the message goes through `toRequest(message, allowedMentions)` like every other send.
  Raw `bot.rest` / `bot.api` calls are unchanged and documented as such.
- **Status:** Verified
