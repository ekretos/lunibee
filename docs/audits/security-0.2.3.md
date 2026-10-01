# Security review of 0.2.3: status

The review (2026-10-01, tree `039dea1`) found 3 high, 5 medium and 7 low issues.
Every one was reproduced on `dev` before fixing. Severity follows AGENT.md:
high → P1, medium → P2, low → P3. Fixed in **0.2.4**; regression tests are in
`tests/security.p1.test.ts`, `tests/security.p2.test.ts` and `tests/security.p3.test.ts`.

| ID | Sev. | Finding | Fix | Status |
|---|---|---|---|---|
| H1 | P1 | `.`/`..` segments (also `%2e`) in a REST path were resolved, sending the bot token to another route; six methods interpolated raw ids; two skipped token encoding | `REST.request` refuses dot segments, encoded dots and backslashes before any request. `leaveGuild`, `fetchWebhook`, `fetchGuildPreview`, `fetchSticker`, `followUpInteraction` and `removeReaction` use validated `Routes` (new: `currentUserGuild`, `sticker`, `messageReactionUser`); tokens are `encodeURIComponent`'d | Verified |
| H2 | P1 | Webhook/interaction tokens in rate-limit keys (stored in Redis for 7 days); `redactPath` was case-sensitive | Route keys use the redacted path; the webhook major parameter holds a SHA-256 digest of the token; redaction ignores case | Verified |
| H3 | P1 | `resume_gateway_url` was dialed with no host check, and RESUME carries the token | Only `wss:` URLs on `discord.gg` (or a subdomain), or on the fallback gateway's host, are dialed; anything else falls back to the default gateway | Verified |
| M1 | P2 | A caller's `authorization` header was joined with the bot token | Library headers replace any case-variant of the same name; with `auth: false` the caller's header is kept | Verified |
| M2 | P2 | Local permission checks ignored timeouts | `computePermissions({ timedOutUntil })`; `member.permissions`, `permissionsIn()` and `client.permissionsFor()` pass the member's timeout. Discord's rule: only View Channel and Read Message History remain; owners and administrators are exempt (the report also exempted Moderate Members, which Discord's docs do not) | Verified |
| M3 | P2 | `CreateAttachment` reads any path | New `root` option confines the path (symlinks resolved). Without `root` a path is still read as before: refusing absolute paths would break bots attaching their own files. Documented: set `root`, or pass bytes, for any path from users | Mitigated (opt-in) |
| M4 | P2 | IDENTIFY claimed to be the official Android client | Default properties are `os: process.platform`, `browser`/`device: "Lunibee"` | Verified |
| M5 | P2 | Zlib gateway frames had no output limit | One inflated frame is capped (64 MiB default, `ZlibStreamDecoder(create, maxFrameBytes)`); past it the stream fails and the connection resets | Verified |
| L1 | P3 | Webhook URL matched as a substring | Anchored to `https://(ptb.\|canary.)discord(app).com/api(/vN)/webhooks/<id>/<token>` | Verified |
| L2 | P3 | `thread_id` inserted raw into the query | `URLSearchParams` | Verified |
| L3 | P3 | `cdnURL` did not encode the hash | Hash segment is `encodeURIComponent`'d | Verified |
| L4 | P3 | `Client.login` returns the token | Kept for discord.js parity and because changing the return type is breaking; documented on the method | Accepted risk |
| L5 | P3 | Unhandled listener warnings printed messages and stacks verbatim | The client replaces its token with `[token]` in the warning text and stack | Verified |
| L6 | P3 | `ShardBus` does not authenticate messages | It is an in-process channel; code in the same process is already trusted (it can read the token). Not a boundary Lunibee can enforce | Accepted risk |
| L7 | P3 | `link` / `codeBlock` did not escape; mention escaping is opt-in | `link` escapes brackets in the label and encodes `()`, quotes and whitespace in the URL; `codeBlock` breaks inner fences and strips unsafe language text. Mentions: set `allowedMentions: { parse: [] }` on the client (documented) | Verified (mentions: by design) |

Re-running the report's probes on the fixed tree: dot-segment paths are refused
before any request, hooks see `/Webhooks/123/:token`, `authorization` from a
caller is replaced, and an untrusted resume URL connects to the default gateway.
