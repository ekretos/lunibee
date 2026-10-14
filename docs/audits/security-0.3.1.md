# Security audit: Lunibee v0.3 (0.3.1)

Scope: Gateway, REST, `ShardBus`, `ClusterManager` / `ClusterHost`, caching, builders, CI and releases,
on branch `v0.3`. Method: AGENT.md's three phases (discover, fix with a regression test, verify).
Everything below was reproduced by a test that failed first, or verified by a test or a command, as noted.
No formal penetration test was done, and nothing here ran against Discord itself.

Severity: P0 critical, P1 high, P2 medium, P3 low (AGENT.md).

## Results at a glance

| ID   | Severity | Where      | Status                                                                                                                         |
| ---- | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| S-01 | P1       | Repository | `SECURITY.md` missing. **Fixed**                                                                                               |
| S-02 | P1       | CI         | No dependency, secret or static-analysis gate. **Fixed** (workflow added; branch protection is a repository setting, see Open) |
| S-03 | P2       | REST       | Bot token sent to any `baseURL`, in cleartext, and through redirects. **Fixed**                                                |
| S-04 | P2       | REST       | Webhook tokens in the `cause` of network errors. **Fixed**                                                                     |
| S-05 | P2       | ShardBus   | A reply from the wrong shard resolved a request. **Fixed**                                                                     |
| S-06 | P2       | ShardBus   | `close()` left pending requests and their timers. **Fixed**                                                                    |
| S-07 | P2       | Cluster    | Unbounded unauthenticated host connections. **Fixed**                                                                          |
| S-08 | P2       | CI         | Actions on mutable tags; workflow token permissions implicit. **Fixed**                                                        |
| S-09 | P3       | ShardBus   | One shard counted several times in a broadcast. **Fixed**                                                                      |
| S-10 | P3       | ShardBus   | No envelope validation. **Fixed**                                                                                              |
| S-11 | P3       | Cluster    | Unbounded IDENTIFY requests per worker. **Fixed**                                                                              |
| S-12 | P3       | Gateway    | `connect()` threw synchronously instead of rejecting. **Fixed**                                                                |
| S-13 | P3       | Builders   | An embed over 6000 characters was accepted. **Fixed**                                                                          |

## Second pass

An independent re-read of the same tag raised five points. Each was checked against the code.

| ID   | Severity | Finding                                                         | Verdict                                                         | Status                                                                                                                       |
| ---- | -------- | --------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| R-01 | P1       | The CI workflow did not run `audit:security`                    | Valid: only the separate Security workflow and `bun run ci` did | **Fixed**: a step in `ci.yml`; a planted token makes `bun run audit:security` exit 1 (checked)                               |
| R-02 | P2       | REST `sleep()` and `abortable()` leave `abort` listeners behind | Valid, reproduced: one listener per wait on a reused signal     | **Fixed**, `tests/rest.security.test.ts` counts listeners over 100 requests                                                  |
| R-03 | P1       | Remote clustering allows cleartext WebSockets                   | Valid as a default: `0.0.0.0` without TLS was accepted          | **Fixed**: loopback by default; other addresses need `tls` or `allowInsecure`; hosts need `wss://` or `allowInsecure`        |
| R-04 | P1/P2    | The scanner's coverage has limits                               | Valid: it skipped lines over 4000 characters                    | **Improved**: no line limit; URL credentials and base64 private keys added; scope and limits documented. It stays a tripwire |
| R-05 | P2       | Local IPC has no payload limit                                  | Valid for worker messages relayed by the manager                | **Fixed** at the manager: `maxMessageBytes`                                                                                  |

Remaining after R-05: the worker's own `IpcTransport` receives frames only from its manager, so no limit was added there; a worker that sends a message the manager drops leaves the sender's request to time out (bounded by its timeout and `maxPendingRequests`).

## Findings

### S-01 No security policy (P1)

- **Problem:** no `SECURITY.md`. **Impact:** reporters have no private channel or supported-version statement.
- **Fix:** `SECURITY.md` with supported versions, private reporting, response steps and trust boundaries.
- **Verification:** file present; linked from the changelog.

### S-02 CI is not a security gate (P1)

