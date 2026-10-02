# Rule-based scan of `dev` (0.2.4)

Source: GitHub Scanner run on `f021f81` (score 92/100; code quality 78,
security 100, dependencies 100). 271 comments: 0 potential issues, 245
refactor suggestions, 26 nitpicks. Status below is for `dev` after the
cleanup commit that follows this scan.

Severity uses the P0–P3 model in `AGENT.md`. None of the scanner's
comments was a P0/P1. Working through them turned up one real bug (F1).

## Findings

### F1 — `WebhookClient.send({ files })` drops the files

- **Severity:** P2
- **Location:** `packages/rest/src/webhook.ts`, `WebhookClient.send`
- **Problem:** `files` was spread into the JSON body, so nothing was uploaded.
- **Root cause:** `files?: any[]` hid that the body was always sent with `post()`,
  never `postWithFiles()`.
- **Fix:** split `files` out and send multipart; `components` builders are
  serialized with `toJSON()`.
- **Regression test:** `tests/webhook.test.ts`, "uploads files as multipart…"
  (fails on the old code).
- **Status:** Verified

### F2 — The timeout test passed for the wrong reason

- **Severity:** P3
- **Location:** `tests/coverage.100.test.ts`, "REST setToken, abort and cancellation"
- **Problem:** the fetch stub resolved `undefined`, so the request failed on a
  bad response, not on the timeout it claims to test.
- **Fix:** the stub returns a real `Response` and rejects on the abort signal.
- **Status:** Verified

## Scanner categories

| Category | Count | Status |
| --- | --- | --- |
| Explicit `any` | 139 | **Fixed, except one**: `APIMessageComponent` in `packages/types/src/index.ts` (see Open). Listener maps are mapped types; mocks are typed; invalid-input tests use `@ts-expect-error`. |
| Duplicated code | 60 | **Fixed where real.** Fake WebSocket and `fetch` stubs shared in `tests/helpers/`; numeric options share `CreateNumericOption`; select menus share `CreateSelectMenu`; option and choice checks share `appendOption` / `appendChoices`; `ComponentEnum` is re-exported from `@lunibee/types`; `PermissionFlagsBits` is the `Permissions` object; role payloads share `rolePayload`. Not fixed: `ApplicationCommandOptionEnum` (builders use `Subcommand`, types use `SubCommand`, so they are not the same table) and test files that repeat a table on purpose. |
| Sequential `await` in loops | 25 | **Accepted.** 17 are ordered on purpose (publishing in dependency order, migrations that rename before rewriting, names that depend on earlier files, shard spawn pacing). 8 are independent CLI reads of a handful of files, where parallelizing would gain nothing measurable. |
| Complex / long functions | 21 | **Fixed where real.** The `Client` constructor (656 lines) is split into a resource-context factory and six event-wiring methods; `fixHandlers` is split into rename, migrate and report steps (the scanner attributed its length to `importEdit`, which is 30 lines). The rest are parsers or Discord's own algorithms just over the threshold. |
| Leftover `console.log` | 26 | **Accepted.** All are CLI, script, benchmark or example output. |
| Empty `catch` | 2 | **Fixed** in `scripts/bump.ts` and `scripts/check-dependency-graph.ts`. |
| Unused imports | 3 files | **Fixed.** |

## Open

- **`APIMessageComponent` still uses `[key: string]: any`** (P3). The builders
  package and the types package each define the component payloads, with
  different shapes (for example `custom_id` is optional in the builders and
  required in types; the builders' channel select has no `channel_types`). The
  `any` is what lets builder output satisfy the types package. Fix: move one set
  of component interfaces into `@lunibee/types`, re-export it from
  `@lunibee/builders`, and type the union. Touches public types, so it gets an
  upgrade-guide note.
- **`unknown` is still used in about 290 places in `packages/`.** Most are honest:
  caught errors, `JSON.parse` output before validation, Gateway dispatch data,
  generic constraints. The ones to replace are option bags typed
  `Record<string, unknown>` (builders, `MessageCreateOptions`, interaction data);
  each needs the Discord payload type it stands for.
- **`ApplicationCommandOptionEnum`** exists in builders (`Subcommand`) and types
  (`SubCommand`). Merging needs one spelling plus a deprecated alias.
