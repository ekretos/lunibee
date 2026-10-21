---
title: Upgrading
description: Code changes needed when upgrading Lunibee from 0.3.3 to 0.4.0.
---

## 0.3.3 → 0.4.0

Only `@lunibee/voice` changed. The 0.3 API carried no audio, so most code built on it is replaced rather than ported.

- **Install the voice peers:**
  - `bun add @snazzah/davey opusscript`;
  - `ffmpeg` on the `PATH`, for anything that is not Ogg/Opus.

  Discord requires DAVE outside stage channels.
- **Join through the client:** `await client.voice.join({ guildId, channelId })` replaces `joinVoiceChannel()` + `attachTransports()`. To use `joinVoiceChannel()` without a Lunibee `Client`, pass an `adapterCreator`.
- **Statuses:** `VoiceConnectionState` → `VoiceConnectionStatus`. `Connected` becomes `"ready"`, a join in progress is `"signalling"` / `"connecting"`, and `disconnected` carries a `disconnectReason`.
- **Resources:**
  - `createAudioResource(stream, metadata)` → `createAudioResource(input, { inputType, metadata, inlineVolume })`;
  - `input` may be a path, URL, bytes or stream;
  - `AudioStream` is gone.
- **Player:**
  - `stopped` is gone (`stop()` goes `idle`); `buffering` and `autopaused` are added.
  - `play()` no longer returns a promise; listen for `finish`.
- **Receiver:** `subscribe(userId)` returns a `ReadableStream<Uint8Array>` of Opus packets instead of an `AudioStream`.
- **Interactions:**
  - Call `followUp()` only after `reply()` or `defer()`.
  - Use `update()` / `deferUpdate()` only on component interactions, or modals opened from a component.
  - Do not call `editReply()` after `showModal()`.
- **Sharding restart limits:** `maxRestarts` now trips for a cluster that keeps crashing with backoff in between. If you raised `window` to work around that, you can lower it again.
- **Gateway:** if you reconnect yourself from a `close` handler, `connect()` now waits for the scheduled backoff.
- **Clusters:** shards are split in contiguous blocks (`[0,1] [2,3]`, not `[0,2] [1,3]`). Look up a shard's cluster with `clusterForShard(id)` instead of computing `id % clusterCount`. A `Client` in a worker needs `gateway: { shardId, shardCount }` with one of `ClusterWorker.current()!.context.shardIds`, or use `ShardManager`.
