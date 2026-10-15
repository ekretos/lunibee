---
title: Changelog
description: Lunibee version history and release notes.
---

## v0.3.2

Fixes from the fifth security audit of 0.3.1 ([`docs/audits/security-0.3.1.md`](https://github.com/ekretos/lunibee/blob/v0.3/docs/audits/security-0.3.1.md), "Fifth pass"), two Components V2 payload bugs, the last REST compatibility gaps, complete reference pages for REST, Gateway, sharding and voice, and distributed REST rate limiting that holds across processes and bots ([Distributed REST](/core-concepts/distributed-rest/)).

### ⚠️ Changed

- **`CreateThumbnail` and `CreateMediaGallery` now emit the payload Discord accepts.** A thumbnail is `{ type: 11, media: { url } }` (it was `{ type: 11, url }`, which Discord rejected with `Invalid Form Body`, 50035), and a gallery item is `{ media: { url }, description?, spoiler? }` (`description` was inside `media`). `APIThumbnailComponent` and `APIMediaGalleryComponent` changed to match, and `addItems()` accepts `spoiler`. Code that read `.url` from a thumbnail's `toJSON()`, or built `APIThumbnailComponent` by hand, must use `media.url`. Remove any workaround helper for these two components.
- **Input Discord would reject now throws before sending:**
    - embed, link-button and `link()` URLs must be `http` or `https` (embeds also `attachment`, buttons also `discord`);
    - `allowed_mentions` with a kind both in `parse` and listed by ID, an unknown `parse` value, or non-string IDs;
    - option choices must be finite numbers or non-empty strings, and `setMinValue()` above an existing maximum throws;
    - `spliceFields()` validates fields like `addFields()`; `link()` titles cannot contain `)`; `timestamp()` rejects values outside the safe integer range.
- **`Client.destroy()`** stops collectors and empties the caches.
- **A forked `ClusterWorker` exits when its parent's IPC channel closes** (`exitOnParentLoss`, on by default for the real process), so its shards cannot keep running beside a replacement.
- **`HandlerRegistry.dispatch`** runs every handler before rethrowing (one error, or an `AggregateError`).
- **Voice subscriber streams** hold at most 50 packets; a reader that falls behind loses the newest ones.
- **Types:** `options.getUser()` is typed `UserData & Record<string, unknown>` (it was `Record<string, unknown>`), so `new User(options.getUser("x")!)` type-checks; `ApplicationCommandData.description` is optional, since context-menu commands have none.
- **Gateway:** `reconnectBaseDelay`, `reconnectMaxDelay` and `connectTimeout` must be greater than 0; dispatch names that are not UPPER_SNAKE_CASE are not re-emitted as events; `ownsGuild()` returns `false` for a non-numeric id.

- **Distributed rate limiting** ([Distributed REST](/core-concepts/distributed-rest/)):
    - Redis keys are versioned (`<prefix>v1:…`) and bucket keys and global limits are scoped by a token fingerprint, so bots sharing one Redis no longer share counters. 0.3.1 and 0.3.2 processes do not share state.
    - Responses always merge: within a window `remaining` only goes down, also with `concurrentBuckets: false`, and a response from an older window is ignored.
    - A 429's wait is recorded in the store (on the bucket, or the bot's global limit) and the retry waits for it like every other request, instead of sleeping on its own.
    - `RedisRateLimitStore` warns once per state change instead of once per failed command.
    - New `RESTErrorKind`s `"coordination"` and `"overloaded"` (both retryable).

### 🔒 Security

- **A failed reservation can no longer send a request unreserved.** After eight refused reservations `acquire()` returned and the request went out anyway; and on any Redis error a reservation fell back to local state with nothing but a log line per call. A request is now sent only with a granted reservation: a store that errors, replies with something unreadable or refuses without a wait fails it with kind `"coordination"`, and Redis failures follow the explicit `failurePolicy`.
- **Raw tokens never reach the rate-limit store.** Bot identity in keys is a 16-hex-character SHA-256 fingerprint; telemetry carries no token, fingerprint or body.
- **Server-controlled backoff is bounded.** A `Retry-After` or rate-limit reset above `maxBackoff` (new REST option, default 10 minutes) fails the request with a `RESTError` instead of sleeping, and stored bucket and global limits are capped to it. `sleep()` clamps to the 32-bit timer limit.
- **A custom `transport`'s thrown error is sanitised** before it becomes a `RESTError`'s `cause`.
- **Multipart file names** have CR, LF, `"` and `\` replaced; **`baseURL`** is normalised and a bare `?` or `#` is refused; **encoded path segments** that decode to `..` are refused.
- **The memory rate-limit store is bounded** (10,000 buckets and 10,000 route mappings, oldest dropped first).
- **The cluster relay** checks `type`, `id` and `source` and forwards only the documented envelope fields.
- **The voice receiver** ignores datagrams that are not RTP version 2.
- **CI and release:** every workflow checkout sets `persist-credentials: false`; the Pages grants moved from the workflow to the deploy job; the secret scan covers `.pem`, `.key`, `.env*`, `.npmrc` and `.bat` files, finds Discord webhook URLs and scans merge commits; `publish.bat` (an unguarded second release path) was removed — use `bun run publish:all`; `@lunibee/testing` pins `@types/bun`.

### 🐛 Fixed

- **REST coordination across processes** (measured with `benchmarks/rest-distributed.ts`: four processes sharing Redis went from 180 requests over the limit to 0, and from 15.2 to 5.4 Redis operations per request):
    - A response without `X-RateLimit-Remaining` set the bucket to 0 remaining (`Number(null)` is 0). Every rate-limit header is now parsed on its own; missing, empty, negative or non-numeric values are ignored.
    - Two concurrent global 429s could shorten the global limit (read, compare and write were separate). It is now extended atomically and never shortened.
    - Every worker that saw an unknown or reset bucket sent at once. One request now probes an unknown bucket for the whole fleet, and a reset window reopens at the known limit.
    - Redis reservations used each worker's clock; they now use Redis `TIME`.
    - A 429 held its bucket for the whole-second `Retry-After` header instead of the body's precise `retry_after`.
    - A route whose bucket hash differed per channel, or changed, split one bucket's requests across two keys; the hash a major parameter's own responses gave now wins.
    - Every response rewrote the route's bucket hash in Redis and every request read it; both are now cached in-process.
- **A `failed` cluster no longer keeps `ClusterManager.ready()` pending forever.** Readiness now means every shard is served by a ready cluster, so a failed cluster whose shards were reassigned does not block it, and when a failure leaves shards with no owner, pending `ready()` calls reject with an error naming them.
- **`users.fetch()`, `members.fetch()` and `roles.fetch()` keep cached references current.** They stored the fetched object in place of the cached one, so references held elsewhere went stale; they now merge into the cached instance, like Gateway updates.
- **`@lunibee/structures` no longer imports `@lunibee/core` at runtime.** The permission classes (`PermissionSet`, `PermissionsBitField`, `computePermissions`…) moved into `@lunibee/structures`; `@lunibee/core` and `lunibee` re-export them unchanged. Installing `@lunibee/structures` on its own works, and `check:deps` now also checks source imports.
- **`onRetry` fires for retries after a network failure** (with `status: 0`); **`lunibee doctor`** requires Bun 1.4; **`GatewayOptions.compress`** is typed.
- **Sharding backlog:** `ShardBus.off(type, handler)` removes a `respond()` handler; the cluster relay drops a message whose `source` is not one of the sending cluster's shards; a host answers a spawn it refuses with an error instead of leaving the cluster `starting`; `ShardManager` counts started shards against the remembered IDENTIFY budget, starts no auto-scale timer for a fixed shard count, and re-initialises inside a worker with the cluster's shard count; the supervisor's restart delay never exceeds `maxDelay`, jitter included.
- **Voice:** `joinVoiceChannel()` checks the channel ID before registering anything; `setSpeaking(flags, ssrc)` sends the SSRC it is given.
- **Builders and structures:** a string option with choices refuses `setAutocomplete(true)` in either order; `PermissionSet` has getters for `setVoiceChannelStatus`, `pinMessages` and `bypassSlowmode`; `Collector` `collect` / `end` listeners are typed.
- **`isSnowflake()` and prefix-argument parsing** accept at most 20 digits (a snowflake is an unsigned 64-bit number); 21- and 22-digit strings are no longer IDs.
- **`ShardBus` over IPC reaches shards in the same worker.** The parent relays only between clusters, so a `send()` to a shard of the same cluster (and that part of a `broadcast()`) was never delivered; `IpcTransport`s on one process now deliver to each other locally.
- **`ClusterManager` listens for each worker's `error` event**, so an `EPIPE` from `send()` to a dying worker is emitted as `error` instead of crashing the manager.
- **`IdentifyBudget` refills after a long idle gap** (new `period` option, default 24 h) instead of staying empty.
- **`AudioPlayer.play()`** called while an earlier `play()` is still stopping the previous stream no longer starts two pumps.
- **A Gateway decoder failure** (a corrupt compressed frame) closes the socket with `4000` so the session resumes, instead of leaving it open and deaf. `compress: true` joins a query-less connect URL with `?`.
- **A socket stuck connecting** is closed and retried after `connectTimeout` (new Gateway option, default 30 s).
- **A partial member** (the one on a message) no longer clears a cached timeout; **a `MESSAGE_UPDATE` without an author** patches the cached message instead of throwing.
- **`parsePrefixArgs`** returns a null-prototype `values` object, so an option named `__proto__` works.
- **Voice:** re-attaching the same transport pair no longer delivers each datagram twice; `entersState(…, Infinity)` waits instead of rejecting at once.
- **CLI:** `lunibee create component` refuses inherited names such as `constructor`; the generated handler binder escapes file paths.
- **Attachments:** a missing `root` gives a clear error, and a file named like `..dotfile` inside the root is accepted.
- **`files: [new CreateAttachment(...)]` sent an empty file.** `toAttachments` read `file.data`, which a `CreateAttachment` does not have, so the example the docs have shown since 0.2.0 uploaded nothing. A file with `toBuffer()` is now read when the request is sent, and its `description` (and a plain file's new `description`) is sent as the attachment's alt text in `attachments`.

### ✨ Added

- **`cache.maxMembers`** bounds the members kept per guild (least recently used leave first).
- **`rest.request({ method, path | fullRoute, body, ... })`** — the single-object form from `@discordjs/rest`, beside the positional one. `MockREST` supports both.
- **`WebhookClient`:** `avatarURL`, `threadId` and `allowedMentions` aliases; `editMessage()` takes the full message options (components, files, `threadId`); new `fetchMessage()`; `deleteMessage()` accepts `threadId`.
- **`maxBackoff`** (REST) and **`connectTimeout`** (Gateway) options.
- **`ShardManager` `shardCreate` event** `(shardId, gateway)`: fires for each new `Gateway` before it connects, so dispatch listeners never miss early events (also after `destroy()` + `connect()` and `reshard()`).
- **`benchmarks/rest-buckets.ts`**: sequential against concurrent bucket scheduling with a fake Discord that enforces rate-limit windows.
- **Command managers accept builders.** `commands.create()`, `set()`, `edit()` and their guild versions take a `CreateSlashCommand` / context-menu builder as it is (its `toJSON()` is sent), next to plain data. New type `ApplicationCommandInput`.
- **`MessageFileSource`** (anything with `name` and `toBuffer()`) is accepted in `files`; `RESTFileAttachment.data` may be a promise.
- **REST:**
    - `RedisRateLimitStore` options `failurePolicy` (`"degraded-local"` default, or `"fail-closed"`), `commandTimeout` (2 s), `requireAtomic` and `telemetry`; members `mode`, `diagnostics()` and `verify()`; `fromBunRedis()` adapts `Bun.RedisClient`.
    - Optional `RateLimitStore` methods `reconcile`, `extendGlobalReset`, `release` and `reservesGlobal`, each making one step atomic; both built-in stores implement them.
    - `REST` options `telemetry`, `maxQueued` and `maxQueuedPerBucket`; `rest.close()` (graceful shutdown) and `rest.diagnostics()`.
    - `RESTMetrics`: counters, gauges and latency histograms from the telemetry events, with bounded route labels and a Prometheus text export.
    - `parseRateLimitHeaders()`, `headerNumber()`, `requestIdentity()`, `tokenFingerprint()`, `DEFAULT_MAX_BACKOFF_MS`, and the types `Grant`, `BucketUpdate`, `ReserveOptions`, `RateLimitHeaders`, `RateLimitScope`, `RequestIdentity`, `SchedulerOptions`, `ApplyResponseOptions`, `RESTDiagnostics`, `RESTTelemetry`, `RESTTelemetryEvent`, `RESTMetricsSnapshot`, `CoordinationMode`, `RedisFailurePolicy`, `RedisStoreDiagnostics`.
    - Reaction routes are keyed without the emoji (`/reactions/:emoji`), so they no longer create a key per emoji.
- **`benchmarks/rest-distributed.ts`**: REST instances in separate processes sharing Redis, against a fake Discord HTTP server that counts every request over the limit.

### 📚 Documentation

- Complete reference pages for [REST](/reference/rest/), [Gateway](/reference/gateway/), sharding ([ShardManager](/reference/shard-manager/), [ShardBus](/reference/shard-bus/), [ClusterManager](/reference/cluster-manager/), [ClusterHost](/reference/cluster-host/)) and [voice](/reference/voice-connection/). Corrected examples that used `Routes.user("@me")`, `error.name === "AbortError"` and Gateway properties that do not exist.
- `packages/rest/COMPATIBILITY.md` lists no open gaps.
- **Every TypeScript example in the docs is type-checked** against the real API (`bun run docs:check`, part of `bun run ci`): 502 examples, with the names examples use without declaring (`client`, `interaction`, `message`…) given their real types. It found and fixed examples that used methods or fields that do not exist (`member.roles.add`, `error.url`, `error.rawError`, `client.setVoiceState(guildId, …)`, `Routes.user("@me")`, `timestamp(new Date())`, `iconURL` in embeds, string select-option emoji, `ChatInputCommandInteraction`, `InteractionEnum` from `@lunibee/types`) and raw Gateway payloads used as structures.
- A [Types](/reference/types/) page lists every exported interface and type alias with a description (`bun run docs:types` regenerates it), and every public export is now described on a hand-written page.
- The 0.3.1 docs are archived in the version picker.
- Issues found while writing the reference pages are tracked as D-01 to D-13 in the audit report.

### 🧪 Testing

- Every file in `packages/rest/src` is at 100% line coverage.
- `tests/rest.coordination.test.ts`: concurrency on one bucket (150 requests), independent buckets, routes sharing a learned bucket, out-of-order responses, global extend vs shorten, several instances and several bots on one store, Redis errors, hangs, restarts and clock skew, persistent refusals and script errors, cancellation at every stage, probes, bursts after a reset, malformed headers and delays, queue limits, shutdown, telemetry without secrets, and bounded memory over 10,000 requests.
- `tests/integration/rest-redis.test.ts` (`bun run test:redis`, a CI job with a Redis service): the Lua scripts against the JS logic they port, 400 concurrent reservations over 8 connections, one probe across connections, four REST processes for one and for two bots against a fake Discord server with no request over the limit, and an outage through a TCP proxy that degrades (or fails closed) and recovers on reconnect.
- A regression test for each audit fix.

## v0.3.1

A new way to reach Discord, alongside the existing one. Design: [`docs/lunibee-3-workflow.md`](https://github.com/ekretos/lunibee/blob/0.3.1/docs/lunibee-3-workflow.md).

### ⚠️ Changed

- **`Gateway.connect()` rejects instead of throwing** when the Gateway was permanently closed. It returns a promise, so `.catch()`, `Promise.allSettled()` and `await` in a `try` now see the error; code that relied on a synchronous throw from a non-awaited call must handle the rejection.
- **`CreateEmbed.toJSON()` throws a `RangeError` when the embed's text adds up to more than Discord's 6000 characters** (title, description, footer text, author name, field names and values), instead of leaving Discord to answer 400.
- **`ClusterManager` runs under Bun** (Bun 1.4's `child_process.fork()` with IPC is supported and tested); the Node-only guard is gone.
- **Shard messages are routed.** A message to one shard goes only to the cluster that owns it (it used to reach every other cluster, and each ignored it); a broadcast still goes to every other cluster. A message to a shard whose cluster is down fails fast. Behaviour change for code that read targeted messages meant for other shards.
- **`ShardManager.shardCount`** is the deployment total; it equals the number of shards when a manager owns all of them, as before. Use the new `shardIds` for the shards a manager owns.
- **`ClusterInfo`** gained `state`, `restarts`, `startedAt`, `readyAt`, `lastReadyAt` and `report`, and the object is now the same across restarts. `manager.clusters` still lists only live clusters. `ShardHealth` gained `status`, `readyAt` and `disconnectedAt`.
- **`intents` must be an array.** `new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] })`. An OR-ed bitfield (`GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages`), a single number, a single name or an `IntentsBitField` throws a `TypeError` from `Client`, `Gateway`, `ShardManager` and `resolveGatewayIntents()`. `IntentsBitField` itself still takes one intent or an array in `add`, `remove`, `has`, `any` and `equals`; pass `bits.toArray()` to a client.
- **Bun 1.4 is the minimum** (`engines.bun` is `>=1.4.0`); CI and the docs build run on Bun 1.4.2. Node 22 keeps working but is unsupported.

### 🔒 Security

The findings, with severity and status, are in [`docs/audits/security-0.3.1.md`](https://github.com/ekretos/lunibee/blob/v0.3/docs/audits/security-0.3.1.md). A dependency audit of the lockfile and a scan of the tree and of the whole Git history found no vulnerable dependency and no secret.

- **The REST `baseURL` is validated before the bot token is sent to it.** It must be `https:` (or `http:` on this machine), with no credentials, query or fragment; anything else throws a `TypeError` that never repeats the URL's credentials. A cleartext `http://` URL on a network you trust, such as an internal REST proxy, needs `allowInsecureBaseURL: true`. `fetch` is called with `redirect: "error"`, so a redirect cannot carry the token to another host.
- **Network error causes no longer carry webhook or interaction tokens.** Runtimes put the request URL in the message of a failed `fetch`; the `cause` of a `TransportError` is now a copy with those tokens removed.
- **`ShardBus` replies cannot be forged or double-counted.** A request resolves only from the shard it was sent to, a shard counts once in a broadcast however often it answers, and envelopes with a malformed `type`, `id`, `source` or `target` are dropped. `close()` settles pending requests at once (a request rejects, a broadcast resolves with what it has) instead of leaving their timers running, and sending on a closed bus fails with a clear error.
- **Cluster IPC and host connections are bounded.** A worker may have only one IDENTIFY request per shard waiting, and a coordinator closes connections beyond `remote.maxUnauthenticated` (default 16) that have not authenticated (`RemoteClose.TooManyConnections`, 4429).
- **Multi-host links are encrypted off this machine by default.** The coordinator binds `127.0.0.1` unless told otherwise and throws if asked to listen on another address without `remote.tls` (`wss://`); `remote.allowInsecure: true` is the explicit opt-in for a trusted network or a TLS proxy. A `ClusterHost` refuses `ws://` to another machine unless `allowInsecure: true`, and refuses URLs with credentials. The default `remote.hostname` changed from `0.0.0.0` to `127.0.0.1`.
- **Message size limits.** `ClusterManager({ maxMessageBytes })` (default 8 MiB) drops oversized worker messages before relaying them, settles a request whose answer is oversized, ignores an oversized health report, and rejects oversized `request()` / `broadcast()` / `requestCluster()` payloads with a `RangeError`.
- **REST abort listeners are cleaned up.** `sleep()` and `abortable()` removed their `abort` listener only when the signal fired, so one `AbortSignal` reused for many requests collected a listener per rate-limit wait. Every path now removes it.
- **The security scan covers more.** It no longer skips long lines, also finds credentials inside URLs and base64-encoded private keys, and `bun run ci` plus the CI workflow run `audit:security`. Its scope and limits are written at the top of `scripts/security-scan.ts` and in the audit report.
- **Message and frame limits are counted in UTF-8 bytes.** `maxMessageBytes` and the 8 MiB host-link frame limit counted UTF-16 characters, so non-ASCII payloads could exceed the byte limit by up to three times. A string is measured as it travels, anything else as its JSON text.
- **Security-scan exceptions are narrower.** An exception is now `// security-ok(<rule>): <reason>` (or `#`, `<!-- -->`, `/* */`): it must name the rule, give a reason, sit in a comment, and covers only that rule on that line and only matches before the comment. The old `security-ok: <reason>` form no longer suppresses anything.
- **Workflow triggers** for CI and Security are `master` and `dev` (push and pull request); `tests/workflows.test.ts` checks the triggers, read-only permissions and SHA-pinned Actions.
- **`SECURITY.md`** (disclosure policy), a **Security workflow** (`bun audit`, a secret and risky-API scan of the tree and history, dependency review on pull requests, CodeQL), least-privilege workflow permissions, GitHub Actions pinned to commit SHAs, and a release **package smoke test** (`bun run smoke:install` packs every package and installs `lunibee` into an empty project). New scripts: `audit:security`, `smoke:install`.

### ✨ Added


- **`guildsPerShard`** (with `guildCount`) on `ClusterManager` and `ShardManager`: with `shardCount: "auto"`, the shard count is `ceil(guilds / guildsPerShard)` from the guild count Discord reports, instead of Discord's recommendation (1 to 2500; `autoScaleInterval` follows it). Together with `shardsPerCluster` this fixes how many guilds a shard and how many shards a cluster hold. New helpers `shardsForGuilds()`, `fetchGuildCount()`, `MAX_GUILDS_PER_SHARD`.
- **Multi-host clusters.** `ClusterManager({ remote })` is a coordinator that accepts `ClusterHost` agents on other machines over an authenticated WebSocket (HMAC challenge, optional `wss://`). Clusters are placed on hosts round-robin and supervised like local ones, so IDENTIFY slots, routing, `request()` / `broadcast()`, health and recovery work across hosts. A host kills its workers when the link closes or after one `lease` without the coordinator, and the coordinator waits two leases before it treats the host as lost, so a shard never runs in two places. Remote workers get only the worker-contract variables and the host's own script. New: `ClusterHost`, `hosts()`, `remotePort`, the `hostJoin` / `hostLeave` events, `ClusterInfo.host`, `ClusterHealth.host`, `RemoteClose`. See [Multiple hosts](/core-concepts/sharding/#multiple-hosts).
- **`ShardManager` and `ClusterManager` as one system.** The `ClusterManager` owns processes and the shard-to-cluster map; the `ShardManager` in each worker runs that cluster's Gateways. New: a documented worker contract (`LUNIBEE_CLUSTER_WORKER`, `CLUSTER_ID`, `CLUSTER_COUNT`, `SHARD_COUNT`, `SHARD_LIST`, `LUNIBEE_IDENTIFY`; `readClusterContext()`, `isClusterWorker()`) and a recursion guard (a worker cannot `spawn()`); deterministic, validated allocation (`allocateShards`, `shardsPerCluster`, `shardIds` for a slice of a deployment, `assignments()`, `clusterForShard()`); a readiness handshake (`ready()`, `waitForReady`, `startTimeout`, cluster states); **IDENTIFY coordination across all clusters** through the parent (`IdentifyCoordinator`: one IDENTIFY per `shard_id % max_concurrency` key per interval, the `session_start_limit` budget with wait-for-reset, an `identifyWait` event) in place of per-cluster pacing; typed events (`clusterSpawn`, `clusterReady`, `ready`, `clusterExit`, `clusterRestart`, `clusterUnstable`, `clusterStartTimeout`, `clusterGiveUp`, `shardsReassigned`, `identifyWait`, `error`); `request()`, `broadcast()` (explicit `{ replies, missing }`) and `requestCluster()` with timeouts, `AbortSignal`, a bounded pending map and owner-checked answers; `health()` / `refreshHealth({ metrics })`; `reassignOnGiveUp`, which moves a failed cluster's shards to a ready cluster only after it confirms (`ShardManager.addShards()`); and `ClusterWorker` for workers that do not use `ShardManager`. See [Sharding](/core-concepts/sharding/#shardmanager-and-clustermanager-together-031) and [ClusterManager](/reference/cluster-manager/).
- **`ShardManager` inside a cluster:** `shardIds`, `cluster`, `identify` and `worker` options, `addShards()`, `report()`, the `ready` event, and a lifecycle `status` with `readyAt` / `disconnectedAt` on `health()`.
- **Stable voice interface.** `voiceStateUpdate` / `voiceServerUpdate` (full raw payloads, no cache needed) and the new `Client#sendVoiceState(guildId, channelId | null, { selfMute?, selfDeaf? })` (also `Gateway#sendVoiceState`, `Gateway#ownsGuild`, `ShardManager#sendVoiceState`, which routes to the guild's shard) are the documented public API for voice clients. `raw` and `ws.send()` are unchanged. See [Voice integration](/core-concepts/voice-integration/).
- **`jitter` option** on `Collection` and `Cache`: a 0-1 fraction of each entry's TTL randomly shaved off when it is set, so entries stored together do not expire together. Default `0`.
- **Handles.** `bot.guild(id)`, `bot.channel(id)`, `bot.member(guildId, userId)`, `bot.role(guildId, roleId)`, `bot.person(id)` and `bot.message(channelId, messageId)` name a thing by its ids. Every handle reads the same way (`peek()` cache only, `get()` cache then Discord, `fetch()` Discord now) and carries the actions Discord offers on it (`kick`, `timeout("10m")`, `send`, `reply`, `react`, …). `bot.guild(id).members`, `.roles` and `.channels` are collections. See [Handles](/reference/handles/).
- **`bot.api`**, Discord's REST API as a chained path: `bot.api.guilds(id).members(userId).patch({ nick }, { reason })`. Typed results for the common routes, `bot.api.to(...)` for the rest, and `pages()` / `all({ max })` that follow Discord's cursors for members, bans, messages, guilds and other lists. See [bot.api](/reference/api/).
- **`command()` and `option.*`.** One definition, typed options (`option.user({ required: true })`, `option.integer({ min, max, default })`, `option.channel({ kinds })`, `option.choice([...])`…), run as a slash command, a prefix command (`prefix: true`), or both. `bot.commands.add()`, `.deploy()` and `.listen({ prefix })` register and route them. Prefix commands read the same options from the message, check `permissions`, answer a bad argument with the usage line, and warn at startup when the `MessageContent` intent is missing. See [Commands](/reference/commands/).
- **Channel kinds.** `channel.kind` is `"text"`, `"voice"`, `"thread"`, `"forum"`… in place of the numeric `type`; `channel.is(...kinds)` narrows the type and `channel.as(...kinds)` asserts it; `bot.channel(id).as("voice")` fetches and narrows. `channelKindOf()`, `channelTypesOf()` and `ChannelKinds` convert to and from Discord's numbers. See [Channel](/reference/channel/#kinds-031).
- **`bot.guild(id).createChannel({ kind, … })`** creates text, announcement, voice, stage, category, forum and media channels with the options each kind accepts, and returns the right class.
- **`parseDuration()`** turns `"90s"`, `"10m"`, `"1h30m"` into milliseconds.
- **CLI: `create command --slash|--prefix|--both`** writes a `command()` file (slash by default, `--prefix` for prefix-only, `--both` for one file answering both) and **`lunibee sync commands`** regenerates `src/commands/index.ts` with `registerCommands(bot)`. `create command` now emits the `command()` form instead of `data` + `execute()`; existing command files keep working.

- **Cross-process `ShardBus`.** `ShardBusTransport` with `BroadcastChannelTransport` (one process) and `IpcTransport` (forked clusters, relayed by the `ClusterManager`). Children forked by the manager use IPC automatically. A request to a shard whose cluster died rejects immediately, pending requests are capped (`maxPending`), and handler errors without an `onError` listener become a `LUNIBEE_SHARD_BUS_ERROR` process warning instead of being dropped. See [Sharding](/core-concepts/sharding/).
- **`ShardSupervisor`** and `ClusterManager` options `supervisor` (backoff, jitter, `maxRestarts` per `window`) and `onGiveUp`. Defaults keep today's fixed-delay restarts.

- **IDENTIFY buckets and shard events.** Shards start in buckets of `shard_id % max_concurrency`; `ShardManager` emits `shardReady`, `shardDisconnect`, `shardResume`, `shardError` and `shardUnstable`; `fetchGatewayBot()` is the single `/gateway/bot` reader; `getShardIdForGuild()` stays correct while resharding.
- **Gateway liveness.** `gateway.health()`; reconnect-storm backoff with an `unstable` event (`reconnectStormLimit`, `reconnectStormWindow`); `compress` on `ClientOptions`; `GatewayDispatcher` and `GatewaySendLimiter` (formerly `SendBudget`, still exported) extracted from `Gateway`. A 30-minute fake-clock soak test guards against reconnect loops.

- **More of Discord's REST API.** Forum and media posts (`threads.createForumPost`) and tag CRUD (`createForumTag`, `editForumTag`, `removeForumTag`); standalone threads, thread members (`join`, `leave`, `addMember`, `removeMember`, `fetchMember`, `fetchMembers`) and archived-thread pages; `bans.bulk()`, `members.search()`, `members.editMe()`; `fetchPins()` with paging and `triggerTyping()`; welcome screen and onboarding (`fetchWelcomeScreen`, `editWelcomeScreen`, `fetchOnboarding`, `editOnboarding`); `editVoiceState()`; `removeIntegration()`; `users.fetchGuilds()`; `bot.applicationEmojis`; role icons and gradient `colors` (`role.colors`); `interaction.entitlements` and `hasEntitlement()`. New `Routes` builders cover each path. See [Threads, Forums & More](/recipes/threads-forums-and-more/).
- **REST coverage audit.** `bun scripts/api-coverage.ts` compares Discord's v10 routes with `Routes` and writes `docs/audits/api-coverage.md` (159 covered, 23 not planned with a reason each, 0 gaps); `bun run audit:coverage` runs in CI.

- **Structures.** `createdTimestamp` on every snowflake structure; `guild.premiumProgressBarEnabled`; a `Sticker` structure with `url()`; `AuditLogEntry.info` (typed and parsed per action type), `is()` and `change()`, and `AuditLog.find()` / `filter()` by type, target, user and time, via `guilds.fetchAuditLogEntries()`.

- **Faster Collection scans.** `at()` and `keyAt()` walk to the index instead of copying the collection (about 30x faster at 1,000 items); `filter`, `clone`, `each` and `map` no longer allocate a pair per entry; `findLast` / `findLastKey` stop building entry tuples. `bun run bench:compare` compares the runtime benchmark with a committed baseline and warns on regressions.

- **Benchmarks section** on the docs site: one page per classification (Collection against discord.js, Builders, Formatters, Gateway events, REST, cache memory), generated by `bun scripts/bench-docs.ts`.

- **`bot.setActivity(name, { type, status, url, state })`** sets what the bot is playing, watching or saying (`null` clears it). See [Presence & Activity](/recipes/presence-and-activity/).

### 🔧 Changed

- **REST runs requests on a known bucket concurrently by default** (`concurrentBuckets` is now `true`). A bucket's allowance is used in parallel instead of one request at a time, about twice as fast in `benchmarks/rest-buckets.ts`, with no extra 429s in a 10,000-request soak test. Requests on one bucket may now finish out of order; pass `concurrentBuckets: false` if you rely on strict per-bucket ordering (for example, several messages to one channel that must arrive in sequence).

- **Typed message options.** `MessageCreateOptions`, `MessageEditOptions`, `InteractionReplyOptions`, `InteractionUpdateOptions` and `FollowUpOptions` live in `@lunibee/types` and replace `Record<string, unknown>` on channel send/edit, message reply/edit and interaction replies. `embeds` take `CreateEmbed` builders or raw embeds, `files` need a `name` and `data`, `ephemeral` is a boolean. Unknown keys still pass through. A caller that passed a wrongly-shaped value (for example `embeds: unknown[]`) now gets a compile error. See [Sending Messages](/recipes/sending-messages/).

- **Previous state on more update events.** `messageUpdate`, `voiceStateUpdate`, `presenceUpdate`, `stageInstanceUpdate`, `guildScheduledEventUpdate` and `autoModerationRuleUpdate` pass `previous` (or `null`) as a second argument. `messageUpdate`'s `previous` is now `Message | null` instead of `Message | undefined`. New option `cache: { presences: true }` keeps presences so `presenceUpdate` can report the previous one.

### ⚠️ Removed

Everything deprecated in 0.2.x is gone. `lunibee migrate --fix` renames the old names and lists the calls to change by hand.

- **The 49 pre-0.2.2 names:** every `…Builder` (`ButtonBuilder` → `CreateButton`, `SlashCommandBuilder` → `CreateSlashCommand`, `EmbedBuilder` → `CreateEmbed`…), `ButtonStyle` / `TextInputStyle` (→ `ButtonType` / `TextInputType`) and the old `…Type` sets (`ChannelType` → `ChannelEnum`, `ComponentType` → `ComponentEnum`, `InteractionType` → `InteractionEnum`, `WebhookType` → `WebhookEnum`, `PermissionOverwriteType` → `PermissionOverwriteEnum`…).
- **`Routes.channelPins` and `Routes.channelPin`** → `Routes.channelMessagesPins` (returns `{ items, has_more }`) and `Routes.channelMessagesPin`.
- **`setDMPermission()` and `dm_permission`** → `setContexts(0)` for guilds only, `setContexts(0, 1)` to allow the bot's DMs.
- **`fetchInvite({ withExpiration })`**: Discord always returns `expires_at`.
- **`deleteRole`, `deleteEmoji`, `deleteChannel`, `deleteGuild`** → `remove(id, reason?)`. **`sendMessage()`** on `Channel` and `ChannelManager` → `send()`. **`ChannelManager.bulkDelete()`** → `bulkDeleteMessages(id, ids, reason?)`.
- **The positional `reason` after an options object** on `members.edit`, scheduled events `create`/`edit`, stage instances `create`/`edit` and permission overwrites `edit` → `{ …options, reason }`.

### 📚 Documentation

- Quick Start, `examples/basic` and the Upgrading page use `bot`, `command()` and handles. The Upgrading page has a before/after table for 0.3.1.

## v0.2.4

Security release. Fixes the findings of the 0.2.3 security review; the status of each one is in [`docs/audits/security-0.2.3.md`](https://github.com/ekretos/lunibee/blob/0.2.4/docs/audits/security-0.2.3.md). **Upgrade recommended.**

### 🔒 Security

- **REST paths can no longer be rewritten into another route.** `.`/`..` segments, percent-encoded dots and backslashes are refused before the request, so a string passed as an id cannot send the bot token to a different endpoint. `leaveGuild()`, `fetchWebhook()`, `fetchGuildPreview()`, `fetchSticker()`, `followUpInteraction()` and `removeReaction()` validate ids, and tokens are always URL-encoded.
- **Webhook and interaction tokens stay out of rate-limit keys** (including Redis), errors and hooks; redaction now ignores the path's case.
- **The Gateway only resumes on Discord's hosts.** A `resume_gateway_url` that is not `wss:` on `discord.gg` (or the gateway you connected to) is ignored and the default gateway is used, so the RESUME frame never carries the token elsewhere.
- **A caller's `authorization` header can no longer be merged with the bot token.** Library headers replace any spelling of the same header.
- **Gateway frames are capped** at 64 MiB inflated, so a compressed frame cannot exhaust memory.
- **Webhook URLs must be Discord's** (`WebhookClient({ url })` no longer accepts look-alike hosts or embedded URLs); `thread_id` is encoded; CDN asset hashes are encoded.
- **Listener warnings never print the bot token**; it is replaced with `[token]`.
- **`lunibee migrate` / `lunibee fix` escape every RegExp metacharacter** in names they search for (CodeQL `js/incomplete-sanitization`); `publish:all` no longer runs `npm` through a shell.

### ⚠️ Behaviour changes

- **Timed-out members** keep only View Channel and Read Message History in `member.permissions`, `member.permissionsIn()`, `client.permissionsFor()` and `computePermissions({ timedOutUntil })`, as Discord applies it. Owners and administrators are exempt.
- **IDENTIFY properties** default to `os: process.platform`, `browser` and `device: "Lunibee"` instead of Discord's Android client, so the bot no longer shows the mobile status icon. Set `properties` in the client options to change them.
- **`link()` and `codeBlock()`** escape their input: brackets in a link label, parentheses and spaces in its URL, and ``` inside a code block.
- `fetchWebhook()`, `fetchGuildPreview()`, `fetchSticker()` and `followUpInteraction()` reject a malformed id (a rejected promise with a `TypeError`), and `REST` rejects paths with dot segments.

### ✨ Added

- **`CreateAttachment(path, { root })`**: confines a file path to a folder (symlinks resolved). Use it, or pass bytes, whenever the path comes from a user.
- `Routes.currentUserGuild`, `Routes.sticker`, `Routes.messageReactionUser`.

### 🐛 Fixed

- **`WebhookClient.send({ files })` uploads the files.** They were serialized into the JSON body and never reached Discord; they are now sent as multipart form data. Component builders in `components` are serialized with `toJSON()` like embeds.
- **Integer and number option choices** are checked like string choices: a name must be 1-100 characters. A string choice with an invalid value no longer leaves earlier choices from the same call behind.

### ✨ Added

- **More `Collection` methods, matching discord.js:** `mapValues()`, `reduceRight()`, `concat()`, `equals()`, `merge()`, `symmetricDifference()`, `toReversed()`, `toSorted()` (the same as `sorted()`), the static `Collection.groupBy()` and `Collection.combineEntries()`, and the `ReadonlyCollection` and `Keep` types. `union()`, `intersection()` and `difference()` now accept any `ReadonlyCollection`. There is no in-place `sort()` or `reverse()`.
- **`Symbol.species` on `Collection`.** `filter()`, `clone()`, `sorted()`, `partition()`, `union()`, `intersection()` and `difference()` return an instance of your subclass, as in discord.js. They build it with `new Species()` (no arguments, so no `ttl` or `maxSize`); a subclass that cannot be built that way, or should hand back a plain `Collection`, overrides `static get [Symbol.species]()`. Their return types are now `this`.
- **`collection.random(amount)` and `randomKey(amount)`** return that many different values or keys (the reference page already said so, but only one could be picked). **`findLast()` and `findLastKey()`** search from the end. `random()` without an amount no longer copies the collection.
- **`collection.ensure(key, factory, ttl?)`** returns the stored value or stores and returns what `factory(key, collection)` makes (a get-or-create, as in discord.js).
- **`slide: false`** on `Collection`: a read still marks an entry recently used but no longer extends its TTL.

### 🔧 Changed

- **`Cache` is now a thin layer over `Collection`** (fixed TTL, LRU, `maxSize`). A bounded `Cache` used to re-insert an entry on every read, which made it slow once it held many entries: `set` + `get` on a 100,000-entry cache took about 17 µs and now takes about 1.1 µs. Two things differ: `values()` and `entries()` list entries in the order they were first added (they used to follow recency), and `sweepInterval` / `dispose()` are kept but no longer needed, as expired entries are dropped at their deadline.
- **Plain collections are much lighter.** A `Collection` without options no longer allocates expiry, recency and stats structures, or stores its options, up front: 35 bytes per empty collection (a `Map` is 32) instead of about 360. They are created when `ttl` or `maxSize` is set, or on the first `set()` with its own TTL. `set()` with a TTL or `maxSize` is also faster (about 40% for a collection with both), and `get()` is faster: about 30% with a TTL, 40% with a TTL and `maxSize`, and 15-30% with `maxSize` alone (a read is one lookup instead of two). `stats` are unchanged.
- **Lapsed entries no longer push live ones out of a `maxSize` collection.** When a `set()` takes a collection over `maxSize`, entries whose TTL has already lapsed are dropped first (as `expired`), instead of evicting the least recently used live entry while a dead one lingered.
- **Stricter public types, no `any`.** `WebhookClient.editMessage()` resolves to `APIMessage`; `WebhookMessageOptions.components` / `files` take component payloads (or builders) and `RESTFileAttachment`s; `VoiceGatewayTransport.send()` takes a `VoiceGatewayPayload`; `identifyPayload()` returns `GatewayPayload<IdentifyData>`; extra `GatewayProperties` / `IdentifyProperties` keys are strings; `MinimalRedisClient.set()` resolves to `string | null`. Code that compiled before only breaks if it relied on these being `any`.

### 📚 Documentation

- **Version picker.** The site keeps the docs of every release (v0.1.0 to v0.2.3) next to the latest; pick one from the header.

## v0.2.3

Packaging fixes for 0.2.2, and a deprecation pass. Nothing is removed and existing code keeps working; deprecated APIs are struck through in your editor and **removed in 0.3.1**.

### ⚠️ Deprecated (removed in 0.3.1)

- **The pre-0.2.2 names** (`ButtonBuilder`, `ButtonStyle`, `ChannelType`…, all 49 of them) are now removed in **0.3.1** instead of 2.0. See [Upgrading](/getting-started/upgrading/) for the table of new names.
- **`setDMPermission()`** on slash and context-menu command builders: Discord deprecated `dm_permission`. Use `setContexts()`, which slash commands now have too: `setDMPermission(false)` → `setContexts(0)`.
- **`Routes.channelPins` / `Routes.channelPin`**: Discord deprecated `/channels/{id}/pins`. Use `Routes.channelMessagesPins` (returns `{ items, has_more }`) and `Routes.channelMessagesPin`.
- **`fetchInvite({ withExpiration })`**: no effect; Discord always returns `expires_at` and deprecated the `with_expiration` parameter, so it is no longer sent.
- **Manager names that hid the cache/Discord split**: `roles.deleteRole()`, `emojis.deleteEmoji()`, `channels.deleteChannel()` and `guilds.deleteGuild()` become `remove()`; `delete()` keeps meaning "drop from the cache". `channel.sendMessage()` / `channels.sendMessage()` become `send()`, and `channels.bulkDelete()` becomes `bulkDeleteMessages()`.
- **A reason passed after an options object** (`members.edit(id, options, reason)`, scheduled events, stage instances, permission overwrites): put it in the options, `{ ...options, reason }`.

### ✨ Added

- `setContexts()` on `CreateSlashCommand`, the replacement for `setDMPermission()`.
- `Routes.channelMessagesPins` and `Routes.channelMessagesPin`.
- `CreateCommandOption` is exported, so code using the deprecated `CommandOptionBuilder` has a name to move to.
- `contexts` on the `APIApplicationCommand` and `ApplicationCommandData` types.
- **One rule for audit-log reasons.** If a method takes an options object the reason goes in it, otherwise it is the last argument; it is always sent as the `X-Audit-Log-Reason` header. New: `remove(id, reason)` on the role, emoji, channel and guild managers, and a reason on `unban()`, emoji and channel create/edit, `guilds.edit()`, auto-moderation rules, scheduled-event delete, `deleteMessage()`, `bulkDeleteMessages()`, `pinMessage()` / `unpinMessage()`, and on `message.delete()`, `message.pin()`, `message.unpin()` and `channel.delete()`. See [Managers](/packages/managers/#audit-log-reasons).
- `roles.setPositions(positions, reason)` and `channels.createWebhook(channelId, { name, reason })`, for the two routes bots still called by hand.
- `Guild` carries `afkChannelId`, `afkTimeout`, `widgetEnabled`, `widgetChannelId`, `applicationId`, `publicUpdatesChannelId`, `safetyAlertsChannelId`, `maxPresences` and `maxVideoChannelUsers`.
- `RESTErrorCode`: names for the Discord error codes bots handle, e.g. `error.code === RESTErrorCode.UnknownMessage`. `RESTError.hint` says what to check for Missing Access (50001) and Missing Permissions (50013).
- **`lunibee migrate`** (CLI): lists the APIs removed in 0.3.1 in your `src/`; `--fix` renames the old Lunibee names (only where they are imported from Lunibee) and lists the calls to change by hand. See [CLI](/packages/cli/).
- `MessagePayload` and `Buildable<T>` types: type your own message payloads (builders or raw objects); every send and reply method accepts them.

### 🔧 Changed

- **An error thrown by a listener is no longer silent.** With no `error` listener, or when an `error` listener itself throws or rejects, it is reported as a process warning (`LunibeeWarning`, on stderr by default) instead of disappearing.
- `pinMessage()`, `unpinMessage()` and `fetchPinnedMessages()` use Discord's current pin endpoints. Discord requires the **Pin Messages** permission for pinning and unpinning. `fetchPinnedMessages()` still returns the newest pinned messages (up to 50) as `Message[]`.

### 🐛 Fixed

- **`roles.create()` and `roles.edit()` dropped the audit-log reason.** It was taken out of the options and never sent.
- **Lunibee's source failed to compile in strict projects.** Projects using `noUnusedLocals`, `noImplicitOverride` or `noUncheckedIndexedAccess` got errors from inside Lunibee; CI now checks with these flags.
- **Malformed interaction data leaked wrong types**: a non-string `custom_id` came back as a number from `customId`. Interaction fields are now read with type checks (no `any` left in `@lunibee/structures`).
- **Docs:** the Managers page used `emojis.delete()` (which only clears the cache) to delete an emoji, and `guild.members` / `guild.emojis`, which do not exist.
- **`@lunibee/cli` installed without the `lunibee` command.** npm drops a `bin` whose file is missing when it reads `package.json`, which happens before `prepublishOnly` builds it. Packages are now built before `npm publish`.
- **The project scaffolder shipped without code.** `create-lunibee@0.2.2` contained only its README. It is now built before publishing, ships its type declarations, runs on Node as well as Bun, and is renamed **`@lunibee/create`**: `bun create @lunibee my-bot`. `create-lunibee` is deprecated.
- **`@lunibee/builders`, `@lunibee/rest` and `@lunibee/managers` did not declare `@lunibee/types`**, so installing one of them on its own could not resolve it.
- **Publishing refuses broken packages.** `bun run publish:all` and `lunibee publish` build every package, check that every file `package.json` points at exists and that every `bin` has a `#!` line, publish dependencies first, and (`publish:all`) skip versions already on npm so a failed run can be rerun. Extra flags go to `npm publish`: `bun run publish:all -- --otp 123456`.

## v0.2.2

### ✨ Added

- **Context-menu commands**: `isContextMenuCommand()`, `isUserContextMenuCommand()`, `isMessageContextMenuCommand()` and `isCommand()` guards; `ContextMenuCommandInteraction` with `targetId`, `targetUser`, `targetMember` (with member actions) and `targetMessage`; `setContexts()` and `setNameLocalizations()` on `CreateUserCommand` / `CreateMessageCommand`. See [Context Menus](/recipes/context-menus/).
- **Default `allowed_mentions`**: `new Client({ allowedMentions: { parse: [] } })` applies to every message the client sends (channel send/edit, replies, interaction replies, edits, follow-ups); a message's own `allowed_mentions` wins. See [Client options](/reference/client/).
- **`withResponse`**: `reply()`, `update()`, `deferReply()` and `deferUpdate()` accept `withResponse: true` and return the created `Message` from the same request.
- **CDN helpers exported**: `CDN_BASE`, `cdnURL()` and `ImageURLOptions` from `lunibee` and `@lunibee/structures`.
- **Component payload types exported from `lunibee`.** `APIComponent`, `APIActionRowChild`, `APIStringSelectComponent`, `APIEntitySelectComponent`, `APISelectOption`, `APIContainerComponent`, `APITextDisplayComponent`, `APIModalComponent` and the other builder payload types; the builder shapes of an action row, button and text input are `APIActionRowPayload`, `APIButtonPayload` and `APITextInputPayload`.
- **Message stickers, polls and forwards**: `message.stickers`, `message.poll` and `message.messageSnapshots`, refreshed on `messageUpdate`. New `APIPoll` and `APIMessageSnapshot` types.
- **Previous state on update and delete events**: `guildUpdate`, `guildMemberUpdate`, `guildRoleUpdate`, `channelUpdate` and `threadUpdate` pass a copy of the cached structure before the update; `guildRoleDelete`, `channelDelete` and `threadDelete` pass the removed one; `guildEmojisUpdate` and `guildStickersUpdate` pass the previous list. Trailing arguments only, so existing handlers keep working. If you captured previous state from `raw`, you can drop that.
- **CLI rework** (`@lunibee/cli`): per-command `--help`, `--version`, `--cwd`, `--json` on `list`/`check`/`doctor`/`info`/`status`, `--dry-run` and `--force` on every `create`, "did you mean" suggestions for commands, options and events. `create handler` takes several events and any case; `sync handlers --check` exits 1 when the binder is stale and warns about typo folders and missing default exports; `create command` validates names and supports `--description`/`--category`, generating `data` + `execute`; `create component` takes its type and name as arguments and generates a real builder and `handle()`; `list events`/`list components`; `check`/`doctor` exit 1 on errors and verify `.env` is git-ignored, installed versions match and the Bun version; `publish` publishes dependencies first, refuses mixed versions, confirms unless `--yes`, and passes `--dry-run`/`--tag`/`--otp`.
- **`lunibee handler --fix`**: migrates 0.2.1 handlers to the client-first format (adds `_client: Client` and the import), fixes the case of event folders and resyncs `src/handlers/event.ts`. Without `--fix` it reports what needs changing.

### ⚠️ Behaviour changes

- `isChatInputCommand()` is true for slash commands only; context-menu commands no longer match it. Use `isCommand()` for any application command.

### 🐛 Fixed

- **Healthy Gateway connections were closed as zombies every ~45 s.** Incoming frames never reset the silence clock, so with the default `zombieTimeout` every connection was closed and resumed once the staleness deadline passed, on every shard. Any frame from the current socket now counts as traffic. If you set `zombieTimeout: Infinity` to work around this, remove it.
- **`showModal(modal.toJSON())` failed to type-check.** The raw modal type required an index signature that the builder's `APIModalComponent` lacks; a builder and its `toJSON()` output are now accepted alike, without a cast.

### ✏️ New names

Builders are now `CreateX`, `…Style` constants are `…Type`, and `…Type` constants are `…Enum`; every `…Enum` and `…Type` also works as a type. **The old names still work** as deprecated aliases (your editor shows them struck through) and are removed in 2.0. See [Upgrading](/getting-started/upgrading/).

| Before                                                                                     | Now                                                                                     |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `ButtonBuilder`, `EmbedBuilder`, `ModalBuilder`, `SlashCommandBuilder`… (every `XBuilder`) | `CreateButton`, `CreateEmbed`, `CreateModal`, `CreateSlashCommand`… (`CreateX`)         |
| `ButtonStyle`, `TextInputStyle`                                                            | `ButtonType`, `TextInputType`                                                           |
| `ChannelType`, `ComponentType`, `InteractionType`, `InteractionResponseType`               | `ChannelEnum`, `ComponentEnum`, `InteractionEnum`, `InteractionResponseEnum`            |
| `ApplicationCommandType`, `ApplicationCommandOptionType`                                   | `ApplicationCommandEnum`, `ApplicationCommandOptionEnum`                                |
| `StickerType`, `StickerFormatType`, `WebhookType`, `PermissionOverwriteType`               | `StickerEnum`, `StickerFormatEnum`, `WebhookEnum`, `PermissionOverwriteEnum`            |
| _(new)_                                                                                    | `ActivityEnum` (`Playing`, `Streaming`, `Listening`, `Watching`, `Custom`, `Competing`) |

## v0.2.1

### ✨ Friendlier API

- **Members on messages**: `message.member` (roles, nickname) on guild messages, with `permissions` computed from the cached roles, so prefix commands can check permissions. Message authors' members are kept current in the member cache.
- **Live member permissions**: `GuildMember.permissions` is computed from the cached roles whenever Discord did not send them (everywhere but interactions), and `permissionsIn(channelId)` adds channel overwrites.
- **Member actions**: `member.kick()`, `ban()`, `timeout()`, `setNickname()`, `addRole()`, `removeRole()` and `edit()`, each with an optional audit-log reason; `GuildMemberManager` methods take a `reason` too.
- **Overwrites that merge**: `channel.editPermissionOverwrite(id, { ViewChannel: true, SendMessages: false })` and `permissionOverwrites(id).update()` change only the named permissions.
- **Files**: `files` on `send`, `reply`, `edit` and interaction replies upload attachments.
- **Collectors**: `message.createComponentCollector()`, `message.awaitComponent()` and `interaction.awaitModalSubmit()`, always time-limited.
- **Prefix commands**: `parsePrefixArgs()`, `tokenizeArgs()`, `argsFromCommandOptions()` and mention parsers in `@lunibee/utils` (see [Prefix Commands](/recipes/prefix-commands/)).
- **Builders & typing**: `ModalBuilder.addTextInputs()`, `showModal()` takes a builder, `componentsV2Message()`, embed setters clear with `null`, `deferReply({ ephemeral })`, `options.getMentionableType()`, `ComponentInteraction.messageId`, and `ButtonStyle`, `TextInputStyle`, `ComponentType` and `MessageFlags` usable as types.
- **Permissions**: renamed permission names (`ManageEmojisAndStickers`, `ManageEmojis`, `UseSlashCommands`) still resolve.

### ⚠️ Behaviour changes

- `GuildMember.permissions` is a getter. Members from the Gateway or REST used to report `0`; they now report their computed guild-level permissions.
- `APIModalComponent` (the type `ModalBuilder.toJSON()` returns) now has a required `custom_id` and `title`.

### 📚 Documentation

- New [Prefix Commands](/recipes/prefix-commands/) recipe; "0.2.1 Additions" on the GuildMember, Message, Channel, Interactions, ModalBuilder, Components V2, EmbedBuilder, PermissionSet, Collector and Utils pages; an [upgrade note](/getting-started/upgrading/).

### 🧪 Testing

- `tests/friendly-api.test.ts` covers prefix arguments, member permissions and actions, overwrite merging, file uploads, component collectors and the builder additions.

## v0.2.0

### 💥 Breaking Changes

See [Upgrading to 0.2.0](/getting-started/upgrading/) for code changes.

- **Messages are not cached by default.** Pass `messageCache: { maxSize?, ttl? }` to the client to keep a bounded per-channel cache; without it `MessageManager.cache` stays empty and `resolve()` always fetches.
- **Builders validate on `toJSON()`.** Buttons without a custom ID/URL/SKU or without a label/emoji, selects without a custom ID or with `min_values > max_values`, string selects whose `max_values` exceeds their options, mixed action rows, and modals without a custom ID, title or component now throw.
- **`bulkDeleteMessages()`** accepts 1–100 IDs (one ID becomes a normal delete), removes duplicates, and throws a `RangeError` for messages older than 14 days.
- **Cached objects are updated in place.** `ResourceManager.upsert()`, `GuildManager.patch()` and Gateway updates merge into the cached instance instead of replacing it.
- **`RESTError.path`** shows `:token` in place of webhook and interaction tokens.

### ✨ Features

- **Resource state never expires**: `Collection` gains `set(key, value, ttl?)` (sliding TTL, O(1) LRU `maxSize`, `onEvict`, `stats`, `peek`, `purge`, `ttlRemaining`) and `setWithoutTTL()`; managers store Discord resources without TTL.
- **Gateway cache sync**: guild create/update/delete, members, roles, emojis, stickers, bans, scheduled events, stage instances, channels, threads, voice states, automod rules, invites and soundboard sounds are kept current. New `guilds.members(id)`, `roles(id)`, `emojis(id)`, `stickers(id)`, `soundboard(id)`, `voiceStates(id)`, `autoModerationRules(id)`, `invites(id)`.
- **Large bots**: `ClientOptions.cache` (`users`, `members`, `roles`, `emojis`) turns caching off per resource.
- **Fetch safety**: concurrent fetches of one resource share a request; a fetch that finishes after a newer Gateway update or delete is returned but not cached.
- **Interactions**: single acknowledgement guard, `ephemeral` on edits and follow-ups, `fetchReply()`, `editFollowUp()`, `deleteFollowUp()`, `user`, `member`, `createdTimestamp`, `expiresAt`, `isExpired`.
- **Permissions**: `PermissionSet.missing()`, `computePermissions()`, `client.permissionsFor()`, typed `channel.permissionOverwrites`.
- **Collectors**: `idle`, `signal`, `for await`, `wait()`, `Symbol.dispose`, `onDispose()` and `client.createCollector()`.
- **REST**: `RESTError.kind` / `retryable`, `redactPath()`.
- **Messages**: `iterateMessages()`, `endPoll()`, `fetchPollVoters()`, `sendSoundboardSound()`.
- **Sharding**: startup in rounds of `max_concurrency`, session-start-limit check, `fetchGatewayInfo()`, `health()`.
- **New APIs**: guild stickers and soundboard managers, `client.monetization` (SKUs, entitlements, subscriptions) with `entitlementCreate/Update/Delete` events, soundboard events, `ButtonBuilder.setSKUId()`.

### 🐛 Bug Fixes

- **Message cache**: with `messageCache`, messages from `MESSAGE_CREATE` are cached; `messageUpdate`, `messageDelete` and `messageDeleteBulk` receive the previous/deleted cached message(s) as an extra argument.
- **Buttons**: `setStyle()` clears fields the style cannot carry, and `toJSON()` rejects forbidden field combinations (e.g. a label on a premium button).
- **Permissions**: added bits 48 (`setVoiceChannelStatus`), 51 (`pinMessages`) and 52 (`bypassSlowmode`); owner/administrator results include them. `permissionsFor()` resolves threads through their parent channel.
- **Guild updates**: fields a partial update omits (e.g. `memberCount`) keep their cached values.
- **Redaction**: tokens are redacted even after a malformed webhook/interaction ID.
- **Sharding**: rounds are paced by sent IDENTIFYs (`handshakeTimeout`); `maxConcurrency` is capped at Discord's limit; the session start budget counts only shards that need a connection and never destroys live shards.
- **Voice**: `receiver.subscribe()` throws after the connection is destroyed.

- **Gateway RESUME**: reconnect requests, zombie connections and heartbeat timeouts closed with `1001`, which makes Discord drop the session; they now close with `4900` so RESUME succeeds.
- **Heartbeat**: the regular interval now starts after the jittered first beat instead of alongside it.
- **Gateway sequence**: a lower sequence can no longer roll back the RESUME point.
- **Messages**: `MESSAGE_CREATE` / `MESSAGE_UPDATE` no longer overwrite a cached channel with a stub.
- **Voice**: receiver streams end on disconnect/destroy instead of waiting forever.
- **Collection LRU**: eviction no longer scans deleted slots (about 65 µs → 0.55 µs per eviction at 100k entries).

---

## v0.1.8

### 🚨 Behaviour Changes

- **`ShardManager.spawnDelay` now defaults to `5000` ms** (`ShardManager.IDENTIFY_INTERVAL`). Discord permits one IDENTIFY per 5 seconds; starting shards back to back earned close code `4008` and invalid-session churn. An _N_-shard bot now takes about `(N - 1) × 5s` to connect. Pass `spawnDelay: 0` to opt out.
- **`ClusterManager` supervises its children.** A cluster that exits unexpectedly is re-forked with the same shard assignment after `restartDelay` (5000 ms). Disable with `restartOnExit: false`; observe with `onClusterExit`.

### ✨ Features

- **Discord.js-familiar API**: `Events`, `IntentsBitField`, `CachedManager`, `ShardingManager`, `StringSelectMenuBuilder` / `User`/`Role`/`Mentionable`/`ChannelSelectMenuBuilder`, exported `ContextMenuCommandBuilder` with `setType()`, interaction guards (`isButton()`, `isStringSelectMenu()`, `isAnySelectMenu()`, …) and `interaction.options.getFocused()` for autocomplete.
- **Channel subclasses**: `createChannel()` returns `TextChannel`, `NewsChannel`, `DMChannel`, `VoiceChannel`, `StageChannel`, `CategoryChannel`, `ThreadChannel`, `ForumChannel` or `MediaChannel` (all extend `Channel`); channels emitted by the client use it. New `isThread()`, `isTextBased()`, `isVoiceBased()`, `isDMBased()`.
- **Managers**: `guilds.bans(id)`, `guilds.scheduledEvents(id)`, `channels.permissionOverwrites(id)` and `client.stageInstances`.
- **Voice helpers**: `joinVoiceChannel`, `getVoiceConnection`, `createAudioPlayer`, `createAudioResource`, `entersState`, `VoiceConnectionStatus`.
- **Sharding**: `ShardBus.onError()` receives handler failures; `ShardBus.respond()` with `request()` / `broadcastRequest()` for cross-shard queries.
- **REST**: opt-in `concurrentBuckets` runs requests on a known bucket in parallel up to its remaining allowance.

### 🐛 Bug Fixes

- **Emoji**: constructing a unicode emoji (`id: null`) threw.
- **Invites**: `client.generateInvite()` sent `scopes=` instead of Discord's `scope=`, so invite links lacked the bot scope. `fetchInvite` / `fetchGuildTemplate` now URL-encode the code.
- **Bans**: `GuildMemberManager.ban()` ignored `reason`.

- **Gateway compression**: `compress: true` previously decoded nothing. Discord's `zlib-stream` is zlib-wrapped, but the decoder used raw deflate and drained output on a 50 ms timer, dropping and reordering frames. Frames are now decoded with a persistent inflate stream on the `Z_SYNC_FLUSH` boundary, strictly in arrival order.
- **Gateway sessions**: `connect()` on an already-connected `Gateway` opened a second socket and left the first one dispatching, interleaving two sequence streams and corrupting later RESUMEs. `connect()` is now idempotent and cancels any pending reconnect.
- **Gateway handshake**: IDENTIFY and RESUME no longer share the application send budget, so a busy shard can always complete its handshake.
- **Stale frames**: a compressed frame that finished decoding after its socket was replaced is now discarded instead of dispatched.
- **REST cancellation**: an aborted request waiting in its rate-limit queue permanently wedged that bucket. Fixed.
- **REST retries**: a `429` carrying no `Retry-After` retried immediately instead of waiting the documented one second. Transport failures (DNS, resets, TLS) are now retried for idempotent methods.
- **Redis rate limits**: a Redis outage answered every read with "no limit known", dropping all workers to unlimited sending. Writes are now mirrored in-process and reads fall back to that mirror.
- **Leaks**: the `Cache` TTL sweeper no longer keeps the process alive, and `Collector.next()` no longer leaks a listener per call.

### ✨ Additions

- **Atomic rate-limit reservation**: `RateLimitStore.reserve()` hands one unit of a bucket's allowance to exactly one worker. `RedisRateLimitStore` uses a server-side Lua script when the client exposes `eval`.
- **REST pipeline**: `createRouteKey`, `RequestScheduler`, `RateLimiter`, `HttpTransport` and `ResponseDecoder` are exported, and `new REST({ transport })` injects the HTTP stage for testing.
- **`GatewaySession`**: session id, sequence, resume host and the IDENTIFY-vs-RESUME decision, exported from `@lunibee/ws`.

### 📚 Documentation

- Corrected the `ClusterManager` example: the method is `spawn()`, not `connect()`.
- Corrected the `ShardManager` and `REST` option tables, which listed options that do not exist (`presence`, `autoScale`, `apiVersion`) and omitted the real ones.
- Corrected the `Gateway` option table: `maxReconnectAttempts` defaults to `Infinity`, not `10`.
- Every package now has a full README, and the docs site has a generated API reference under `/api/`.
- Reference pages that described missing APIs were fixed, and the new APIs are documented.

### 🧪 Testing

- Line coverage raised to about 99.5%, with a per-file minimum enforced in CI.

---

## v0.1.7

### 🐛 Bug Fixes

- **Managers**: Removed a duplicate `delete` override in `ChannelManager` that caused a TypeScript `TS2393` duplicate function implementation error at build time.

### 🛠️ Build & Tooling

- **DTS build**: Excluded `*.test.ts` files from `tsconfig.dts.json` to fix a `TS5097` error caused by `.ts` import extensions in test files (valid in Bun, not in `tsc`).
- **`create-lunibee`**: Added a proper CLI entrypoint (`bin` field, `dist/` output), so `bun create lunibee` now scaffolds a new project correctly.

### 📚 Documentation

- **`quick-start.md`**: Switched intent syntax from bitwise OR (`|`) to array form to match the preferred `IntentBits` style.
- **`sharding.md`**: Same array-form intent fix.
- **`README.md`**: Corrected `PermissionsBitField` → `PermissionSet`, and `StringSelectMenuBuilder` → `StringSelectBuilder`.

---

## v0.1.6

### 🎉 Major Highlights

- **Component Builders V2**: Introduced a modern, chainable builder pattern for message components (inspired by Discord.js). Added `ActionRowBuilder`, `ButtonBuilder`, and `StringSelectMenuBuilder` for creating rich UIs effortlessly.

    ```typescript
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("primary-btn")
            .setLabel("Click Me!")
            .setStyle(1), // Primary
    );
    ```

- **💯 100% Test Coverage**: The entire Lunibee monorepo has been rigorously tested and now officially boasts **100% line and function coverage** across all packages!

### ✨ Features & Resource APIs

- **REST Multipart Support**: Added `postWithFiles` and `patchWithFiles` to the REST client, bringing first-class support for attachments and raw form data payloads.

    ```typescript
    await rest.postWithFiles(
        "/channels/123/messages",
        { content: "Here is your file!" },
        [{ name: "image.png", data: fileBuffer, contentType: "image/png" }],
    );
    ```

- **Direct Resource Operations**: You can now perform intuitive actions directly on structures. Channels and messages are now properly hydrated with the client context.
    ```typescript del={2,3} ins={5,6}
    // Previously: Context-based operations
    await context.editChannel(channel.id, { name: "general" });
    await context.sendMessage(message.channelId, { content: "Hi!" });
    // Now: Intuitive editing directly from the structure
    await channel.editName("general");
    await message.reply("Hi!");
    ```
- **Advanced Interactions**: Added full structural support and parsing for `ModalSubmitInteraction`, `AutocompleteInteraction`, and component types (11, 15, 16). Added missing getters (like `getAttachment` with required fallbacks) for Slash Command options.

    ```typescript
    // Safely extract a required attachment option
    const attachment = interaction.options.getAttachment("receipt", true);
    console.log(`Uploaded file: ${attachment.filename}`);
    ```

### 🛠️ Core & Events

- **`ClientEvent` Enum**: Introduced and exported a new `ClientEvent` enum in the `@lunibee/core` package to replace hardcoded event strings.
    ```typescript del={4,5} ins={7,8}
    import { ClientEvent } from "@lunibee/core";

    // Previously: Hardcoded strings
    client.on("messageCreate", (message) => {
    // Now: Strongly typed enums
    client.on(ClientEvent.MessageCreate, (message) => {
      console.log(message.content);
    });
    ```

### 💻 CLI & Developer Tooling

- **Interactive Tooling**: Expanded developer tooling by adding an interactive handler generator and support for multiple handlers per event. Fixed a bug to correctly detect existing event handlers.

    ```bash
    $ npx lunibee generate handler
    ? Which event would you like to handle? messageCreate
    ? Name your handler file: welcome-message
    ✔ Created src/events/messageCreate/welcome-message.ts!
    ```

- **Fix**: Fixed the CLI build process to ensure the published Lunibee binary is properly runnable.

### 📚 Documentation

- **Site & Guides**: Made the Lunibee documentation site significantly friendlier. Expanded the quick start workflow and the "package choices" overview.
- **Advanced Guides**: Wrote and expanded practical, task-focused guides for Builders, Sharding, Voice connections, Permissions, Formatters, Utilities, and common Discord types.
- **API References**: Fully documented the new application commands, channel, and message resource APIs.
- **Fixes**: Corrected gateway intent examples and API names.

## v0.1.5

- Initial public beta release containing the core client, gateway, REST API wrappers, structural representations of Discord objects, Voice components, builders, and standard interactions.
