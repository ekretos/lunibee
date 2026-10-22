---
title: "@lunibee/cli"
description: The lunibee command — create a bot project, scaffold components, migrate code to 0.4.0, and check a project.
---

The `lunibee` command creates bot projects (`lunibee init`), scaffolds components, migrates code
between versions (`lunibee migrate`), and checks a project for common mistakes.

```bash
bun add -d @lunibee/cli
bunx lunibee help
```

## A new project

```bash
bunx @lunibee/cli init my-bot
cd my-bot && bun install
cp .env.example .env   # DISCORD_TOKEN, CLIENT_ID, and GUILD_ID while developing
bun run dev
```

The project registers its commands on every start (no deploy script) and finds commands and
events by walking `src/commands` and `src/events`, so adding a file is enough. Its README
covers setup, adding commands and events, and troubleshooting. `lunibee check` loads the
project's commands and events and reports invalid modules, duplicate names and `.env` keys
missing from `.env.example`.

The CLI and the generated project run on Bun 1.4 or newer; `--install` runs `bun install`.
Files are written to a staging folder first, so a failed write leaves nothing half-created.

## Commands

| Command | What it does |
|---|---|
| `lunibee init [directory]` | Create a new bot project with slash commands, message (prefix) commands or both (`--commands slash\|message\|both`; a terminal asks, otherwise slash): `src/index.ts` (startup), `config.ts` (validated `.env`), commands and events found recursively at runtime under `src/commands` and `src/events`, `services/register.ts` (slash only: registers the commands with Discord on every start: in `GUILD_ID`'s server, or globally), `/ping` and/or `!ping` (`PREFIX`, default `!`; message commands need the Message Content intent), logger, README, `.env.example`, `tsconfig.json`. The folder name is the package name. Existing files are never overwritten without `--force`, which asks first (`--yes` confirms without a prompt). `--install` runs `bun install` (the CLI and the project need Bun 1.4+); `--dry-run`. Files are staged first, so a failed write leaves nothing half-created. |
| `lunibee create component [button\|select\|modal] [name]` | Create `src/components/<name>.ts` with the builder (`row()` or `modal()`), its `customId` and a `handle(client, interaction)` stub. The name is the custom ID (1-100 of `a-z A-Z 0-9 _ - : .`). Options: `--force`, `--dry-run`. |
| `lunibee migrate [--fix]` | Find APIs removed in 0.4.0 in the TypeScript and JavaScript files under `src/`. `--fix` renames the removed names (`Events` → `ClientEvent`, `CreateStringSelectMenu` → `CreateStringSelect`, `Status` → `GatewayState`… the full list is below) only in files that import them from `lunibee` or `@lunibee/*`, so names imported from other packages are never touched; `import { X as Y }` keeps `Y`. Code it cannot rewrite is listed with `file:line` and its replacement. Exit 1 while anything is left. `--dry-run`, `--json`. |
| `lunibee list <handlers\|commands\|components\|events>` | List the modules under `src/events`, `src/commands` or `src/components` (recursive, the files an `init` project loads: no `.d.ts`, tests, or names starting with `_`), or every client event. `--json`. |
| `lunibee check` | Project layout; loads the commands and events through the project's `src/handlers/commands.ts` and `src/handlers/events.ts` (invalid modules, duplicate names); `.env` present with a token key, ignored by git, and with every key of `.env.example`. Exit code 1 on errors. `--json`. |
| `lunibee doctor` | Everything `check` does, plus the Bun version, installed Lunibee packages (missing or mixed versions) and `tsconfig.json` strictness. `--json`. |
| `lunibee info` | Project, declared and installed Lunibee versions, event/command/component file counts, runtime and CLI version. `--json`. |
| `lunibee status` | Lunibee maintainers: every package in the monorepo the CLI runs from, flagging mixed versions. `--json`. |
| `lunibee publish` | Lunibee maintainers: `bun publish` every non-private package, dependencies first. Refuses mixed versions; asks for confirmation unless `--yes`. Options: `--dry-run`, `--tag`, `--otp`. |

Global options: `--cwd <dir>` runs in another project (the project root is the nearest folder
with a `package.json`, so any subfolder works), `--no-color` (or `NO_COLOR`), `-h`/`--help` on
any command, `-v`/`--version`. Unknown commands, options and list kinds get a "did you mean"
suggestion. Secrets are never printed: `check` only looks for the token key in `.env`, not its
value, and loads the project's modules without the environment.

## Migrating to 0.4.0

```bash
bunx lunibee migrate          # report only
bunx lunibee migrate --fix    # apply the renames, then list what is left
```

`--fix` renames, in imports and in code (not in strings, comments, property names or object keys):

| Removed | Use |
|---|---|
| `Events` | `ClientEvent` |
| `CreateStringSelectMenu`, `CreateUserSelectMenu`, `CreateRoleSelectMenu`, `CreateMentionableSelectMenu`, `CreateChannelSelectMenu` | `CreateStringSelect`, `CreateUserSelect`, `CreateRoleSelect`, `CreateMentionableSelect`, `CreateChannelSelect` |
| `CachedManager` | `ResourceManager` |
| `CreateMessageOptions` | `MessageCreateOptions` |
| `InteractionUpdateOptions`, `FollowUpOptions` | `InteractionReplyOptions` |
| `DiscordAPIError` | `RESTError` |
| `ShardingManager` | `ShardManager` |
| `ClientUser` | `UserData` |
| `Intents` | `IntentBits` |
| `SendBudget` | `GatewaySendLimiter` |
| `Status` | `GatewayState` |

It lists, without changing them:

- `IntentsBitField`: pass an array of `GatewayIntentBits`;
- `rest.post/put/patch(path, { body })`: the body is positional, `(path, body, options)`;
  `rest.request({ method, path })` (or `fullRoute`) becomes `request(method, path, body, options)`;
- the 0.3 voice API: `VoiceConnectionState` (now `VoiceConnectionStatus`), `attachTransports()`,
  `AudioStream`, `VoiceGatewayTransport`, `VoiceUdpTransport`. Prefer
  `await client.voice.join({ guildId, channelId })`; `joinVoiceChannel()` needs an `adapterCreator`.
  See the [voice guide](/core-concepts/voice/).

Lines marked `check:` are guesses, to read and leave alone when the code is already right:

- `avatarURL:`, `threadId:`, `allowedMentions:` keys in a file using `WebhookClient`, whose
  payloads now take `avatar_url`, `thread_id` and `allowed_mentions`;
- `joinVoiceChannel({ … })` without an `adapterCreator`;
- `new Client({ … })` without `gateway:` in a file that uses `ClusterWorker` or `ShardBus`: a
  `Client` in a cluster worker needs `gateway: { shardId, shardCount }`.

The [upgrading guide](/getting-started/upgrading/) has every 0.4.0 change.

## Project layout

```text
src/
├── index.ts              startup: config, commands, events, login
├── commands/info/ping.ts export default defineCommand({ data, execute })
├── events/
│   ├── message/messageCreate.ts      export default defineEvent({ name, execute })
│   └── interaction/interactionCreate.ts
└── handlers/
    ├── commands.ts       finds src/commands at runtime
    └── events.ts         finds src/events at runtime
```

Folders under `src/commands` and `src/events` are free-form: each module names its own event
(`name: "messageCreate"`) or command. Files and folders starting with `_` are skipped.

0.4.0 removed the commands for the earlier binder layout (`create handler`, `create command`,
`sync handlers`, `sync commands`, `handler --fix`) and the `@lunibee/create` package; `lunibee init`
replaces both. A project still on that layout keeps working, since its generated
`src/handlers/event.ts` and `src/commands/index.ts` are ordinary code; `lunibee check` points them out.
