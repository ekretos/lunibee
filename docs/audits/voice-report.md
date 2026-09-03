# Voice compatibility audit — `packages/voice`

_Author: Neha (worker-neha) · Task T6-advanced · 2026-09-03_
_Scope: `packages/voice/src/index.ts` (single-file package)._

## Summary

The voice package is a **transport-independent lifecycle/state layer**, not a full
Discord voice stack. It models `VoiceConnection` (state machine + gateway/UDP
transport slots), an `AudioPlayer` (idle/playing/paused/stopped), an `AudioStream`
wrapper, and a `VoiceReceiver` (SSRC→user demux of inbound RTP). Runtime-specific
gateway/UDP/encryption are intentionally injected via `VoiceGatewayTransport` /
`VoiceUdpTransport` interfaces. Code quality is high (private fields, isolated
listener errors, doc comments). No changes were required for correctness.

## Discord.js familiarity

| Discord.js (`@discordjs/voice`) | Lunibee | Notes |
|---|---|---|
| `VoiceConnection` + `VoiceConnectionStatus` | `VoiceConnection` + `VoiceConnectionState` | Lunibee states are a smaller set (`disconnected/connecting/connected/destroyed`); djs adds `signalling`, `ready`, `reconnecting`. Naming preserved per hive rule. |
| `AudioPlayer` / `AudioPlayerStatus` | `AudioPlayer` / `AudioPlayerState` | djs adds `buffering`/`autopaused`. |
| `createAudioResource` | `new AudioStream(stream, meta)` | Lunibee wraps a `ReadableStream<Uint8Array>` directly. |
| `VoiceReceiver.subscribe(userId)` | `VoiceReceiver.subscribe(userId)` | Matches; returns an `AudioStream` instead of an Opus stream. |
| `entersState()` helper | — | Not present; consumers poll `state`/`stateChange`. |
| `joinVoiceChannel()` | — | No client-integrated join helper (needs core/ws voice-state coordination). |

## Findings (audit-only; no defects fixed)

1. **`setSpeaking` hardcodes `ssrc: 0`** (`index.ts:198`). The op-5 speaking payload
   always sends `ssrc: 0` and `delay: 0`. Real Discord requires the negotiated SSRC
   from the voice-ready handshake. Since this package deliberately has no handshake,
   this is a known limitation of the abstraction, not a bug — flagged for whoever
   wires a concrete gateway transport. **No change made** (would require new API to
   carry the negotiated SSRC).
2. **No encryption / Opus layer.** RTP is only parsed for its 12-byte header
   (`VoiceReceiver.onPacket`, SSRC at byte 8, big-endian — correct). No
   xsalsa20/aead_xchacha20 decrypt, no Opus decode. Expected for an abstraction
   layer; documented as a gap, not a fix.
3. **`AudioPlayer.#pump` busy-polls while paused** (`index.ts:419`) via `setTimeout(25ms)`.
   Functional but not event-driven; a resume-signal promise would be tidier. Low
   priority; left as-is to avoid behavioral risk before conventions land.
4. **Redundant `assertUsable` indirection** — a `private assertUsable()` that only
   forwards to `#assertUsable()` (`index.ts:277`). Harmless; not touched.

## Recommendations (deferred until `api-conventions.md` exists)

- Add `entersState(conn, state, timeoutMs)` helper for djs parity.
- Widen `VoiceConnectionState` to include `reconnecting`/`ready` **only if** the
  architect's naming convention calls for it (do not blind-rename).
- A client-side `joinVoiceChannel` requires Voice State Update / Voice Server Update
  coordination in `packages/core` + `packages/ws` — **cross-package, route via god.**

## Verification

- `bun test tests/voice.test.ts tests/voice.integration.test.ts` → green.
- Added `tests/voice.integration.test.ts`: transport replacement cleanup, op-5
  speaking payload, RTP→stream routing, cleanup error isolation, terminal destroy,
  and the full `AudioPlayer` state machine incl. stream drain→`finish`.
