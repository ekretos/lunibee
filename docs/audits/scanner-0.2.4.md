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
| Duplicated code | 60 | **Partly fixed.** The fake WebSocket copied into 8 test files is now `tests/helpers/fake-websocket.ts`; `fetch` stubs share `tests/helpers/fetch.ts`; a dead `MockWebSocket` was removed. The rest is open (see below). |
| Sequential `await` in loops | 25 | **Accepted.** Each one is ordered on purpose: publishing in dependency order, file writes that create folders, migrations that rename before rewriting, shard spawn pacing. `Promise.all` would change behaviour. |
| Complex / long functions | 21 | **Open (P3).** Biggest: the `Client` constructor (event wiring), `importEdit` / `scanSource` / `maskCode` in the CLI. Refactor only with tests around them, not in a security release. |
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
- **Duplicated constant tables** (P3): `ComponentEnum`, the command option types
  and the permission flags exist in both `@lunibee/types` and the package that
  uses them. They are deliberately kept identical; merging them is part of the
  same move as the component types.
- **Builder duplication** (P3): `setMinValue` / `setMaxValue`, `addChoices` and
  `setCustomId` / `setPlaceholder` are repeated between the integer/number
  options and the select menus. A shared base would remove it.