- **Problem:** CI ran types, format, API audits and tests only.
- **Fix:** `.github/workflows/security.yml`: `bun audit` against the frozen lockfile, `scripts/security-scan.ts --history`
  (secrets and risky APIs in the tree and in every commit), dependency review on pull requests, CodeQL
  (`security-extended`). `bun run ci` also runs `audit:security`. A package smoke test job was added to `ci.yml`.
- **Verification:** `bun audit`: no vulnerabilities (27 packages). The scan found no secret and no risky API in the tree or
  history. The scanner has tests, including a temporary repository whose history holds a removed secret.
  The CodeQL, dependency-review and smoke-test jobs are workflow files that have not run on GitHub yet.

### S-03 `baseURL` could send the bot token anywhere (P2)

- **Problem:** `REST`'s `baseURL` was used as given: `http://`, other schemes, credentials in the URL, a query. `fetch` followed redirects.
- **Impact:** a bad or attacker-influenced configuration leaks `Authorization: Bot …` in cleartext or to another host.
- **Root cause:** no validation at the point where the credential leaves the process.
- **Fix:** `parseBaseURL()`: `https:` only, or `http:` on loopback; credentials, query and fragment refused; the error never repeats
  credentials. `allowInsecureBaseURL` opts in for a trusted proxy. Requests use `redirect: "error"`.
- **Regression test:** `tests/rest.security.test.ts` (10 bad URLs, the opt-in, the redirect option).

### S-04 Webhook tokens in error causes (P2)

- **Problem:** runtimes put the request URL in a failed `fetch` message, and `TransportError` kept that error as its `cause`.
  Webhook and interaction tokens live in the URL.
- **Fix:** the cause is a copy with those tokens removed from message and stack (`sanitizeCause`).
- **Regression test:** the same file asserts neither the bot token nor a webhook token appears in the error, its stack, its
  cause chain, or any hook argument, for 404, 500, 429, a network failure, and an interaction path.

### S-05 Forged reply (P2) and S-09 double counting (P3)

- **Problem:** a reply to a request addressed to shard 1 was accepted from any shard that knew the request ID, and a shard that
  answered a broadcast three times counted three times (ending `expected` early).
- **Fix:** an answer is accepted only from the asked shard, once per shard.
- **Regression tests:** `tests/sharding.bus.security.test.ts` (both failed before the fix).
- **Trust note:** shards in one deployment trust each other with the bot token; this closes a correctness and spoofing hole, not a boundary against a hostile worker.

### S-06 `ShardBus.close()` (P2) and S-10 validation (P3)

- **Problem:** pending requests kept their timers after `close()` and settled only on timeout (reproduced: 5 s for a 60 s wait);
  envelopes were not validated.
- **Fix:** `close()` settles pending requests at once, is idempotent, and sending afterwards fails clearly; `type` and `id` are
  limited to 256 characters, `source` and `target` must be integers.
- **Regression tests:** same file.

### S-07 Host connection flood (P2), S-11 IDENTIFY queue (P3)

- **Fix:** `remote.maxUnauthenticated` (default 16; close code 4429); one waiting IDENTIFY request per shard.
- **Regression tests:** `tests/cluster.remote.test.ts`, "resource limits".

### S-08 Workflow hygiene (P2)

