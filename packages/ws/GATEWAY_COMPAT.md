# Gateway compatibility report (T3-gateway · Vikram)

Discord.js-familiarity audit of `@lunibee/ws` (`packages/ws/src/index.ts`) against the
Discord Gateway protocol and `discord.js` `WebSocketManager`/`WebSocketShard` semantics.
Follows `docs/compatibility/api-conventions.md`: **additive aliases + behaviour fixes only,
no renames** of Lunibee's canonical `Gateway` surface.

## Model divergence (intentionally-different — preserved)

Lunibee ships a **single-connection `Gateway`**, not a `WebSocketManager` + per-shard
`WebSocketShard` fan-out. Per the gap notes this is ⚑ intentionally-different and was **not**
reshaped. Sharding is expressed via `shardId`/`shardCount` options and the `shard` field on
IDENTIFY. `client.ws` / `client.gateway` both point at the one `Gateway`.

## Audit result — behaviours verified as already correct (PRESERVE)

| Area | Verdict |
|---|---|
| `GatewayOpcodes` names + numeric values | ✅ match Discord exactly |
| HELLO → IDENTIFY, `intents`/`presence`/`shard`/`properties` payload shape | ✅ |
| Heartbeat: initial jitter (`random·interval`), interval timer, `d = sequence` | ✅ |
| Heartbeat ACK tracking + ACK-timeout close (1001) + `ping` (ms) | ✅ |
| Zombie detection (silence past `zombieTimeout`) → close 1001 + `zombie` event | ✅ |
| Sequence tracking from `payload.s`; RESUME sends `{token, session_id, seq}` | ✅ |
| Fatal close codes 4004/4010–4014 → stop; recoverable → resume/identify | ✅ |
| Reconnect backoff: exponential + jitter, `maxReconnectAttempts`, base/max delay | ✅ |
| Send rate budget (115/60s), presence/voice/member gateway commands | ✅ |
| zlib-stream compression (Bun native `DecompressionStream`) | ✅ |

## Fixes applied (behaviour — within `packages/ws`)

1. **Resumable `INVALID_SESSION` now honoured.** Op 9 `d` is a boolean: `true` = session
   resumable. The old handler **always** cleared `sessionId`/`sequence` and closed `1000`,
   so it could *never* resume. Now: `d=true` keeps session state and closes with a non-clean
   code so the lifecycle RESUMEs; `d=false` clears session **and** the resume URL and
   re-IDENTIFYs. Matches Discord/`discord.js`.
2. **RESUMED resets reconnect backoff.** A successful `RESUMED` dispatch now resets the
   attempt counter (like READY), marks state `Ready`, and emits a Discord.js-familiar
   `resumed` event. Previously only READY reset backoff, so a resumed connection that later
   dropped waited on an inflated exponential delay.
3. **Identify-path reconnects drop the stale resume URL.** When a close forces a fresh
   IDENTIFY (4007/4009, or `d=false` invalid session), `resumeURL` is cleared so the
   reconnect targets the **main Gateway**, not the previous session's resume host.
4. **`#closeAction` reads named close codes** (`GatewayCloseCodes.*`) instead of magic
   numbers — no behaviour change, readability only.

## Additive Discord.js-familiar surface (ALIAS / IMPLEMENT)

- `export const GatewayCloseCodes` — Discord-protocol close-code names + numeric values
  (`AuthenticationFailed = 4004`, `InvalidSeq = 4007`, `RateLimited = 4008`,
  `SessionTimedOut = 4009`, `DisallowedIntents = 4014`, …). **IMPLEMENT**, additive.
- `export { GatewayState as Status }` — `discord.js` exposes status via `Status`. **ALIAS**;
  canonical name stays `GatewayState`. ⚠️ **Divergence:** the *values* remain Lunibee's
  string states (`"READY"`), not `discord.js`'s numeric `Status` members. Aliasing the name
  is what the gap requested; renumbering to a numeric enum would be a breaking change to
  Lunibee's own `GatewayState` consumers and was **not** done.

## New events surfaced (additive, camelCase)

`resumed` (on RESUMED). Existing events unchanged: `open`, `ready`, `close` (`{code, action}`),
`error`, `zombie`, `heartbeatAck`, `invalidSession` (now emits the normalized boolean),
`stateChange`, `RAW`, plus every dispatch `t` name.

## Tests

- `packages/ws/src/gateway.compat.test.ts` (new, 7 tests): `Status`/`GatewayCloseCodes`
  surface; resumable vs fatal INVALID_SESSION; RESUMED backoff reset + `resumed` event;
  4009 fresh-identify-to-main-Gateway; 4014 fatal stop.
- `tests/gateway.integration.test.ts` (existing, 16 tests): all still green.

## Proposed `compatibility-matrix.md` updates (routed to Arjun/god — not edited here)

- Gateway row `opcodes/close-codes/Status` 🔧 → ✅ done: `GatewayOpcodes` PRESERVE,
  `GatewayCloseCodes` IMPLEMENT, `Status` ALIAS (value-divergence noted).
- Gateway row `reconnect/resume` → verified; resumable-invalid-session + RESUMED-backoff
  fixes landed.
- Add `remaining-gaps.md` note: `Status` alias is name-only (string values ≠ numeric djs
  `Status`) — intentionally-different.
