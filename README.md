# Lunibee 🐝

A lightweight, Bun-first Discord API library for TypeScript.

## Production-readiness status

Lunibee's production-readiness work is being developed on `feat/production-readiness`. **Do not use `master` for active development.**

The roadmap covers:

- strict package dependency boundaries and installability
- Discord Gateway lifecycle, heartbeat ACK handling, resume/reconnect, and zombie detection
- canonical resource caching and shared REST/Gateway hydration
- bucket-aware REST rate limits, retries, timeouts, and `AbortSignal` cancellation
- typed permissions and ergonomic interaction APIs
- compile-time-safe component and embed builders
- graceful client and shard shutdown
- public API documentation

## Requirements

- [Bun](https://bun.sh/) for the supported runtime and package manager
- TypeScript for typed application development
- A Discord bot token for connecting to Discord

## Installation

For repository development:

```bash
bun install
```

For application usage, install the published `lunibee` package when a release is available:

```bash
bun add lunibee
```

## Getting started

```ts
import { Client, GatewayIntentBits } from "lunibee";

const client = new Client({
    token: process.env.DISCORD_TOKEN!,
    intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages
});

client.on("ready", user => {
    console.log(`Ready as ${user.username}`);
});

client.on("messageCreate", message => {
    console.log(message.content);
});

await client.login();
```

Destroy the client when the application is shutting down:

```ts
client.destroy();
```

## Client

`Client` is the main application entry point. It coordinates the REST transport, resource managers, Gateway, event dispatch, interactions, and lifecycle state.

### Lifecycle

```text
idle → connecting → ready
  ↑                 ↓
  └──── reconnect ──┘

ready → destroyed
```

Useful APIs include:

- `client.login()` — authenticate and connect to Discord.
- `client.isReady()` — type guard for a ready client.
- `client.destroy()` — close the Gateway and clear client-managed resources.
- `client.rest` — access the REST transport.
- `client.users`, `client.guilds`, `client.channels` — resource managers.

## Gateway

The Gateway package implements the Discord WebSocket lifecycle:

```text
CONNECT → HELLO → IDENTIFY/RESUME → READY → DISPATCH
                              ↘ HEARTBEAT / ACK
                                      ↓
                                  RECONNECT
```

The Gateway tracks sequence numbers and sessions, handles Discord resume URLs, heartbeat acknowledgement timeouts, invalid sessions, server reconnect requests, and stale/zombie connections.

```ts
import { Gateway } from "@lunibee/ws";

const gateway = new Gateway({
    token: process.env.DISCORD_TOKEN!,
    intents: 513
});

await gateway.connect();
```

## REST

The REST client supports Discord bucket-aware rate limiting and retries. It consumes Discord's rate-limit headers including bucket identifiers, remaining requests, reset information, and `Retry-After`.

Requests accept an `AbortSignal`:

```ts
const controller = new AbortController();

const request = client.rest.get("/users/@me", {
    signal: controller.signal
});

controller.abort();
await request;
```

`RESTError` includes HTTP status, Discord error code, method, path, and the raw error payload when available.

## Structures and caching

Resource managers maintain canonical instances by Discord resource ID. Re-resolving an already cached resource returns the same structure instance, allowing identity-sensitive application code to remain consistent.

REST-created and Gateway-updated resources are routed through manager cache mutation APIs so the same resource is not represented by unrelated structure instances.

## Permissions

`PermissionsBitField` provides named and raw permission checks:

```ts
if (member.permissions.has("ManageMessages")) {
    // permitted
}
```

Multiple permissions can be checked together, and immutable `add()` / `remove()` operations return a new bitfield.

## Interactions

Interactions expose an ergonomic acknowledgement lifecycle:

```ts
if (interaction.isChatInputCommand()) {
    await interaction.deferReply();
    await interaction.editReply({ content: "Done!" });
    await interaction.followUp({ content: "Follow-up" });
}
```

Available lifecycle methods include `reply()`, `deferReply()`, `editReply()`, `deleteReply()`, and `followUp()`.

## Builders

Lunibee provides strict builders for Discord payloads, including:

- `EmbedBuilder`
- `ButtonBuilder`
- `ActionRowBuilder`
- `StringSelectBuilder`
- `EntitySelectBuilder`
- `ModalBuilder`
- `TextInputBuilder`

Builders validate Discord limits before serialization and expose typed `toJSON()` payloads.

## Sharding

`@lunibee/sharding` manages multiple Gateway connections and supports explicit shard counts or Discord's recommended shard count.

```ts
import { ShardManager } from "@lunibee/sharding";

const shards = new ShardManager({
    token: process.env.DISCORD_TOKEN!,
    intents: 513,
    shardCount: "auto"
});

await shards.connect();
```

Call `destroy()` during shutdown. The manager releases its Gateway instances and can initialize a fresh shard set on a later `connect()`.

## Package layout

The monorepo is organized into focused packages:

| Package | Responsibility |
| --- | --- |
| `@lunibee/types` | Discord API and shared TypeScript types |
| `@lunibee/structures` | Discord resource and interaction structures |
| `@lunibee/managers` | Resource caches and REST-backed managers |
| `@lunibee/rest` | HTTP transport, routes, rate limits, retries |
| `@lunibee/ws` | Discord Gateway connection |
| `@lunibee/core` | Main client and high-level orchestration |
| `@lunibee/builders` | Typed Discord payload builders |
| `@lunibee/sharding` | Multi-Gateway shard management |
| `lunibee` | End-user package entry point |

## Development

Run the repository's checks before submitting changes:

```bash
bun install
bunx tsc --noEmit
```

Keep production-readiness work on the active feature branch and commit each completed phase separately. Changes must not be made directly on `master`.

## API reference

The source is the authoritative API surface while Lunibee remains pre-1.0. Public exports are intentionally split by responsibility so applications can import either the high-level `lunibee` package or individual packages when appropriate.

## Status

Lunibee is in active development and the API may change before the first stable release.
