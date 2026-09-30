# @lunibee/cli

> The `lunibee` command: scaffold handlers, commands and components, and check a project.

```bash
bun add -d @lunibee/cli
bunx lunibee help
```

## Commands

| Command | What it does |
|---|---|
| `lunibee create handler [event…] [name]` | Create `src/events/<event>/<name>.ts` and regenerate `src/handlers/event.ts`, which exports `registerEvents(client)`. Events may be values (`messageCreate`), member names (`MessageCreate`), any case, or comma-separated; without one, pick from a list (terminal only). Options: `--name`, `--force`, `--dry-run`. |
| `lunibee handler [--fix]` | Find handlers not in the current format. `--fix` adds a first `_client: Client` parameter (plus the `lunibee` import; `.js` files get `_client` only), renames event folders whose case is wrong (`messagecreate/` → `messageCreate/`), then regenerates `src/handlers/event.ts`. Handlers already taking the client (a first parameter named `client`/`bot` or typed as a `Client`) and parameterless ones are left alone; shapes it cannot rewrite are listed. Without `--fix` it only reports (exit 1 when something needs fixing). `--dry-run`, `--json`; `handlers` works too. |
| `lunibee sync handlers` | Regenerate `src/handlers/event.ts` after adding, renaming or removing files under `src/events`. Writes only on change; warns about folders that are not events (typos) and files without a default export. `--check` exits 1 when out of date without writing (for pre-commit hooks); `--dry-run`. |
| `lunibee create command [name]` | Create `src/commands/[category/]<name>.ts` exporting `data` (a `CreateSlashCommand`, also the default export) and `execute(client, interaction)`. The name is validated against Discord's rules. Options: `--description`/`-d`, `--category`/`-c` (folders, e.g. `admin/mod`), `--force`, `--dry-run`. |
| `lunibee create component [button\|select\|modal] [name]` | Create `src/components/<name>.ts` with the builder (`row()` or `modal()`), its `customId` and a `handle(client, interaction)` stub. The name is the custom ID (1-100 of `a-z A-Z 0-9 _ - : .`). Options: `--force`, `--dry-run`. |
| `lunibee list <handlers\|commands\|components\|events>` | List what is under `src/events`, `src/commands` (recursive), `src/components`, or every client event. `--json`. |
| `lunibee check` | Project layout, handler binder in sync, typo folders, missing default exports, `.env` present with a token key and ignored by git. Exit code 1 on errors. `--json`. |
| `lunibee doctor` | Everything `check` does, plus the Bun version, installed Lunibee packages (missing or mixed versions) and `tsconfig.json` strictness. `--json`. |
| `lunibee info` | Project, declared and installed Lunibee versions, handler/command/component counts, runtime and CLI version. `--json`. |
| `lunibee status` | Lunibee maintainers: every package in the monorepo the CLI runs from, flagging mixed versions. `--json`. |
| `lunibee publish` | Lunibee maintainers: `bun publish` every non-private package, dependencies first. Refuses mixed versions; asks for confirmation unless `--yes`. Options: `--dry-run`, `--tag`, `--otp`. |

Global options: `--cwd <dir>` runs in another project (the project root is the nearest folder
with a `package.json`, so any subfolder works), `--no-color` (or `NO_COLOR`), `-h`/`--help` on
any command, `-v`/`--version`. Unknown commands, options, events and list kinds get a
"did you mean" suggestion. Secrets are never printed: `check` only looks for the token key in
`.env`, not its value.

Each handler is called as `handler(client, ...args)`: the client first, then the
event's arguments, typed from `ClientEvents`. The handler may declare the bot's own
`Client` subclass as its first parameter. Only folders named after a `ClientEvent`
value are bound; several files may handle the same event.

Upgrading from 0.2.1: generated handlers received only the event arguments. Run
`lunibee handler --fix` to add the `client` first parameter to each handler and resync. The generated
`src/handlers/event.ts` is unchanged. `create command` now also exports `data` and `execute`;
existing command files keep working.
