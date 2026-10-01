# AGENT.md — Lunibee Engineering Workflow

## Scope

This file defines the workflow for future Lunibee development, maintenance, security review, bug hunting, and release work.

The goal is to keep changes systematic and prevent known issues from being forgotten between releases.

## Release Target

Current release target: **v0.2.3**

When working on a release:

1. Confirm the package version in the root `package.json`.
2. Confirm all published workspace packages use the same release version.
3. Confirm documentation and examples use the current release version where they describe release-specific behavior.
4. Update the changelog with breaking changes, features, fixes, documentation changes, and testing notes.
5. Run the relevant CI checks before considering the release complete.
6. Verify the documentation site builds successfully.
7. Verify the deployed documentation reflects the intended release.

Never silently mix unreleased behavior into an older release section.

## Three-Phase Audit Workflow

Every substantial change or release audit should follow these phases.

### Phase 1 — Discovery / Audit

Inspect the whole affected code path before editing.

Check:

- API behavior and backwards compatibility
- TypeScript type safety
- Gateway lifecycle and reconnect/resume behavior
- REST rate limiting, retries, cancellation, and error handling
- caching, TTL, LRU behavior, and memory growth
- managers and structure synchronization
- interactions and acknowledgement state
- permissions and security boundaries
- sharding and concurrency limits
- voice lifecycle and resource cleanup
- public exports and package boundaries
- generated declarations
- tests and coverage
- documentation/examples
- dependency and build configuration

Classify every actionable finding as **P0, P1, P2, or P3**.

### Phase 2 — Fix

Fix findings in severity order, but do not blindly patch symptoms.

For every finding:

1. Identify the root cause.
2. Explain the affected behavior.
3. Produce the smallest safe fix.
4. Add or update a regression test.
5. Check related code paths for the same failure mode.
6. Re-run the appropriate checks.
7. Update documentation when public behavior changes.

Do not downgrade severity merely because a workaround exists.

### Phase 3 — Verification / Release Gate

After fixes:

- run dependency/API audits
- run formatting checks
- run TypeScript checks
- run the test suite and coverage checks
- run the build and declaration build
- build the documentation site
- inspect generated/public API output
- re-check the original P0/P1/P2/P3 findings
- verify no regression was introduced
- update the changelog

Only mark a finding resolved when the fix is verified by code, tests, or a reproducible validation step.

## Severity Model

### P0 — Critical

Immediate security, data-loss, production-outage, authentication/authorization, catastrophic corruption, or system-wide failure.

Examples:

- credential/token exposure
- authentication bypass
- privilege escalation
- uncontrolled destructive behavior
- gateway/shard behavior that can take down production bots
- severe resource exhaustion with realistic exploitation

**Action:** stop unrelated work and fix first.

### P1 — High

Major correctness, reliability, security, or compatibility issue that can materially affect production users.

Examples:

- broken reconnect/resume behavior
- incorrect rate-limit handling
- significant memory/resource leak
- incorrect permissions
- public API behavior that breaks common production usage
- serious cache synchronization corruption

**Action:** fix before release when applicable.

### P2 — Medium

Important defect with limited scope, edge-case correctness problem, developer-experience issue, or maintainability problem that can affect users under specific conditions.

Examples:

- incomplete edge-case handling
- incorrect error propagation
- stale cache state in a narrow path
- missing regression coverage
- documentation/API mismatch

**Action:** fix in the current release when practical or track explicitly.

### P3 — Low

Minor correctness, documentation, consistency, optimization, or cleanup issue.

Examples:

- wording/documentation errors
- non-critical refactoring opportunities
- minor performance improvements
- cosmetic inconsistencies

**Action:** fix when appropriate without blocking critical work.

## Finding Format

Use this format for audit findings:

- **Severity:** P0 / P1 / P2 / P3
- **Location:** file and relevant symbol
- **Problem:** what is wrong
- **Impact:** what users or systems can experience
- **Root cause:** why it happens
- **Evidence:** test, trace, reproduction, or code path
- **Fix:** proposed implementation
- **Regression test:** how the fix is verified
- **Status:** Open / Fixed / Verified / Accepted Risk

Do not report speculative issues as confirmed bugs. Clearly distinguish confirmed findings from hypotheses.

## Security Rules

Treat tokens, webhook tokens, interaction tokens, credentials, user data, and authorization state as sensitive.

Audit for:

- authentication and authorization bypasses
- token leakage
- unsafe logging
- path/header/query injection
- SSRF
- unsafe URL handling
- unbounded input
- denial-of-service vectors
- permission calculation errors
- cross-guild or cross-user data leakage
- unsafe deserialization
- dependency supply-chain risks

Secrets must never be committed or printed in tests/logs.

## Compatibility Rules

Lunibee is a public Discord API library.

Before changing public behavior:

- identify affected exports
- identify affected types
- identify runtime behavior
- identify migration requirements
- update the upgrading guide when necessary
- add regression coverage

Breaking changes belong in the appropriate release section and must not be hidden as ordinary bug fixes.

## Cache / Lifecycle Rules

Any cache or manager change must consider:

- bounded memory
- TTL semantics
- LRU eviction
- in-place updates vs replacement
- Gateway update ordering
- fetch races
- deletes and stale fetch completion
- cleanup timers
- process shutdown
- object ownership and references

Any lifecycle change should include a leak/regression check where relevant.

## Release Checklist

Before declaring a release complete:

- [ ] Root package version is correct
- [ ] Workspace package versions are correct
- [ ] Changelog is updated
- [ ] Breaking changes are documented
- [ ] Upgrade guide is updated when required
- [ ] Public examples use the correct release version
- [ ] P0 findings are resolved and verified
- [ ] P1 findings are resolved and verified
- [ ] P2 findings are resolved or explicitly tracked
- [ ] P3 findings are resolved or explicitly tracked
- [ ] Dependency graph check passes
- [ ] API audit passes
- [ ] Formatting check passes
- [ ] Typecheck passes
- [ ] Tests and coverage pass
- [ ] Production build passes
- [ ] DTS build passes
- [ ] Documentation build passes
- [ ] Generated API docs are valid
- [ ] Final smoke test passes

## Working Principle

**Audit first → classify P0/P1/P2/P3 → fix root causes → add regression tests → verify → document → release.**

Do not rely on memory for unresolved findings. Keep the state of future work in this file, the changelog, tests, or tracked issues so another coding session can continue safely.
