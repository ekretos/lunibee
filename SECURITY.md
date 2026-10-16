# Security Policy

## Supported versions

Security fixes go into the latest release line. Older lines get a fix only when
the issue is critical and the backport is small.

| Version | Supported |
| ------- | --------- |
| 0.3.x   | Yes       |
| < 0.3   | No: upgrade to 0.3.x |

## Reporting a vulnerability

Report suspected vulnerabilities **privately**, using GitHub's
[private vulnerability reporting](https://github.com/ekretos/lunibee/security/advisories/new)
on this repository. If that is not available to you, open an issue that says
only that you have a security report and ask for a private channel; do not put
details in it.

Please do not publish exploit details, tokens or a working proof of concept
before a fix is released.

Include:

- the Lunibee version and runtime (Bun or Node version),
- the affected package and, if you know it, the source location,
- steps to reproduce, and what you expected instead,
- the impact you see and any mitigation you know.

## What to expect

1. We acknowledge the report, normally within a few days.
2. We reproduce it, rate it P0 to P3 (see `AGENT.md`) and tell you the rating.
3. We fix the root cause, add a regression test, and describe the impact in the
   changelog without more exploit detail than users need.
4. We release the fix and credit you, if you want to be credited.

Past security fixes are listed in the changelog's Security sections.

## Scope and trust boundaries

- **Bot tokens, webhook tokens and interaction tokens** are secrets. Lunibee
  must not write them to logs, errors, IPC messages or hook arguments.
- **Cluster workers** started by a `ClusterManager` run your code and are
  trusted with the bot token (it is in their environment). The IPC channel
  between a manager and its workers is validated, but it is not a boundary
  against a worker you do not trust.
- **Remote hosts** (`ClusterHost`) authenticate with a shared secret and can
  only be told to run their own configured script with the documented worker
  variables. Use `wss://` (`remote.tls`) on networks you do not control.
- **Discord payloads** are untrusted input.

## What the automated checks do and do not cover

`bun audit` checks the lockfile against known advisories. `scripts/security-scan.ts`
looks for known secret formats (tokens, keys, credentials in URLs) and risky calls
in every tracked file and in every line ever committed. It is a tripwire, not proof:
a secret in an unknown format, split across lines or encrypted is not found.
Dependency review, CodeQL and GitHub secret scanning with push protection run
alongside it, and none replaces the others.

## For contributors

`bun run audit:security` runs the dependency audit, the secret scan and the
risky-API scan. A line that must break a rule carries
a comment such as `// security-ok(shell-exec): runs a fixed command`, which names the rule and gives a reason that is reviewed; it covers only that rule on that line. Never commit
a token, even a revoked one.
