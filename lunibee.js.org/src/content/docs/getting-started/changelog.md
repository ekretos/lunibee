---
title: Changelog
description: Lunibee version history and release notes.
---

## Unreleased

### 🚨 Behaviour Changes

* **`ShardManager.spawnDelay` now defaults to `5000` ms** (`ShardManager.IDENTIFY_INTERVAL`). Discord permits one IDENTIFY per 5 seconds; starting shards back to back earned close code `4008` and invalid-session churn. An *N*-shard bot now takes about `(N - 1) × 5s` to connect. Pass `spawnDelay: 0` to opt out.
* **`ClusterManager` supervises its children.** A cluster that exits unexpectedly is re-forked with the same shard assignment after `restartDelay` (5000 ms). Disable with `restartOnExit: false`; observe with `onClusterExit`.

### 🐛 Bug Fixes

* **Gateway compression**: `compress: true` previously decoded nothing. Discord's `zlib-stream` is zlib-wrapped, but the decoder used raw deflate and drained output on a 50 ms timer, dropping and reordering frames. Frames are now decoded with a persistent inflate stream on the `Z_SYNC_FLUSH` boundary, strictly in arrival order.
* **Gateway sessions**: `connect()` on an already-connected `Gateway` opened a second socket and left the first one dispatching, interleaving two sequence streams and corrupting later RESUMEs. `connect()` is now idempotent and cancels any pending reconnect.
* **Gateway handshake**: IDENTIFY and RESUME no longer share the application send budget, so a busy shard can always complete its handshake.
* **Stale frames**: a compressed frame that finished decoding after its socket was replaced is now discarded instead of dispatched.
* **REST cancellation**: an aborted request waiting in its rate-limit queue permanently wedged that bucket. Fixed.
* **REST retries**: a `429` carrying no `Retry-After` retried immediately instead of waiting the documented one second. Transport failures (DNS, resets, TLS) are now retried for idempotent methods.
* **Redis rate limits**: a Redis outage answered every read with "no limit known", dropping all workers to unlimited sending. Writes are now mirrored in-process and reads fall back to that mirror.
* **Leaks**: the `Cache` TTL sweeper no longer keeps the process alive, and `Collector.next()` no longer leaks a listener per call.

### ✨ Additions

* **Atomic rate-limit reservation**: `RateLimitStore.reserve()` hands one unit of a bucket's allowance to exactly one worker. `RedisRateLimitStore` uses a server-side Lua script when the client exposes `eval`.
* **REST pipeline**: `createRouteKey`, `RequestScheduler`, `RateLimiter`, `HttpTransport` and `ResponseDecoder` are exported, and `new REST({ transport })` injects the HTTP stage for testing.
* **`GatewaySession`**: session id, sequence, resume host and the IDENTIFY-vs-RESUME decision, exported from `@lunibee/ws`.

### 📚 Documentation

* Corrected the `ClusterManager` example: the method is `spawn()`, not `connect()`.
* Corrected the `ShardManager` and `REST` option tables, which listed options that do not exist (`presence`, `autoScale`, `apiVersion`) and omitted the real ones.
* Corrected the `Gateway` option table: `maxReconnectAttempts` defaults to `Infinity`, not `10`.

---

## v0.1.7

### 🐛 Bug Fixes

* **Managers**: Removed a duplicate `delete` override in `ChannelManager` that caused a TypeScript `TS2393` duplicate function implementation error at build time.

### 🛠️ Build & Tooling

* **DTS build**: Excluded `*.test.ts` files from `tsconfig.dts.json` to fix a `TS5097` error caused by `.ts` import extensions in test files (valid in Bun, not in `tsc`).
* **`create-lunibee`**: Added a proper CLI entrypoint (`bin` field, `dist/` output), so `bun create lunibee` now scaffolds a new project correctly.

### 📚 Documentation

* **`quick-start.md`**: Switched intent syntax from bitwise OR (`|`) to array form to match the preferred `IntentBits` style.
* **`sharding.md`**: Same array-form intent fix.
* **`README.md`**: Corrected `PermissionsBitField` → `PermissionSet`, and `StringSelectMenuBuilder` → `StringSelectBuilder`.

---

## v0.1.6


### 🎉 Major Highlights

* **Component Builders V2**: Introduced a modern, chainable builder pattern for message components (inspired by Discord.js). Added `ActionRowBuilder`, `ButtonBuilder`, and `StringSelectMenuBuilder` for creating rich UIs effortlessly.

  ```typescript
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("primary-btn")
      .setLabel("Click Me!")
      .setStyle(1) // Primary
  );
  ```
* **💯 100% Test Coverage**: The entire Lunibee monorepo has been rigorously tested and now officially boasts **100% line and function coverage** across all packages!

### ✨ Features & Resource APIs
* **REST Multipart Support**: Added `postWithFiles` and `patchWithFiles` to the REST client, bringing first-class support for attachments and raw form data payloads.

  ```typescript
  await rest.postWithFiles("/channels/123/messages", { content: "Here is your file!" }, [
    { name: "image.png", data: fileBuffer, contentType: "image/png" }
  ]);
  ```
* **Direct Resource Operations**: You can now perform intuitive actions directly on structures. Channels and messages are now properly hydrated with the client context.
  ```typescript del={2,3} ins={5,6}
  // Previously: Context-based operations
  await context.editChannel(channel.id, { name: "general" });
  await context.sendMessage(message.channelId, { content: "Hi!" });
  // Now: Intuitive editing directly from the structure
  await channel.editName("general");
  await message.reply("Hi!");
  ```
* **Advanced Interactions**: Added full structural support and parsing for `ModalSubmitInteraction`, `AutocompleteInteraction`, and component types (11, 15, 16). Added missing getters (like `getAttachment` with required fallbacks) for Slash Command options.

  ```typescript
  // Safely extract a required attachment option
  const attachment = interaction.options.getAttachment("receipt", true);
  console.log(`Uploaded file: ${attachment.filename}`);
  ```

### 🛠️ Core & Events
* **`ClientEvent` Enum**: Introduced and exported a new `ClientEvent` enum in the `@lunibee/core` package to replace hardcoded event strings.
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
* **Interactive Tooling**: Expanded developer tooling by adding an interactive handler generator and support for multiple handlers per event. Fixed a bug to correctly detect existing event handlers.

  ```bash
  $ npx lunibee generate handler
  ? Which event would you like to handle? messageCreate
  ? Name your handler file: welcome-message
  ✔ Created src/events/messageCreate/welcome-message.ts!
  ```
* **Fix**: Fixed the CLI build process to ensure the published Lunibee binary is properly runnable.

### 📚 Documentation
* **Site & Guides**: Made the Lunibee documentation site significantly friendlier. Expanded the quick start workflow and the "package choices" overview.
* **Advanced Guides**: Wrote and expanded practical, task-focused guides for Builders, Sharding, Voice connections, Permissions, Formatters, Utilities, and common Discord types.
* **API References**: Fully documented the new application commands, channel, and message resource APIs.
* **Fixes**: Corrected gateway intent examples and API names.

## v0.1.5

* Initial public beta release containing the core client, gateway, REST API wrappers, structural representations of Discord objects, Voice components, builders, and standard interactions.
