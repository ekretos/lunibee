# @lunibee/cli

> The `lunibee` command: scaffold handlers, commands and components, and check a project.

```bash
bun add -d @lunibee/cli
bunx lunibee help
```

## Commands

| Command | What it does |
|---|---|
| `lunibee create handler [event] [name]` | Create `src/events/<event>/<name>.ts` handlers (interactive without arguments), then regenerate `src/handlers/event.ts`, which exports `registerEvents(client)`. |
| `lunibee sync handlers` | Regenerate `src/handlers/event.ts` after adding, renaming or removing files under `src/events`. |
| `lunibee create command` | Create `src/commands/<name>.ts` exporting a `CreateSlashCommand`. |
| `lunibee create component` | Create a button, string-select or modal stub in `src/components/`. |
| `lunibee list handlers` / `lunibee list commands` | List what's under `src/events` / `src/commands`. |
| `lunibee check` | Check for a Lunibee dependency and the `src`, `src/events` and `src/commands` folders. |
| `lunibee doctor` | Check `package.json`, the Lunibee dependency and `.env`. |
| `lunibee info` | Print the project name, Bun version and CLI version. |
| `lunibee status` | Lunibee maintainers: print every package in the Lunibee monorepo the CLI runs from. |
| `lunibee publish` | Lunibee maintainers: `bun publish` every non-private package in that monorepo. |

Each handler is called as `handler(client, ...args)`: the client first, then the
event's arguments, typed from `ClientEvents`. The handler may declare the bot's own
`Client` subclass as its first parameter. Only folders named after a `ClientEvent`
value are bound; several files may handle the same event.

Upgrading from 0.2.1: generated handlers received only the event arguments. Add a
`client` first parameter to each handler and run `lunibee sync handlers`.
