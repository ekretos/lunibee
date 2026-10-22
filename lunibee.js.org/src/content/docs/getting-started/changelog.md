---
title: Changelog
description: Lunibee version history and release notes.
---

## v0.4.0

Voice that plays audio: a bot can join a voice channel, play a file or stream, and receive audio, end to end and end-to-end encrypted.

### ⚠️ Breaking

- **`@lunibee/voice` is rewritten.** The 0.3 package modelled connections but carried no audio. See [Upgrading](/getting-started/upgrading/#033--040):
  - `VoiceConnectionState` is gone; `VoiceConnectionStatus` has the values `signalling`, `connecting`, `ready`, `disconnected` and `destroyed`.
  - `attachTransports()`, `AudioStream`, `VoiceUdpTransport` and `VoiceGatewayTransport` are removed: the package speaks the voice gateway and UDP itself.
  - `joinVoiceChannel()` needs an `adapterCreator`; with a Lunibee `Client`, use `client.voice.join()`.
  - `createAudioResource(input, options?)` takes a path, URL, bytes or stream, and returns an `AudioResource`.
  - The player's statuses are `idle`, `buffering`, `playing`, `paused` and `autopaused`; `stopped` is gone, and `play()` is synchronous.
  - `receiver.subscribe(userId, options?)` returns a `ReadableStream` of Opus packets.

### ⚠️ Changed (reliability audit)

- **Clusters split shards in contiguous blocks** (they were dealt round-robin):
  - 10 shards over 3 clusters are `[0-3] [4-6] [7-9]`;
  - `shardsPerCluster: 4` gives `[0-3] [4-7] [8-9]` (it gave 4/3/3 before);
  - `allocateShards()` returns the same blocks.

  Code that assumed shard `i` runs in cluster `i % clusterCount` must use `clusterForShard()` or `assignments()`.
- **A `Client` inside a cluster worker must run one of that cluster's shards:** `gateway: { shardId, shardCount }`, with `shardCount` the deployment's total. Without them, `login()` throws instead of IDENTIFYing outside the cluster's assignment. In a coordinated cluster its IDENTIFYs (the first, and after a lost session) now wait for the parent's queue like `ShardManager`'s.
- **`guildsPerShard` never gives fewer shards than Discord recommends.**

- **Interactions:**
  - `followUp()` throws before the interaction is acknowledged.
  - `update()` and `deferUpdate()` reject on interactions that are not components, or modals opened from one.
  - `editReply()`, `deleteReply()` and `fetchReply()` throw after a modal or autocomplete answer.
  - A Discord 40060 ("already acknowledged") marks the interaction acknowledged.
- **Restart limits:** `ShardSupervisor`'s `maxRestarts` counts restarts with no stable `window` between them. Before, it counted restarts inside a sliding window, which the backoff itself could empty. `clusterUnstable` uses the same count.
- **Gateway:**
  - A heartbeat that is not acknowledged by the next one closes the connection (4900) and resumes, even with a long `heartbeatAckTimeout`.
  - `connect()` while a reconnect is pending joins it instead of skipping the backoff.
  - Reconnects keep the connect URL's query (`v`, `encoding`, `compress`), and IDENTIFY reconnects use the caller's URL.
- **Voice:**
  - While DAVE is required but its group is not ready yet, Opus frames are dropped; they are no longer sent with transport encryption only.
  - Resumable voice closes back off (250 ms doubling to 10 s, 5 attempts), then end as `disconnected` (`closed`).
  - An FFmpeg failure is the resource's `error`, not a `finish`.
- **REST:** paths with an empty segment (`//`) are refused.

### 🗑️ Removed

Old compatibility layers are gone. `lunibee migrate --fix` renames what it can and lists the rest ([Upgrading](/getting-started/upgrading/#033--040)).

- **Compatibility aliases** (old → use):
  - `Events` → `ClientEvent`
  - `ShardingManager` → `ShardManager`
  - `DiscordAPIError` → `RESTError`
  - `CachedManager` → `ResourceManager`
  - `CreateStringSelectMenu` → `CreateStringSelect`
  - `CreateUserSelectMenu` / `CreateRoleSelectMenu` / `CreateMentionableSelectMenu` / `CreateChannelSelectMenu` → `CreateUserSelect` / `CreateRoleSelect` / `CreateMentionableSelect` / `CreateChannelSelect` (renamed)
  - `Intents` → `IntentBits`
  - `SendBudget` → `GatewaySendLimiter`
  - `Status` → `GatewayState`
  - types: `CreateMessageOptions` → `MessageCreateOptions`; `ClientUser` → `UserData`; `InteractionUpdateOptions` and `FollowUpOptions` → `InteractionReplyOptions`
  - `IntentsBitField`: pass an array of `GatewayIntentBits`.
- **REST call forms:**
  - `rest.post/put/patch(path, { body, … })` → `rest.post/put/patch(path, body, options)`. The old form is refused with a `TypeError` naming the fix, rather than sending the wrapper as the body.
  - `rest.request({ method, path | fullRoute, … })` → `rest.request(method, path, body, options)`.
  - `toRequest()` always returns `{ body, files? }`.
- **WebhookClient payload aliases:** `avatarURL`, `threadId` and `allowedMentions` → `avatar_url`, `thread_id` and `allowed_mentions`.
- **CLI:**
  - Removed commands: `create handler`, `create command`, `sync handlers`, `sync commands` and `handler --fix`, the generated-binder layout. `lunibee init` projects find their commands and events at runtime.
  - `lunibee migrate` now migrates code to 0.4.0; the 0.3.1 renames are no longer handled.
- **`@lunibee/create`:** use `bunx @lunibee/cli init my-bot`.
- **Docs:** the changelog and upgrade guide cover 0.4.0 only; earlier releases are in the Git history.

### ✨ Added

- **`client.voice`** ([Voice](/core-concepts/voice/)): `join()` sends op 4 through the shard that owns the guild, collects the bot's `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE` (in either order, with a timeout), and resolves when audio can flow. `leave()`, `get()` and `connections` are also added. Moves and region changes reconnect. Leaving a guild and `client.destroy()` release every connection.
- **Voice gateway v8:** IDENTIFY, READY, IP discovery, SELECT_PROTOCOL and SESSION_DESCRIPTION, with binary frames and a heartbeat that carries `seq_ack` (through `@lunibee/ws`'s `GatewayHeartbeat`). It resumes (op 7) on closes below 4000 and on 4015, and follows the close-code table.
- **Transport encryption:** the `aead_aes256_gcm_rtpsize` and `aead_xchacha20_poly1305_rtpsize` modes. AES-GCM runs on the runtime's synchronous `node:crypto`, since WebCrypto would add a promise to every 20 ms packet. XChaCha20-Poly1305 runs on `@noble/ciphers`, which is audited, pure JS and has no dependencies.
- **DAVE end-to-end encryption** through the optional peer `@snazzah/davey`. Discord has required it outside stage channels since 1 March 2026; without it the voice server closes with 4017, and the error says what to install. Supported: key packages, MLS commits and welcomes, protocol transitions, per-frame encryption, `endToEndEncrypted` and `voicePrivacyCode`.
- **Audio:**
  - `createAudioResource()` passes Ogg/Opus through without re-encoding. It handles raw PCM, Opus packets, and anything FFmpeg reads; FFmpeg is fed on stdin and killed when the resource ends.
  - `inlineVolume` is optional.
  - Lunibee's own Opus codec, `Opus`, runs on the system's libopus through `bun:ffi`: native, with nothing to compile. `createOpusCodec()` uses it when libopus is installed, else `opusscript`, an optional peer. Measured on Bun 1.4.2: encoding a 20 ms frame takes 145–165 µs against 195–210 µs with `opusscript`; decoding is about the same.
- **`AudioPlayer`:**
  - a 20 ms clock that corrects its drift, and no timer while idle or paused;
  - five silence frames on stop and pause;
  - `noSubscriber` and `maxMissedFrames`, with the `stateChange`, `finish` and `error` events.
- **`VoiceReceiver`:**
  - decrypts incoming RTP (transport and DAVE) and maps SSRC to user from op 5;
  - per-user streams end after silence; buffers are bounded (`highWaterMark`) and released on unsubscribe.
- `entersState()` and `generateDependencyReport()`.
- **Sharding startup and observability:**
  - `startup: "sequential"` (`ClusterManager` and `ShardManager`) starts one shard at a time across all clusters, each holding its IDENTIFY slot until READY. How long to wait for READY is `ShardManager`'s `readyTimeout` (default 60 s); in a cluster it follows `identify.holdTimeout`.
  - New `ClusterManager` events: `plan` (total shards, cluster count and where it came from, each cluster's shards), `identify` (the IDENTIFY queue, with buckets and waits) and `shutdown`.
  - New exports: `planClusters()`, the allocation `spawn()` uses, as a pure function; and `connectInQueue()`.
- **Recording:** `receiver.record(userId)` gives an Ogg/Opus stream of a user, not re-encoded, with silence kept so recordings line up. `OggOpusWriter` is the muxer it uses.
- **Effects and a live voice changer:**
  - `effects` on `createAudioResource()`: `pitchShift()`, `robot()`, `echo()`, `gain()`, or your own; they can be changed while playing.
  - `live: true` plays a user's voice back through effects without failing on their silence and keeps the delay low.
  - Video and Go Live stay unsupported: Discord does not allow them for bot accounts.
- `examples/music`: `/play`, `/skip`, `/queue`, `/stop` and `/leave`.
- **`lunibee init [directory]`**: creates a bot project in TypeScript with:
  - validated configuration from the root `.env`;
  - commands and events found recursively at runtime;
  - commands registered with Discord on every start, in `GUILD_ID`'s server or globally, with startup stopping when Discord refuses them;
  - `/ping`, a logger that redacts the token, a README and `tsconfig.json`;
  - a choice of slash commands, message (prefix) commands or both: `--commands slash|message|both`, asked in a terminal when missing (slash otherwise). Message commands get a `messageCreate` handler, `PREFIX` (default `!`) and `!ping`; both runs `/ping` and `!ping` from one file (`execute` and `executeMessage`). Message-only projects register nothing and need no `CLIENT_ID`.

  Existing files are never overwritten without `--force`, which asks first. `--install` runs `bun install`. `lunibee check` accepts the layout.

### 🐛 Fixed
- **Sharding:**
  - A cluster whose process cannot be forked no longer stops the clusters after it: `spawn()` used to reject after the first cluster. It is reported with its shards and retried by the restart policy.
  - Shutdown is bounded even when a killed process never reports its exit.
  - The worker contract rejects an empty `SHARD_LIST` and a `CLUSTER_ID` outside `CLUSTER_COUNT`.
- **Reliability audit.** These fixes came from an audit of every area, with a reproduction for each finding, now kept as regression tests:
  - `rest.hardening`
  - `voice.hardening`
  - `sharding.recovery`
  - `cache.races`
  - `interactions.lifecycle`
  - `gateway.hardening`
- **REST:**
  - Aborting a queued request no longer lets the next one run beside the head of its bucket.
  - A worker that waited on another's probe uses the bucket that probe revealed, instead of sending again under the route.
  - With a store that has no `reserve`, the global slot is taken after the bucket wait.
  - `degraded-local` counts the units this process reserved in Redis.
- **Voice:**
  - The resume loop is bounded (it could open sockets in a busy loop).
  - `join()` for the current channel keeps the session.
  - DAVE encrypt failures are reported once per failure streak.
  - No late "IP discovery timed out" error after a leave.
  - `endpoint: null` times out.
  - The Opus codec is freed when a resource is destroyed while it loads, and frames are never encoded after that.
  - `record()`'s silence fill respects `highWaterMark`.
- **Sharding:**
  - A late exit of a killed child no longer unregisters the cluster that replaced it.
  - `reshard(n)` uses `n`, so auto-scaling no longer collapses to one shard.
  - A reshard or destroy during `connect()` no longer drives or destroys the new shard set.
  - Re-IDENTIFYs after a lost session take a slot from the cross-cluster IDENTIFY gate.
  - A leader-lock renewal that never settles costs at most one term.
  - A worker's failed send rejects only its own wait.
  - An auto-scale respawn keeps `max_concurrency`.
- **Cache:**
  - A REST fetch in flight no longer overwrites a newer Gateway update (members, roles, guilds, channels, users).
  - A message deleted during a fetch is not cached again.
  - `members.*` and `roles.*` REST results merge into the cached instance.
  - With the `Guilds` intent, member and ban events of a guild the bot left create no per-guild state.
  - New opt-in `cache.maxUsers` bounds `client.users` (LRU).
- **Interactions:** `editReply()`, `deleteReply()` and `followUp()` use the interaction's application ID, not the bot user's.
- **Packaging:** `lunibee` and its subpaths (`lunibee/rest`, …) share one copy of each class, and one declaration of each type, so `instanceof` and assignments work across them.

- `setSpeaking` sends the negotiated SSRC instead of `0`.
- A paused player no longer polls every 25 ms.
- The `assertUsable` indirection is removed.
- The optional peers (`@snazzah/davey`, `opusscript`) are loaded at run time, so a bundle of an app that uses `lunibee` does not inline their native or WebAssembly binaries.

### 📚 Documentation

- New [Voice](/core-concepts/voice/) guide and [Voice reference](/reference/voice-connection/).

### 🧪 Testing

- A scripted fake voice server (WebSocket v8 and UDP, with its own rtpsize encryption) covers:
  - the handshake, resume, region change and close codes;
  - IP discovery, encrypted playback and receive end to end.
- DAVE is tested with a scripted module and real `@snazzah/davey` key packages.
- Encryption test vectors and sequence/timestamp wraparound are tested.
- Opus round trip, Ogg demux, FFmpeg and player timing are tested.
- 100 join/leave cycles leave no sockets, timers or listeners behind.
- The fake server is scripted, not a capture of Discord; playing in a real guild is the release smoke test (`bun run smoke:voice`, or the manual "Voice smoke test" workflow).
- CI also runs the tests on ARM64 and on the minimum Bun (1.4.0).

Earlier releases: see the Git history.