- **Fix:** `permissions: contents: read` on CI; every job has the least it needs; all Actions are pinned to commit SHAs
  (with the tag in a comment; Dependabot's `github-actions` ecosystem keeps them current); checkout does not persist credentials.

### S-12 `Gateway.connect()` (P3)

- **Problem:** on a permanently closed Gateway it threw synchronously although it returns a promise, so `.catch()` and the
  `allSettled` in `ShardManager` never saw it. **Fix:** it returns a rejected promise. Two existing tests changed accordingly.

### S-13 Embed size (P3)

- **Fix:** `CreateEmbed.toJSON()` throws a `RangeError` over 6000 characters in total. **Tests:** `tests/builders.security.test.ts`.

## Verified without a finding

| Area          | What was checked                                                                                                                                                                                                                                                                                               | By                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Dependencies  | `bun audit` on the lockfile                                                                                                                                                                                                                                                                                    | command, 0 vulnerabilities                                   |
| Secrets       | Working tree and all history for tokens, keys, cloud credentials                                                                                                                                                                                                                                               | `scripts/security-scan.ts --history`                         |
| Risky APIs    | `eval`, `new Function`, `exec`, disabled TLS verification, cleartext URLs in `packages/*/src`                                                                                                                                                                                                                  | same scan                                                    |
| REST retries  | POST and PATCH are never replayed; a 4xx other than 429 is never retried; retries and delays are bounded; cancelling during a rate-limit wait stops the request                                                                                                                                                | `tests/rest.security.test.ts`                                |
| Authorization | Exactly one `Authorization` header; a caller's header cannot replace it                                                                                                                                                                                                                                        | same                                                         |
| Gateway       | `close()` twice, mid-connect and after connect; no heartbeats or sockets after `close()`; a second HELLO does not start a second heartbeat loop; listeners are not duplicated by reconnects; malformed frames are reported, the connection is dropped and re-established; an invalidated session re-identifies | `tests/gateway.security.test.ts`                             |
| Collection    | Deadlines exact at the boundary; sliding versus fixed reads; eviction does not resurrect expired entries; `jitter` stays inside `[ttl·(1−j), ttl]` and never reaches zero; size bound under churn                                                                                                              | `tests/collection.security.test.ts`, with a controlled clock |
| Builders      | Length limits of embeds, buttons, selects, rows and commands reject before serialization                                                                                                                                                                                                                       | probe                                                        |
| Cluster       | Restart limits, deliberate shutdown not restarted, no leftover listeners after repeated start and stop, real forked processes, fencing of hosts                                                                                                                                                                | `tests/cluster.*.test.ts`                                    |
| Release       | `bun run publish:all -- --dry-run`; `bun run smoke:install` packs 17 packages, installs `lunibee` into an empty project and imports it                                                                                                                                                                         | commands                                                     |

## Open items and limits

1. **Repository settings** are not files: enable secret scanning with push protection, private vulnerability reporting, and require
   the `Security` and `CI` checks on protected branches. Not verified here.
2. The CodeQL, dependency-review and package-smoke jobs have not run on GitHub; the first run may need tuning.
3. Worker messages are limited at the manager (`maxMessageBytes`), after the runtime has already deserialized them; a hostile local worker can still use memory up to what its own IPC allows. Workers are trusted code.
4. A `ClusterHost` link is authenticated; it is encrypted only with `remote.tls` or a TLS proxy, and plain `ws://` beyond this machine needs `allowInsecure` on both sides.
5. Soak behaviour under sustained load (memory growth, rate-limit queues) is covered by the existing soak and benchmark jobs, not by new tests.

## Third pass — fresh source re-audit (2026-10-13)

This pass re-read the current files on branch `v0.3`, including the security scanner, REST abort helpers, cluster IPC relay, remote protocol, and CI workflow triggers. It was a **source review only**: this session did not execute Bun tests or GitHub Actions, inspect repository branch-protection settings, or run a live penetration test. Historical command/test results above are retained as previously reported, not newly re-verified.

### Status of the second-pass fixes

| ID   | Re-check                                                                                                                                                | Result                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| R-01 | `ci.yml` invokes `bun run audit:security`; `security.yml` checks out full history and invokes `bun scripts/security-scan.ts --history`                  | **Code wiring verified**; workflow execution and required-check settings not verified                                                      |
| R-02 | `sleep()` and `abortable()` remove listeners on normal and abort paths; regression tests count listeners                                                | **Source and test coverage verified**; tests not rerun in this pass                                                                        |
| R-03 | Remote listener defaults to loopback; non-loopback bind requires TLS or explicit opt-in; remote host URL rejects cleartext non-loopback unless opted in | **Source and regression-test coverage verified**                                                                                           |
| R-04 | Scanner has no 4,000-character skip, includes URL credentials and encoded private-key patterns, and documents limitations                               | **Source and test coverage verified**; regex scanning remains a tripwire, not proof of no secrets                                          |
| R-05 | Manager enforces `maxMessageBytes` for payloads it relays                                                                                               | **Partially verified**: a limit exists, but its implementation counts JavaScript string/code-unit length rather than UTF-8 bytes; see R-07 |

### New findings

| ID   | Severity | Location                                                                                                   | Finding                                                                                                                                                                                                                                                                                                                | Status                                                                                                                                                                                                                                                               |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-06 | —        | `.github/workflows/ci.yml`, `.github/workflows/security.yml`                                               | Workflow triggers are intentionally limited to the maintained `master` and `dev` branches; release/tag branches such as `v0.3` are not expected to run CI on every push.                                                                                                                                               | **Accepted design** — confirmed by maintainer; not a defect                                                                                                                                                                                                          |
| R-07 | P2       | `packages/sharding/src/cluster.ts: payloadSize()`; `packages/sharding/src/remote-protocol.ts: parseJson()` | The advertised message/frame limits are named in bytes, but use `string.length` / `JSON.stringify(value).length`. These count UTF-16 code units, not UTF-8 wire bytes. Non-ASCII payloads can therefore exceed the intended byte limit.                                                                                | **Fixed** — limits are UTF-8 bytes: `payloadSize()` uses `Buffer.byteLength`, the host-link parsers check bytes (cheap length test first); tests at the byte boundary for ASCII, CJK and emoji in `tests/cluster.manager.test.ts` and `tests/cluster.remote.test.ts` |
| R-08 | P2       | `scripts/security-scan.ts: OPT_OUT / scanText()`                                                           | Any occurrence of `security-ok: <reason>` anywhere on a line suppresses every rule on that line. The implementation does not verify that the marker is in a comment or that the exception applies only to the matched finding. A string literal or unrelated text on the same line can therefore silence the tripwire. | **Fixed** — an exception must be `security-ok(<rule>): <reason>` in a comment, covers only the named rule and only matches before the comment; strings, other rules and secrets inside the reason are still reported (`tests/security-scan.test.ts`)                 |

#### R-06 — branch-specific CI coverage (accepted design)

The maintainer clarified that automatic CI is wanted only for `master` and `dev`, not every release or feature branch. Therefore, the absence of `v0.3` from workflow push filters is intentional and is **not a finding**. No change to workflow triggers is recommended for this reason. If release verification is needed, run it manually or through a dedicated release workflow; branch protection should be configured for the maintained branches according to the project's policy.

#### R-07 — limits are character counts, not byte counts

Evidence: `payloadSize()` returns `value.length` for strings and `JSON.stringify(value).length` for objects; `parseJson()` rejects based on `text.length`. Those expressions do not measure UTF-8 bytes. This is a mismatch between the API/documented limit and the enforcement unit, not evidence of an unbounded input path: the code still applies a finite character-count cap.

**Fix:** serialize once, measure with `Buffer.byteLength(serialized, "utf8")`, and use that same serialized representation for sending where practical. Add tests around the exact limit with ASCII, CJK, and emoji payloads. Keep in mind that the WebSocket runtime has already received/deserialized some input before application-level validation, and the local IPC runtime deserializes frames before the manager checks them.

#### R-08 — suppression marker is broader than its documentation

Evidence: `scanText()` skips a whole line when `OPT_OUT.test(line)` matches; the regex accepts the marker wherever it appears. This is a scanner robustness issue, not proof that a secret currently exists.

**Fix:** recognize the marker only in supported comment syntax and require the reason to be associated with the specific finding; avoid skipping unrelated rules on that line. Add tests for marker text inside a string, a token plus unrelated marker text, and a valid adjacent comment exception.

### Current re-audit disposition

- **No new P0 finding identified by this source review.** This is not a claim that the repository is vulnerability-free.
- **R-06 is accepted design, not a defect:** automatic CI is intentionally limited to `master` and `dev`; use manual or release-specific verification when needed.
- **R-07 and R-08 are fixed and covered by regression tests.**
- Repository settings remain unverified: secret scanning/push protection, private vulnerability reporting availability, and required status checks need confirmation in GitHub settings.
- No tests, dependency audit, build, or GitHub Actions run was executed as part of this third pass; do not treat the source review as runtime verification.

## Fourth pass — follow-up re-audit (2026-10-13)

This pass re-fetched the current source and the existing audit report after the maintainer clarified the intended workflow policy. This was a source-only review; no test, build, dependency audit, or GitHub Actions run was executed.

### Previous findings rechecked

| ID   | Current verdict     | Evidence                                                                                                      |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| R-06 | **Accepted design** | Excluding the release branch `v0.3` from push triggers is intentional. Do not add every release branch to CI. |
| R-07 | **Fixed**           | See the table above: limits are measured in UTF-8 bytes.                                                      |
| R-08 | **Fixed**           | See the table above: exceptions are rule-scoped and comment-only.                                             |

### R-09 — workflow triggers do not exactly match the requested maintained-branch policy

- **Severity:** P2 (workflow/policy correctness, not a security exploit)
- **Location:** `.github/workflows/ci.yml`, `.github/workflows/security.yml`
- **Problem:** the stated policy is automatic checks only for `master` and `dev`, but the current CI push and pull-request filters list `master` and `main` (not `dev`). The Security workflow push filter lists `master`, `main`, and `dev`, while its unfiltered `pull_request:` trigger runs for pull requests targeting any branch.
- **Impact:** `main` can trigger workflows unexpectedly; `dev` does not get the regular CI workflow on push or targeted pull request; Security runs on PRs beyond the two intended maintained branches.
- **Status:** **Fixed** — `ci.yml` and `security.yml` now trigger on push and pull request for `master` and `dev` only (plus `workflow_dispatch`, and the weekly schedule for Security); `tests/workflows.test.ts` pins the triggers, read-only permissions and SHA-pinned Actions. Branch protection and a live run on GitHub remain unverified.
- **Fix:** if the intended policy applies to both workflows, set push and pull-request branch filters to `[master, dev]` in both files. Keep `schedule` and `workflow_dispatch` if you still want scheduled and manual security checks. Do not add `v0.3` or feature/release branches.
- **Verification:** after changing triggers, inspect the workflow event configuration and confirm with test PRs/pushes to `master`, `dev`, and a non-maintained branch. Branch protection/required checks remain a separate repository setting.

### Updated disposition

- No new P0 finding identified in this source review.
- R-06 remains accepted design: release branches are intentionally excluded from automatic CI.
- R-07 and R-08 are fixed with regression tests.
- R-09 is fixed; the workflows follow the `master` and `dev` policy.
- GitHub repository settings and actual workflow execution remain unverified.

## Fifth pass — audit of `v0.3` at a4b9f63

Every claim was checked against the code first; each fix has a regression test that failed before it.

| ID                                                          | Sev | Status                                                                                        |
| ----------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------- |
| F-C1 worker `error` listener                                | P1  | **Fixed** (`cluster.manager.test.ts`)                                                         |
| F-C2 IdentifyBudget never refills after a long gap          | P2  | **Fixed** (`sharding.coordination.test.ts`)                                                   |
| F-H1 racing `play()`                                        | P2  | **Fixed** (`voice.integration.test.ts`). The sequential-interleave variant did not reproduce. |
| F-A1 unbounded server backoff                               | P3  | **Fixed** (`maxBackoff`)                                                                      |
| F-A2 custom-transport cause unsanitised                     | P3  | **Fixed**                                                                                     |
| F-A3 / F-E2 multipart filename injection                    | P3  | **Fixed**                                                                                     |
| F-A4 `parseBaseURL` raw string                              | P3  | **Fixed**                                                                                     |
| F-B1 sticky decoder failure                                 | P3  | **Fixed** (close 4000, resumes)                                                               |
| F-B2 compress join                                          | P3  | **Fixed**                                                                                     |
| F-B3 zero reconnect delay                                   | P3  | **Fixed** (validated)                                                                         |
| F-E1 `spliceFields`, F-E3 `link()`, F-F1 `__proto__` option | P3  | **Fixed**                                                                                     |
| F-E5 `escapeMarkdown` scope                                 | P3  | **Documented**                                                                                |
| F-G1, F-G2 workflow least privilege                         | P3  | **Fixed**, pinned by `workflows.test.ts`                                                      |
| F-G3 `publish.bat`                                          | P3  | **Fixed** (removed)                                                                           |
| F-G4, F-G5, F-G6 scanner coverage                           | P3  | **Fixed**                                                                                     |
| F-G10 `@types/bun` `latest`                                 | P3  | **Fixed**                                                                                     |
| F-A5 unbounded rate-limit store | P3 | **Fixed** (10,000 entries per map, oldest dropped) |
| F-B4 spoofed lifecycle event names, F-B5 `ownsGuild` throw | P3 | **Fixed** |
| F-C3 relay validation | P3 | **Fixed** (type/id/source checked, only the documented envelope relayed) |
| F-D7 handler isolation, F-E6 `timestamp(1e21)`, F-F2 `__proto__` kind, F-F3 binder path escaping | P3 | **Fixed** |
| F-H3 RTP version check, F-H6 `entersState(Infinity)` | P3 | **Fixed** |
| F-G7 `.gitignore` / `bench:rest` | P3 | **Fixed** |
| F-A6 encoded separators in paths, F-E9 attachment root edges, F-B6 zlib cap test, F-B7 connect deadline (`connectTimeout`) | P3 | **Fixed** |
| F-C4 orphaned workers | P3 | **Fixed** (a forked worker exits when the parent's IPC channel closes) |
| F-D1 partial member erases timeout, F-D6 partial `MESSAGE_UPDATE`, F-D3 `cache.maxMembers`, F-D4 `destroy()` | P3 | **Fixed** |
| F-D2 interaction permissions, F-D5 `isRequestData` heuristics | P3 | **Accepted risk**, documented |
| F-E4 URL schemes, F-E7 option payloads, F-E8 `allowed_mentions` | P3 | **Fixed** |
| F-H2 re-attach, F-H4 subscriber backlog (50 packets), F-H5 registry lifetime | P3 | **Fixed** / documented |
| F-G8 unsigned tags, F-G9 no CI release workflow | P3 | **Accepted risk**: releases are published from the maintainer's workstation |

GitHub repository settings (branch protection, secret scanning) remain unverified.

## Reported after release candidate — builder payload bugs

### B-01 — `CreateThumbnail` emits a payload Discord rejects

- **Severity:** P1 (breaks a common production path: any message with a Thumbnail component fails)
- **Location:** `packages/builders/src/components.ts`, `CreateThumbnail.toJSON()` and `APIThumbnailComponent`
- **Problem:** the builder outputs `{ type: 11, url }`; Discord requires `{ type: 11, media: { url } }`.
- **Impact:** the whole message is rejected with `Invalid Form Body` (50035). Reported by a downstream bot whose now-playing card (song artwork) failed on every send; it works around it with its own helper.
- **Fix:** emit `media: { url }`, with `description` and `spoiler` beside `media` as Discord documents; align `APIThumbnailComponent`.
- **Regression test:** assert the exact `toJSON()` shape.
- **Status:** Fixed — `toJSON()` emits `media: { url }`; exact-shape test in `tests/components-v2.test.ts`.

### B-02 — `CreateMediaGallery` puts `description` inside `media`

- **Severity:** P2
- **Location:** `packages/builders/src/components.ts`, `CreateMediaGallery.addItems()` / `APIMediaGalleryComponent`
- **Problem:** items are `{ media: { url, description } }`; Discord expects `{ media: { url }, description }`.
- **Impact:** descriptions (alt text) are likely dropped silently rather than rejected (reported, not yet confirmed against the API).
- **Fix:** move `description` (and `spoiler`) beside `media`; align the type.
- **Regression test:** assert the exact `toJSON()` shape.
- **Status:** Fixed — `description` and `spoiler` sit beside `media` (the unconfirmed "dropped silently" claim is moot); exact-shape test in `tests/components-v2.test.ts`.

## Found while writing the 0.3.2 reference docs

| ID | Sev | Finding | Status |
| --- | --- | --- | --- |
| D-01 | P2 | `ClusterManager` readiness requires every cluster to be `ready`, so one `failed` cluster keeps `ready()`, `waitForReady` and the `ready` event pending forever, even after `reassignOnGiveUp` moved its shards (`#isReady()` in `cluster.ts`). | Open — documented on the ClusterManager page; check `health().missingShards` meanwhile |
| D-02 | P3 | Shard-bus messages relayed between clusters do not check `source` against the sending cluster (answers to the parent are checked). Workers are trusted code. | Open |
| D-03 | P3 | A spawn frame with an environment variable outside the host's whitelist is dropped as malformed; the coordinator's cluster stays `starting` until `startTimeout`. A stock coordinator never sends one. | Open |
| D-04 | P3 | `joinVoiceChannel()` with an empty `channelId` registers the new connection before `setChannel` throws, leaving a `disconnected` entry in the registry. | Open |
| D-05 | P3 | `VoiceConnection.setSpeaking()` always sends `ssrc: 0`. | Open — documented; send your own op 5 for the real SSRC |
| D-06 | P3 | `killAll()` JSDoc said "force-kills"; it sends SIGTERM without escalation. | Fixed (comment corrected) |
