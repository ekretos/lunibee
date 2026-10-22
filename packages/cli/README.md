# @lunibee/cli

> The `lunibee` command: create a bot project, scaffold components, migrate code to 0.4.0, and check a project.

```bash
bun add -d @lunibee/cli
bunx lunibee help
bunx @lunibee/cli init my-bot   # a new project
```

## Commands

| Command | What it does |
|---|---|
| `lunibee init [directory]` | Create a new bot project with slash commands, message (prefix) commands or both (`--commands slash\|message\|both`; a terminal asks, otherwise slash): `src/index.ts` (startup), `config.ts` (validated `.env`), commands and events found recursively at runtime under `src/commands` and `src/events`, `services/register.ts` (slash only: registers the commands with Discord on every start: in `GUILD_ID`'s server, or globally), `/ping` and/or `!ping` (`PREFIX`, default `!`; message commands need the Message Content intent), logger, README, `.env.example`, `tsconfig.json`. The folder name is the package name. Existing files are never overwritten without `--force`, which asks first (`--yes` confirms without a prompt). `--install` runs `bun install` (the CLI and the project need Bun 1.4+); `--dry-run`. Files are staged first, so a failed write leaves nothing half-created. |
| `lunibee create command [name]` | Create `src/commands/[category/]<name>.ts` with `defineCommand`, in the project's style from `lunibee init --commands`: `execute` (slash), `executeMessage` (message) or both. The name is 1-32 of `a-z 0-9 - _`. Options: `--category <folder>`, `--description <text>` (default `Runs <name>.`), `--force`, `--dry-run`. |
| `lunibee create component [button\|select\|modal] [name]` | Create `src/components/<name>.ts` with the builder (`row()` or `modal()`), its `customId` and a `handle(client, interaction)` stub. The name is the custom ID (1-100 of `a-z A-Z 0-9 _ - : .`). Options: `--force`, `--dry-run`. |
| `lunibee migrate [--fix]` | Find APIs removed in 0.4.0 in the TypeScript and JavaScript files under `src/`. `--fix` renames the removed names (`Events` → `ClientEvent`, `CreateStringSelectMenu` → `CreateStringSelect`, `Status` → `GatewayState`…) only in files that import them from `lunibee` or `@lunibee/*`, so names imported from other packages are never touched; `import { X as Y }` keeps `Y`. Code it cannot rewrite is listed with `file:line` and its replacement. Exit 1 while anything is left. `--dry-run`, `--json`. |
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

`lunibee migrate` lists every rename and hand change; see
[the CLI page](https://lunibee.js.org/packages/cli/#migrating-to-040) for the full list.
0.4.0 removed the binder-layout commands (`create handler`, `sync handlers`, `sync commands`,
`handler --fix`) and the `@lunibee/create` package: use `lunibee init`.
