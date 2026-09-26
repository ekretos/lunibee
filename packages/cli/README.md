# @lunibee/cli

> The `lunibee` command: scaffold handlers, commands and components, and check a project.

```bash
bun add -d @lunibee/cli
bunx lunibee help
```

## Commands

| Command | What it does |
|---|---|
| `lunibee create handler` | Pick client events interactively and create `src/events/<event>/<name>.ts` handlers, then regenerate `src/handlers/event.ts`, which exports `registerEvents(client)`. |
| `lunibee create command` | Create `src/commands/<name>.ts` exporting a `SlashCommandBuilder`. |
| `lunibee create component` | Create a button, string-select or modal stub in `src/components/`. |
| `lunibee list handlers` / `lunibee list commands` | List what's under `src/events` / `src/commands`. |
| `lunibee check` | Check for a Lunibee dependency and the `src`, `src/events` and `src/commands` folders. |
| `lunibee doctor` | Check `package.json`, the Lunibee dependency and `.env`. |
| `lunibee info` | Print the project name, Bun version and CLI version. |
| `lunibee status` | Lunibee maintainers: print every package in the Lunibee monorepo the CLI runs from. |
| `lunibee publish` | Lunibee maintainers: `bun publish` every non-private package in that monorepo. |

Generated handlers are typed from `ClientEvents`, so each handler receives the right
payload for its event.
